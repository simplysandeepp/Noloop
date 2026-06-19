import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";
import {
  ClaimStatus,
  ClaimType,
  ClaimEventType,
  FraudSeverity,
  Prisma,
  Role,
  TenantType,
  Verdict,
} from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AiService } from "../ai/ai.service";
import { ClaimPacket } from "../ai/ai.types";
import { SubmitClaimDto } from "./dto/submit-claim.dto";
import { OverrideClaimDto } from "./dto/override-claim.dto";

interface AuthUser {
  sub: string;
  role: Role;
  tenantId: string | null;
}

const DAY_MS = 86_400_000;

@Injectable()
export class ClaimsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
  ) {}

  // ── helpers ──────────────────────────────────────────────
  private async newClaimNumber(): Promise<string> {
    for (let i = 0; i < 8; i++) {
      const n = Math.floor(100000 + Math.random() * 899999);
      const candidate = `CLM-${n}`;
      const taken = await this.prisma.claim.findUnique({
        where: { claimNumber: candidate },
      });
      if (!taken) return candidate;
    }
    return `CLM-${Date.now()}`;
  }

  private verdictToStatus(v: Verdict): ClaimStatus {
    if (v === Verdict.APPROVE) return ClaimStatus.APPROVED;
    if (v === Verdict.DENY) return ClaimStatus.DENIED;
    return ClaimStatus.QUERIED;
  }

  private severity(s: string): FraudSeverity {
    return s === "HIGH"
      ? FraudSeverity.HIGH
      : s === "LOW"
        ? FraudSeverity.LOW
        : FraudSeverity.MEDIUM;
  }

  /** Restrict a claim query to what this user is allowed to see. */
  private scopeWhere(user: AuthUser): Prisma.ClaimWhereInput {
    if (user.role === Role.PLATFORM_ADMIN) return {};
    if (user.role === Role.HOSPITAL_ADMIN || user.role === Role.HOSPITAL_STAFF)
      return { hospitalTenantId: user.tenantId ?? "__none__" };
    if (user.role === Role.INSURER_ADMIN || user.role === Role.INSURER_ADJUDICATOR)
      return { insurerTenantId: user.tenantId ?? "__none__" };
    return { id: "__none__" };
  }

  // ── submit + auto-adjudicate (the automated workflow) ─────
  async submit(user: AuthUser, dto: SubmitClaimDto) {
    if (!user.tenantId) throw new BadRequestException("No hospital on token");
    const hospital = await this.prisma.tenant.findUnique({
      where: { id: user.tenantId },
    });
    if (!hospital || hospital.type !== TenantType.HOSPITAL)
      throw new ForbiddenException("Only hospitals can submit claims");

    const insurer = await this.prisma.tenant.findUnique({
      where: { id: dto.insurerTenantId },
    });
    if (!insurer || insurer.type !== TenantType.INSURER)
      throw new BadRequestException("Target insurer not found");

    // Resolve patient (optional) + the policy that governs coverage.
    let patient = dto.memberId
      ? await this.prisma.patient.findUnique({
          where: { memberId: dto.memberId },
          include: { policy: true },
        })
      : null;
    if (patient && patient.insurerTenantId !== insurer.id) patient = null;

    const policy =
      patient?.policy ??
      (await this.prisma.policy.findFirst({
        where: { insurerTenantId: insurer.id },
        orderBy: { createdAt: "asc" },
      }));
    if (!policy)
      throw new BadRequestException(
        "This insurer has no policy configured yet",
      );

    const billed =
      dto.totalPaise ??
      dto.lineItems.reduce((s, li) => s + li.amountPaise, 0);
    const admittedAt = new Date(dto.admittedAt);
    const dischargedAt = new Date(dto.dischargedAt);
    const los = Math.max(
      1,
      Math.round((dischargedAt.getTime() - admittedAt.getTime()) / DAY_MS),
    );

    const claimNumber = await this.newClaimNumber();
    const submittedAt = new Date();

    // 1. Persist the claim in PROCESSING with its opening timeline events.
    const claim = await this.prisma.claim.create({
      data: {
        claimNumber,
        type: (dto.type as ClaimType) ?? ClaimType.CASHLESS,
        hospitalTenantId: hospital.id,
        insurerTenantId: insurer.id,
        policyId: policy.id,
        patientId: patient?.id ?? null,
        admissionId: dto.admissionId ?? null,
        patientName: dto.patientName,
        patientAge: dto.patientAge,
        patientGender: dto.patientGender,
        diagnosis: dto.diagnosis,
        procedure: dto.procedure,
        admittedAt,
        dischargedAt,
        lengthOfStayDays: los,
        sumInsuredPaise: policy.sumInsuredPaise,
        billedPaise: billed,
        lineItems: dto.lineItems as unknown as Prisma.InputJsonValue,
        status: ClaimStatus.PROCESSING,
        submittedById: user.sub,
        submittedAt,
        events: {
          create: [
            {
              type: ClaimEventType.SUBMITTED,
              message: `Claim ${claimNumber} submitted by ${hospital.name} to ${insurer.name}.`,
              actorId: user.sub,
            },
            {
              type: ClaimEventType.AI_STARTED,
              message: "AI adjudication engine started.",
            },
          ],
        },
      },
    });

    // 2. Run the engine.
    const packet: ClaimPacket = {
      ref: claimNumber,
      type: claim.type,
      hospital: hospital.name,
      insurer: insurer.name,
      policy: {
        policyNo: policy.planCode,
        sumInsuredPaise: policy.sumInsuredPaise,
        roomRentCapPerDayPaise: policy.roomRentCapPerDayPaise,
        copayPct: policy.copayPct,
        coveredProcedures: policy.coveredProcedures,
        exclusions: policy.exclusions,
      },
      admission: {
        admittedAt: dto.admittedAt.slice(0, 10),
        dischargedAt: dto.dischargedAt.slice(0, 10),
        lengthOfStayDays: los,
        procedure: dto.procedure,
        diagnosis: dto.diagnosis,
      },
      bill: { lineItems: dto.lineItems, totalPaise: billed },
      dischargeSummary: `Patient ${dto.patientName} (${dto.patientAge}y) admitted for ${dto.procedure}; ${los} day(s); billed ₹${(billed / 100).toLocaleString("en-IN")}.`,
    };
    const { decision, latencyMs } = await this.ai.adjudicate(packet);

    const decidedAt = new Date();
    const tatSeconds = Math.max(
      0,
      Math.round((decidedAt.getTime() - submittedAt.getTime()) / 1000),
    );
    const status = this.verdictToStatus(decision.verdict);

    // 3. Persist decision, flags, and closing events; mirror onto the claim.
    await this.prisma.$transaction(async (tx) => {
      await tx.decision.create({
        data: {
          claimId: claim.id,
          verdict: decision.verdict as Verdict,
          approvedAmountPaise: decision.approvedAmountPaise ?? null,
          confidence: decision.confidence,
          rationale: decision.rationale,
          citedClauseRefs: decision.citedClauseRefs,
          model: decision.model,
          latencyMs,
        },
      });
      if (decision.fraudFlags.length) {
        await tx.fraudFlag.createMany({
          data: decision.fraudFlags.map((f) => ({
            claimId: claim.id,
            signal: f.signal,
            severity: this.severity(f.severity),
            detail: f.detail,
          })),
        });
      }
      const events: Prisma.ClaimEventCreateManyInput[] = [
        {
          claimId: claim.id,
          type: ClaimEventType.AI_DECISION,
          message: `AI verdict: ${decision.verdict} (${Math.round(
            decision.confidence * 100,
          )}% confidence, ${latencyMs}ms). ${decision.rationale}`,
        },
      ];
      if (decision.fraudFlags.length)
        events.push({
          claimId: claim.id,
          type: ClaimEventType.FRAUD_FLAGGED,
          message: `${decision.fraudFlags.length} anomaly signal(s): ${decision.fraudFlags
            .map((f) => f.signal)
            .join(", ")}.`,
        });
      if (decision.verdict === "QUERY")
        events.push({
          claimId: claim.id,
          type: ClaimEventType.QUERY_RAISED,
          message: "Routed for review — additional information required.",
        });
      await tx.claimEvent.createMany({ data: events });

      await tx.claim.update({
        where: { id: claim.id },
        data: {
          status,
          verdict: decision.verdict as Verdict,
          approvedAmountPaise: decision.approvedAmountPaise ?? null,
          confidence: decision.confidence,
          rationale: decision.rationale,
          citedClauseRefs: decision.citedClauseRefs,
          aiModel: decision.model,
          aiLatencyMs: latencyMs,
          tatSeconds,
          decidedAt,
        },
      });
    });

    return this.get(user, claim.id);
  }

  /** OCR an uploaded claim document (bill / discharge summary) via Groq vision. */
  async extractDocument(file: { buffer: Buffer; mimetype: string } | undefined) {
    if (!file?.buffer) throw new BadRequestException("No file uploaded");
    const base64 = file.buffer.toString("base64");
    return this.ai.extractDocument(base64, file.mimetype || "image/jpeg");
  }

  // ── listing + detail ─────────────────────────────────────
  async list(user: AuthUser, status?: string) {
    const where = this.scopeWhere(user);
    if (status) where.status = status as ClaimStatus;
    const claims = await this.prisma.claim.findMany({
      where,
      orderBy: { submittedAt: "desc" },
      take: 200,
      include: {
        hospital: { select: { name: true } },
        insurer: { select: { name: true } },
        _count: { select: { fraudFlags: true } },
      },
    });
    return claims.map((c) => ({
      id: c.id,
      claimNumber: c.claimNumber,
      type: c.type,
      patientName: c.patientName,
      procedure: c.procedure,
      hospital: c.hospital.name,
      insurer: c.insurer.name,
      billedPaise: c.billedPaise,
      approvedAmountPaise: c.approvedAmountPaise,
      status: c.status,
      verdict: c.verdict,
      confidence: c.confidence,
      fraudFlagCount: c._count.fraudFlags,
      tatSeconds: c.tatSeconds,
      submittedAt: c.submittedAt,
      decidedAt: c.decidedAt,
    }));
  }

  async get(user: AuthUser, id: string) {
    const claim = await this.prisma.claim.findFirst({
      where: { id, ...this.scopeWhere(user) },
      include: {
        hospital: { select: { name: true } },
        insurer: { select: { name: true } },
        policy: { select: { name: true, planCode: true } },
        patient: { select: { memberId: true } },
        fraudFlags: { orderBy: { createdAt: "asc" } },
        events: { orderBy: { createdAt: "asc" } },
        decisions: { orderBy: { createdAt: "desc" } },
        overriddenBy: { select: { name: true, email: true } },
      },
    });
    if (!claim) throw new NotFoundException("Claim not found");
    return claim;
  }

  /** Public claim tracking by claim number (for the patient timeline). */
  async track(claimNumber: string) {
    const claim = await this.prisma.claim.findUnique({
      where: { claimNumber },
      include: {
        hospital: { select: { name: true } },
        insurer: { select: { name: true } },
        events: { orderBy: { createdAt: "asc" } },
        fraudFlags: { select: { signal: true, severity: true } },
      },
    });
    if (!claim) throw new NotFoundException("No claim with that number");
    return {
      claimNumber: claim.claimNumber,
      patientName: claim.patientName,
      procedure: claim.procedure,
      hospital: claim.hospital.name,
      insurer: claim.insurer.name,
      status: claim.status,
      verdict: claim.verdict,
      billedPaise: claim.billedPaise,
      approvedAmountPaise: claim.approvedAmountPaise,
      rationale: claim.rationale,
      tatSeconds: claim.tatSeconds,
      submittedAt: claim.submittedAt,
      decidedAt: claim.decidedAt,
      settledAt: claim.settledAt,
      events: claim.events,
      flagCount: claim.fraudFlags.length,
    };
  }

  // ── insurer override / settle ────────────────────────────
  async override(user: AuthUser, id: string, dto: OverrideClaimDto) {
    const claim = await this.prisma.claim.findFirst({
      where: { id, ...this.scopeWhere(user) },
    });
    if (!claim) throw new NotFoundException("Claim not found");

    const status =
      dto.verdict === "APPROVE"
        ? dto.settle
          ? ClaimStatus.SETTLED
          : ClaimStatus.APPROVED
        : dto.verdict === "DENY"
          ? ClaimStatus.DENIED
          : ClaimStatus.UNDER_REVIEW;

    const approved =
      dto.verdict === "APPROVE"
        ? (dto.approvedAmountPaise ??
          claim.approvedAmountPaise ??
          claim.billedPaise)
        : dto.verdict === "DENY"
          ? 0
          : claim.approvedAmountPaise;

    await this.prisma.$transaction(async (tx) => {
      await tx.claim.update({
        where: { id },
        data: {
          status,
          verdict: dto.verdict as Verdict,
          approvedAmountPaise: approved,
          overriddenById: user.sub,
          overrideNote: dto.note,
          overriddenAt: new Date(),
          settledAt: dto.settle ? new Date() : claim.settledAt,
        },
      });
      await tx.claimEvent.create({
        data: {
          claimId: id,
          type: ClaimEventType.OVERRIDDEN,
          message: `Adjudicator override → ${dto.verdict}${
            dto.verdict === "APPROVE" && approved != null
              ? ` (₹${(approved / 100).toLocaleString("en-IN")})`
              : ""
          }. ${dto.note}`,
          actorId: user.sub,
        },
      });
      if (dto.settle)
        await tx.claimEvent.create({
          data: {
            claimId: id,
            type: ClaimEventType.SETTLED,
            message: "Claim settled — payout released.",
            actorId: user.sub,
          },
        });
    });
    return this.get(user, id);
  }

  async settle(user: AuthUser, id: string) {
    const claim = await this.prisma.claim.findFirst({
      where: { id, ...this.scopeWhere(user) },
    });
    if (!claim) throw new NotFoundException("Claim not found");
    await this.prisma.$transaction(async (tx) => {
      await tx.claim.update({
        where: { id },
        data: { status: ClaimStatus.SETTLED, settledAt: new Date() },
      });
      await tx.claimEvent.create({
        data: {
          claimId: id,
          type: ClaimEventType.SETTLED,
          message: "Claim settled — payout released.",
          actorId: user.sub,
        },
      });
    });
    return this.get(user, id);
  }

  /** Hospital responds to a raised query; routes the claim to a human reviewer. */
  async respondQuery(user: AuthUser, id: string, message: string) {
    const claim = await this.prisma.claim.findFirst({
      where: { id, ...this.scopeWhere(user) },
    });
    if (!claim) throw new NotFoundException("Claim not found");
    await this.prisma.$transaction(async (tx) => {
      await tx.claim.update({
        where: { id },
        data: { status: ClaimStatus.UNDER_REVIEW },
      });
      await tx.claimEvent.create({
        data: {
          claimId: id,
          type: ClaimEventType.NOTE,
          message: `Hospital response: ${message}`,
          actorId: user.sub,
        },
      });
    });
    return this.get(user, id);
  }
}
