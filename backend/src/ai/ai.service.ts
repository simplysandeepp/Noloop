import { Injectable, Logger } from "@nestjs/common";
import {
  AiDecision,
  AiDeduction,
  AiFraudFlag,
  ClaimPacket,
} from "./ai.types";

/**
 * Bridge to the NoLoop AI adjudication engine (Python/FastAPI, Noloop/ai).
 *
 * Primary path: POST the claim packet to the engine's /adjudicate endpoint.
 * Resilience: if the engine is unreachable (not running, timeout), we fall back
 * to an in-process rule engine that mirrors the Python pipeline, so the platform
 * keeps working in a live demo. The `model` field records which path ran.
 */
@Injectable()
export class AiService {
  private readonly log = new Logger("AiService");
  private readonly engineUrl =
    process.env.AI_ENGINE_URL ?? "http://localhost:8000";

  /** Adjudicate a packet, returning a decision and the latency in ms. */
  async adjudicate(
    packet: ClaimPacket,
  ): Promise<{ decision: AiDecision; latencyMs: number }> {
    const started = Date.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(`${this.engineUrl}/adjudicate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(packet),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`engine returned ${res.status}`);
      const decision = (await res.json()) as AiDecision;
      return { decision, latencyMs: Date.now() - started };
    } catch (err) {
      this.log.warn(
        `AI engine unreachable (${(err as Error).message}); using in-process fallback`,
      );
      const decision = this.fallback(packet);
      return { decision, latencyMs: Date.now() - started };
    }
  }

  /** OCR a claim document via the engine's Groq-vision /extract endpoint. */
  async extractDocument(
    imageBase64: string,
    mimeType: string,
  ): Promise<any> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);
      const res = await fetch(`${this.engineUrl}/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64, mimeType }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`engine returned ${res.status}`);
      return await res.json();
    } catch (err) {
      this.log.warn(`Document extraction failed: ${(err as Error).message}`);
      return {
        enabled: false,
        note: "The AI engine is unreachable — fill the form manually.",
      };
    }
  }

  // ──────────────────────────────────────────────────────────
  // In-process fallback — faithful to ai/app/pipeline/*.
  // ──────────────────────────────────────────────────────────
  private static readonly TYPICAL_LOS: Record<string, number> = {
    appendectomy: 2,
    "cataract surgery": 1,
    angioplasty: 3,
    "cesarean delivery": 3,
    "knee replacement": 4,
    "dialysis session": 1,
  };
  private static readonly LOS_TOLERANCE = 5;
  private static readonly DEFAULT_LOS = 3;

  private fallback(packet: ClaimPacket): AiDecision {
    const proc = packet.admission.procedure.trim().toLowerCase();
    const excluded = packet.policy.exclusions.map((p) => p.toLowerCase());
    const covered = packet.policy.coveredProcedures.map((p) => p.toLowerCase());

    // Coverage
    let coverageCovered: boolean;
    let coverageReason: string;
    const citedClauseRefs: string[] = [];
    if (excluded.includes(proc)) {
      coverageCovered = false;
      coverageReason = `'${packet.admission.procedure}' is listed under policy exclusions.`;
      citedClauseRefs.push("EXCLUSIONS");
    } else if (covered.includes(proc)) {
      coverageCovered = true;
      coverageReason = `'${packet.admission.procedure}' is a covered procedure under the policy.`;
      citedClauseRefs.push("COVERED_PROCEDURES");
    } else {
      coverageCovered = false;
      coverageReason = `'${packet.admission.procedure}' is not explicitly listed; needs manual review.`;
    }

    // Validate / fraud flags
    const flags: AiFraudFlag[] = [];
    const lineSum = packet.bill.lineItems.reduce(
      (s, li) => s + li.amountPaise,
      0,
    );
    const total = packet.bill.totalPaise;
    const sumInsured = packet.policy.sumInsuredPaise;
    const overCapOverage =
      total > sumInsured &&
      lineSum <= sumInsured &&
      total - lineSum > sumInsured * 0.5;
    if (lineSum !== total && !overCapOverage) {
      flags.push({
        signal: "BILL_MATH_MISMATCH",
        severity: "HIGH",
        detail: `Line items sum to ₹${(lineSum / 100).toLocaleString("en-IN")} but the bill total is ₹${(total / 100).toLocaleString("en-IN")}.`,
      });
    }
    const benchmark = AiService.TYPICAL_LOS[proc] ?? AiService.DEFAULT_LOS;
    const los = packet.admission.lengthOfStayDays;
    if (los > benchmark + AiService.LOS_TOLERANCE) {
      flags.push({
        signal: "LENGTH_OF_STAY_ANOMALY",
        severity: "MEDIUM",
        detail: `Stay of ${los} days far exceeds the ~${benchmark}-day benchmark for ${packet.admission.procedure}.`,
      });
    }
    if (total > sumInsured && lineSum <= sumInsured) {
      flags.push({
        signal: "AMOUNT_OUTLIER",
        severity: "MEDIUM",
        detail: `Claimed ₹${(total / 100).toLocaleString("en-IN")} exceeds the sum insured ₹${(sumInsured / 100).toLocaleString("en-IN")}.`,
      });
    }
    if (
      packet.admission.admittedAt &&
      packet.admission.dischargedAt &&
      packet.admission.dischargedAt < packet.admission.admittedAt
    ) {
      flags.push({
        signal: "DATE_INCONSISTENCY",
        severity: "HIGH",
        detail: `Discharge date ${packet.admission.dischargedAt} is before admission date ${packet.admission.admittedAt}.`,
      });
    }
    if (!coverageCovered && citedClauseRefs.includes("EXCLUSIONS")) {
      flags.push({
        signal: "POLICY_EXCLUSION",
        severity: "HIGH",
        detail: coverageReason,
      });
    }

    // Adjudicate
    const signals = new Set(flags.map((f) => f.signal));
    const denySignals = ["BILL_MATH_MISMATCH", "POLICY_EXCLUSION", "DATE_INCONSISTENCY"];
    const querySignals = ["LENGTH_OF_STAY_ANOMALY", "AMOUNT_OUTLIER"];
    const reasons = flags.map((f) => f.detail);

    let verdict: AiDecision["verdict"];
    let approved: number | null;
    let deductions: AiDeduction[] = [];

    if (denySignals.some((s) => signals.has(s))) {
      verdict = "DENY";
      approved = 0;
    } else if (!coverageCovered) {
      verdict = "QUERY";
      approved = null;
      reasons.push(coverageReason);
    } else if (querySignals.some((s) => signals.has(s))) {
      verdict = "QUERY";
      approved = null;
    } else {
      verdict = "APPROVE";
      const r = this.payable(packet);
      approved = r.approved;
      deductions = r.deductions;
      if (deductions.length) {
        reasons.push(
          `Payable after deductions: ${deductions
            .map((d) => `${d.label} (−₹${(d.amountPaise / 100).toLocaleString("en-IN")})`)
            .join(", ")}.`,
        );
      }
      reasons.push("Procedure covered, amounts consistent, and stay within norms.");
    }

    const head =
      verdict === "APPROVE"
        ? `Claim approved for ₹${((approved ?? 0) / 100).toLocaleString("en-IN")}.`
        : verdict === "DENY"
          ? "Claim denied."
          : "Claim held for review.";
    const rationale = `${head} ${reasons.join(" ") || "No issues detected."}`;

    return {
      ref: packet.ref,
      verdict,
      rationale,
      citedClauseRefs,
      fraudFlags: flags,
      approvedAmountPaise: approved,
      deductions,
      confidence: verdict === "QUERY" ? 0.6 : 0.92,
      model: "rule-engine-ts-fallback",
    };
  }

  private payable(packet: ClaimPacket): {
    approved: number;
    deductions: AiDeduction[];
  } {
    const deductions: AiDeduction[] = [];
    const billed = packet.bill.totalPaise;
    const sumInsured = packet.policy.sumInsuredPaise;
    let gross = billed;
    if (billed > sumInsured) {
      deductions.push({ label: "Exceeds sum insured", amountPaise: billed - sumInsured });
      gross = sumInsured;
    }
    const cap = packet.policy.roomRentCapPerDayPaise;
    if (cap) {
      const los = Math.max(1, packet.admission.lengthOfStayDays);
      const roomBilled = packet.bill.lineItems
        .filter((li) => li.desc.toLowerCase().includes("room"))
        .reduce((s, li) => s + li.amountPaise, 0);
      const allowed = cap * los;
      if (roomBilled > allowed) {
        const excess = roomBilled - allowed;
        deductions.push({
          label: `Room rent above ₹${(cap / 100).toLocaleString("en-IN")}/day cap`,
          amountPaise: excess,
        });
        gross -= excess;
      }
    }
    const copay = packet.policy.copayPct ?? 0;
    if (copay > 0) {
      const amt = Math.round((gross * copay) / 100);
      deductions.push({ label: `${copay}% co-pay`, amountPaise: amt });
      gross -= amt;
    }
    return { approved: Math.max(0, gross), deductions };
  }
}
