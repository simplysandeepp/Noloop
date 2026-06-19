"use client";

import { useEffect, useState } from "react";
import {
  Bot,
  ShieldAlert,
  CheckCircle2,
  Clock,
  FileText,
  ArrowRight,
} from "lucide-react";
import {
  authedGet,
  authedPost,
  inr,
  fmtTat,
  fmtDate,
} from "../lib/api";
import {
  Modal,
  StatusBadge,
  VerdictBadge,
  SeverityBadge,
} from "./ui/dash";

interface Detail {
  id: string;
  claimNumber: string;
  type: string;
  status: string;
  verdict: string | null;
  patientName: string;
  patientAge: number;
  patientGender: string;
  diagnosis: string;
  procedure: string;
  admittedAt: string;
  dischargedAt: string;
  lengthOfStayDays: number;
  sumInsuredPaise: number;
  billedPaise: number;
  approvedAmountPaise: number | null;
  confidence: number | null;
  rationale: string | null;
  aiModel: string | null;
  aiLatencyMs: number | null;
  tatSeconds: number | null;
  citedClauseRefs: string[];
  overrideNote: string | null;
  hospital: { name: string };
  insurer: { name: string };
  policy: { name: string; planCode: string } | null;
  overriddenBy: { name: string | null } | null;
  fraudFlags: { id: string; signal: string; severity: string; detail: string }[];
  events: { id: string; type: string; message: string; createdAt: string }[];
}

const isInsurer = (r: string) =>
  r === "INSURER_ADMIN" || r === "INSURER_ADJUDICATOR";
const isHospital = (r: string) =>
  r === "HOSPITAL_ADMIN" || r === "HOSPITAL_STAFF";

export default function ClaimDetail({
  claimId,
  role,
  onClose,
  onChanged,
}: {
  claimId: string;
  role: string;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [c, setC] = useState<Detail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // override form (insurer)
  const [ovVerdict, setOvVerdict] = useState("APPROVE");
  const [ovAmount, setOvAmount] = useState("");
  const [ovNote, setOvNote] = useState("");
  const [ovSettle, setOvSettle] = useState(false);
  // query response (hospital)
  const [resp, setResp] = useState("");

  async function load() {
    try {
      setC(await authedGet<Detail>(`/claims/${claimId}`));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load");
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claimId]);

  async function doOverride() {
    setBusy(true);
    setErr(null);
    try {
      await authedPost(`/claims/${claimId}/override`, {
        verdict: ovVerdict,
        approvedAmountPaise: ovAmount ? Math.round(Number(ovAmount) * 100) : undefined,
        note: ovNote || "Manual adjudication.",
        settle: ovSettle,
      });
      await load();
      onChanged?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Override failed");
    } finally {
      setBusy(false);
    }
  }

  async function doSettle() {
    setBusy(true);
    try {
      await authedPost(`/claims/${claimId}/settle`);
      await load();
      onChanged?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Settle failed");
    } finally {
      setBusy(false);
    }
  }

  async function doRespond() {
    if (!resp.trim()) return;
    setBusy(true);
    try {
      await authedPost(`/claims/${claimId}/respond`, { message: resp });
      setResp("");
      await load();
      onChanged?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const fieldCls =
    "w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100";

  return (
    <Modal
      wide
      onClose={onClose}
      title={
        c ? (
          <span className="flex items-center gap-2.5 flex-wrap">
            <span className="font-mono text-sm text-slate-500">{c.claimNumber}</span>
            <StatusBadge status={c.status} />
          </span>
        ) : (
          "Claim"
        )
      }
    >
      {!c ? (
        <p className="text-slate-400 text-sm">{err ?? "Loading…"}</p>
      ) : (
        <div className="space-y-5">
          {/* Summary grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <Field label="Patient" value={`${c.patientName}, ${c.patientAge}${c.patientGender}`} />
            <Field label="Procedure" value={c.procedure} />
            <Field label="Hospital" value={c.hospital.name} />
            <Field label="Insurer" value={c.insurer.name} />
            <Field label="Stay" value={`${c.lengthOfStayDays} day(s)`} />
            <Field label="Sum insured" value={inr(c.sumInsuredPaise)} />
            <Field label="Billed" value={inr(c.billedPaise)} />
            <Field
              label="Approved"
              value={inr(c.approvedAmountPaise)}
              strong={c.verdict === "APPROVE"}
            />
          </div>

          {/* AI decision */}
          <div className="rounded-xl border border-sky-100 bg-sky-50/50 p-4">
            <div className="flex items-center gap-2 mb-2">
              <Bot className="w-4 h-4 text-sky-600" />
              <span className="font-bold text-slate-800 text-sm">AI Adjudication</span>
              <VerdictBadge verdict={c.verdict} />
              {c.confidence != null && (
                <span className="text-xs text-slate-500">
                  {Math.round(c.confidence * 100)}% confidence
                </span>
              )}
              <span className="ml-auto text-xs text-slate-400 flex items-center gap-1">
                <Clock className="w-3 h-3" /> TAT {fmtTat(c.tatSeconds)}
                {c.aiLatencyMs != null && ` · ${c.aiLatencyMs}ms`}
              </span>
            </div>
            <p className="text-sm text-slate-700 leading-relaxed">{c.rationale}</p>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              {c.citedClauseRefs.map((r) => (
                <span
                  key={r}
                  className="text-[10px] font-semibold bg-white border border-slate-200 rounded px-1.5 py-0.5 text-slate-500"
                >
                  <FileText className="w-2.5 h-2.5 inline mr-0.5" />
                  {r}
                </span>
              ))}
              {c.aiModel && (
                <span className="text-[10px] text-slate-400 ml-auto">{c.aiModel}</span>
              )}
            </div>
          </div>

          {/* Fraud flags */}
          {c.fraudFlags.length > 0 && (
            <div>
              <p className="flex items-center gap-1.5 font-bold text-slate-800 text-sm mb-2">
                <ShieldAlert className="w-4 h-4 text-amber-600" />
                Anomaly signals ({c.fraudFlags.length})
              </p>
              <div className="space-y-1.5">
                {c.fraudFlags.map((f) => (
                  <div
                    key={f.id}
                    className="flex items-start gap-2 text-sm bg-white border border-slate-100 rounded-lg px-3 py-2"
                  >
                    <SeverityBadge severity={f.severity} />
                    <div>
                      <span className="font-semibold text-slate-700">{f.signal}</span>
                      <p className="text-slate-500 text-xs">{f.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Timeline */}
          <div>
            <p className="font-bold text-slate-800 text-sm mb-2">Timeline</p>
            <ol className="relative border-l border-slate-200 ml-2 space-y-3">
              {c.events.map((e) => (
                <li key={e.id} className="ml-4">
                  <span className="absolute -left-[5px] mt-1.5 w-2.5 h-2.5 rounded-full bg-sky-500" />
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-700">
                      {e.type.replace(/_/g, " ")}
                    </span>
                    <span className="text-[10px] text-slate-400">{fmtDate(e.createdAt)}</span>
                  </div>
                  <p className="text-xs text-slate-500">{e.message}</p>
                </li>
              ))}
            </ol>
          </div>

          {c.overriddenBy && (
            <p className="text-xs text-indigo-600 bg-indigo-50 rounded-lg px-3 py-2">
              Overridden by {c.overriddenBy.name}. {c.overrideNote}
            </p>
          )}

          {/* Actions */}
          {isInsurer(role) && c.status !== "SETTLED" && (
            <div className="rounded-xl border border-slate-200 p-4 space-y-3">
              <p className="font-bold text-slate-800 text-sm">Adjudicator override</p>
              <div className="grid grid-cols-2 gap-3">
                <select
                  value={ovVerdict}
                  onChange={(e) => setOvVerdict(e.target.value)}
                  className={fieldCls}
                >
                  <option value="APPROVE">Approve</option>
                  <option value="DENY">Deny</option>
                  <option value="QUERY">Send back (query)</option>
                </select>
                <input
                  className={fieldCls}
                  placeholder="Approved amount (₹)"
                  value={ovAmount}
                  onChange={(e) => setOvAmount(e.target.value)}
                  type="number"
                  disabled={ovVerdict !== "APPROVE"}
                />
              </div>
              <input
                className={fieldCls}
                placeholder="Reason / note"
                value={ovNote}
                onChange={(e) => setOvNote(e.target.value)}
              />
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={ovSettle}
                  onChange={(e) => setOvSettle(e.target.checked)}
                />
                Mark as settled (release payout)
              </label>
              <div className="flex gap-2">
                <button
                  onClick={doOverride}
                  disabled={busy}
                  className="px-4 py-2 rounded-xl text-sm font-bold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-60"
                >
                  {busy ? "Saving…" : "Apply override"}
                </button>
                {(c.status === "APPROVED") && (
                  <button
                    onClick={doSettle}
                    disabled={busy}
                    className="px-4 py-2 rounded-xl text-sm font-bold text-emerald-700 bg-emerald-50 border border-emerald-100 hover:bg-emerald-100 disabled:opacity-60 inline-flex items-center gap-1"
                  >
                    <CheckCircle2 className="w-4 h-4" /> Settle
                  </button>
                )}
              </div>
            </div>
          )}

          {isHospital(role) &&
            (c.status === "QUERIED" || c.status === "UNDER_REVIEW") && (
              <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4 space-y-2">
                <p className="font-bold text-slate-800 text-sm">Respond to query</p>
                <textarea
                  className={fieldCls}
                  rows={2}
                  placeholder="Provide the requested clarification / documents…"
                  value={resp}
                  onChange={(e) => setResp(e.target.value)}
                />
                <button
                  onClick={doRespond}
                  disabled={busy || !resp.trim()}
                  className="px-4 py-2 rounded-xl text-sm font-bold text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-60 inline-flex items-center gap-1"
                >
                  Submit response <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            )}

          {err && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{err}</p>
          )}
        </div>
      )}
    </Modal>
  );
}

function Field({
  label,
  value,
  strong,
}: {
  label: string;
  value: React.ReactNode;
  strong?: boolean;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
        {label}
      </p>
      <p className={`text-slate-800 ${strong ? "font-bold text-emerald-700" : "font-medium"}`}>
        {value}
      </p>
    </div>
  );
}
