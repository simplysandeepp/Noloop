"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, Trash2, Bot, Sparkles, Clock, ScanLine, Loader2 } from "lucide-react";
import { authedGet, authedPost, inr, fmtTat, API_URL, getToken } from "../lib/api";
import { VerdictBadge, SeverityBadge } from "./ui/dash";

interface Insurer {
  id: string;
  name: string;
  policy: {
    name: string;
    sumInsuredPaise: number;
    coveredProcedures: string[];
    exclusions: string[];
  } | null;
}
interface Line {
  desc: string;
  amount: string; // rupees, as string
}

const todayMinus = (d: number) =>
  new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);

export default function SubmitClaimForm({ onSubmitted }: { onSubmitted?: () => void }) {
  const [insurers, setInsurers] = useState<Insurer[]>([]);
  const [insurerId, setInsurerId] = useState("");
  const [patientName, setPatientName] = useState("");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState("M");
  const [procedure, setProcedure] = useState("");
  const [admittedAt, setAdmittedAt] = useState(todayMinus(3));
  const [dischargedAt, setDischargedAt] = useState(todayMinus(1));
  const [lines, setLines] = useState<Line[]>([
    { desc: "Room charges (2 days)", amount: "12000" },
    { desc: "Procedure", amount: "55000" },
    { desc: "Medicines & consumables", amount: "8000" },
  ]);
  const [overrideTotal, setOverrideTotal] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function scanDocument(file: File) {
    setScanning(true);
    setScanNote(null);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`${API_URL}/claims/extract`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken() ?? ""}` },
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message ?? "Scan failed");
      if (data.patientName) setPatientName(data.patientName);
      if (data.patientAge != null) setAge(String(data.patientAge));
      if (data.patientGender) setGender(data.patientGender);
      if (data.procedure) setProcedure(data.procedure);
      if (data.admittedAt) setAdmittedAt(data.admittedAt);
      if (data.dischargedAt) setDischargedAt(data.dischargedAt);
      if (Array.isArray(data.lineItems) && data.lineItems.length)
        setLines(
          data.lineItems.map((li: any) => ({
            desc: li.desc,
            amount: String(Math.round(li.amountPaise / 100)),
          })),
        );
      setScanNote(data.note ?? "Scanned.");
    } catch (e) {
      setScanNote(e instanceof Error ? e.message : "Scan failed");
    } finally {
      setScanning(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  useEffect(() => {
    authedGet<Insurer[]>("/catalog/insurers")
      .then((list) => {
        const withPolicy = list.filter((i) => i.policy);
        setInsurers(withPolicy);
        if (withPolicy[0]) setInsurerId(withPolicy[0].id);
      })
      .catch(() => {});
  }, []);

  const selected = insurers.find((i) => i.id === insurerId);

  function setLine(i: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const lineItems = lines
        .filter((l) => l.desc && l.amount)
        .map((l) => ({ desc: l.desc, amountPaise: Math.round(Number(l.amount) * 100) }));
      const body: any = {
        insurerTenantId: insurerId,
        patientName,
        patientAge: Number(age || 30),
        patientGender: gender,
        diagnosis: `${procedure} indicated`,
        procedure,
        admittedAt,
        dischargedAt,
        lineItems,
      };
      if (overrideTotal) body.totalPaise = Math.round(Number(overrideTotal) * 100);
      const claim = await authedPost<any>("/claims", body);
      setResult(claim);
      onSubmitted?.();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Submission failed");
    } finally {
      setBusy(false);
    }
  }

  const field =
    "w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100";

  if (result) {
    const verdictTone =
      result.verdict === "APPROVE"
        ? "from-emerald-50 to-white border-emerald-200"
        : result.verdict === "DENY"
          ? "from-red-50 to-white border-red-200"
          : "from-amber-50 to-white border-amber-200";
    return (
      <div className={`rounded-2xl border bg-gradient-to-b ${verdictTone} p-6 shadow-sm`}>
        <div className="flex items-center gap-2 mb-3">
          <Bot className="w-5 h-5 text-sky-600" />
          <span className="font-bold text-slate-800">AI decision</span>
          <VerdictBadge verdict={result.verdict} />
          <span className="ml-auto text-xs text-slate-500 flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" /> adjudicated in {fmtTat(result.tatSeconds)}
            {result.aiLatencyMs != null && ` (${result.aiLatencyMs}ms engine)`}
          </span>
        </div>
        <p className="font-mono text-sm text-slate-500 mb-1">{result.claimNumber}</p>
        <p className="text-2xl font-black text-slate-900">
          {result.verdict === "APPROVE" ? inr(result.approvedAmountPaise) : "—"}
          <span className="text-sm font-medium text-slate-500 ml-2">
            of {inr(result.billedPaise)} billed
          </span>
        </p>
        <p className="text-sm text-slate-700 mt-2 leading-relaxed">{result.rationale}</p>
        {result.fraudFlags?.length > 0 && (
          <div className="mt-3 space-y-1.5">
            {result.fraudFlags.map((f: any, i: number) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <SeverityBadge severity={f.severity} />
                <span className="font-semibold text-slate-700">{f.signal}</span>
                <span className="text-slate-500">{f.detail}</span>
              </div>
            ))}
          </div>
        )}
        <button
          onClick={() => {
            setResult(null);
            setPatientName("");
          }}
          className="mt-5 px-4 py-2 rounded-xl text-sm font-bold text-white bg-sky-600 hover:bg-sky-700"
        >
          Submit another claim
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="bg-white border border-sky-100 rounded-2xl p-6 shadow-sm space-y-4">
      <div className="flex items-center gap-2 text-sky-700">
        <Sparkles className="w-5 h-5" />
        <h2 className="text-lg font-bold text-slate-900">File a cashless claim</h2>
      </div>
      <p className="text-sm text-slate-500 -mt-2">
        The AI engine adjudicates instantly — coverage, fraud checks, and a payable amount.
      </p>

      {/* Document scan (Groq vision OCR) */}
      <div className="rounded-xl border border-dashed border-sky-200 bg-sky-50/40 p-3 flex items-center gap-3 flex-wrap">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && scanDocument(e.target.files[0])}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={scanning}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-bold text-sky-700 bg-white border border-sky-200 hover:bg-sky-50 disabled:opacity-60"
        >
          {scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanLine className="w-4 h-4" />}
          {scanning ? "Reading document…" : "Scan a bill / discharge (image)"}
        </button>
        <span className="text-xs text-slate-500">
          Upload a photo — Groq vision auto-fills the fields below.
        </span>
        {scanNote && <span className="text-xs text-slate-600 w-full">{scanNote}</span>}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="text-sm">
          <span className="block font-semibold text-slate-700 mb-1">Insurer</span>
          <select className={field} value={insurerId} onChange={(e) => setInsurerId(e.target.value)} required>
            {insurers.length === 0 && <option value="">No insurers with a policy</option>}
            {insurers.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name} — {i.policy?.name} ({inr(i.policy?.sumInsuredPaise)} SI)
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="block font-semibold text-slate-700 mb-1">Procedure</span>
          <input
            className={field}
            list="procedures"
            value={procedure}
            onChange={(e) => setProcedure(e.target.value)}
            placeholder="e.g. Appendectomy"
            required
          />
          <datalist id="procedures">
            {selected?.policy?.coveredProcedures.map((p) => <option key={p} value={p} />)}
            {selected?.policy?.exclusions.map((p) => <option key={p} value={p} />)}
          </datalist>
        </label>
      </div>

      {selected?.policy && (
        <p className="text-xs text-slate-400 -mt-1">
          Covered: {selected.policy.coveredProcedures.join(", ")} · Excluded:{" "}
          {selected.policy.exclusions.join(", ")}
        </p>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <label className="text-sm md:col-span-2">
          <span className="block font-semibold text-slate-700 mb-1">Patient name</span>
          <input className={field} value={patientName} onChange={(e) => setPatientName(e.target.value)} required />
        </label>
        <label className="text-sm">
          <span className="block font-semibold text-slate-700 mb-1">Age</span>
          <input className={field} type="number" value={age} onChange={(e) => setAge(e.target.value)} placeholder="30" />
        </label>
        <label className="text-sm">
          <span className="block font-semibold text-slate-700 mb-1">Gender</span>
          <select className={field} value={gender} onChange={(e) => setGender(e.target.value)}>
            <option>M</option>
            <option>F</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="block font-semibold text-slate-700 mb-1">Admitted</span>
          <input className={field} type="date" value={admittedAt} onChange={(e) => setAdmittedAt(e.target.value)} />
        </label>
        <label className="text-sm">
          <span className="block font-semibold text-slate-700 mb-1">Discharged</span>
          <input className={field} type="date" value={dischargedAt} onChange={(e) => setDischargedAt(e.target.value)} />
        </label>
      </div>

      <div>
        <span className="block font-semibold text-slate-700 text-sm mb-1.5">Bill line items</span>
        <div className="space-y-2">
          {lines.map((l, i) => (
            <div key={i} className="flex gap-2">
              <input
                className={`${field} flex-1`}
                value={l.desc}
                onChange={(e) => setLine(i, { desc: e.target.value })}
                placeholder="Description"
              />
              <input
                className={`${field} w-32`}
                type="number"
                value={l.amount}
                onChange={(e) => setLine(i, { amount: e.target.value })}
                placeholder="₹"
              />
              <button
                type="button"
                onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}
                className="px-2 text-slate-400 hover:text-red-600"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setLines((ls) => [...ls, { desc: "", amount: "" }])}
          className="mt-2 text-sm font-semibold text-sky-600 hover:text-sky-700 inline-flex items-center gap-1"
        >
          <Plus className="w-4 h-4" /> Add line
        </button>
      </div>

      <label className="text-sm block">
        <span className="block font-semibold text-slate-700 mb-1">
          Stated total override (₹) — optional
        </span>
        <input
          className={`${field} max-w-xs`}
          type="number"
          value={overrideTotal}
          onChange={(e) => setOverrideTotal(e.target.value)}
          placeholder="Leave blank to sum line items"
        />
        <span className="text-xs text-slate-400 mt-1 block">
          A value that disagrees with the line items triggers a fraud flag — try it.
        </span>
      </label>

      {err && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{err}</p>}

      <button
        disabled={busy || !insurerId}
        className="px-6 py-3 rounded-xl text-sm font-bold text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-60 inline-flex items-center gap-2"
      >
        {busy ? (
          <>
            <Bot className="w-4 h-4 animate-pulse" /> AI adjudicating…
          </>
        ) : (
          <>
            <Sparkles className="w-4 h-4" /> Submit & adjudicate
          </>
        )}
      </button>
    </form>
  );
}
