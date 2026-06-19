"use client";

import { useState } from "react";
import Link from "next/link";
import { Search, Bot, Building2, ShieldCheck, ArrowLeft } from "lucide-react";
import Logo from "../../components/ui/Logo";
import { publicGet, inr, fmtTat, fmtDate, ApiError } from "../../lib/api";
import { StatusBadge, VerdictBadge } from "../../components/ui/dash";

export default function PatientTrackPage() {
  const [num, setNum] = useState("");
  const [claim, setClaim] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setClaim(null);
    try {
      setClaim(await publicGet<any>(`/track/${num.trim()}`));
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : "Could not find that claim");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#FBF8F3]">
      <header className="bg-white/95 backdrop-blur border-b border-sky-100">
        <div className="max-w-3xl mx-auto px-6 h-16 flex items-center justify-between">
          <Logo size={34} />
          <Link href="/" className="text-sm font-semibold text-slate-500 hover:text-sky-700 flex items-center gap-1">
            <ArrowLeft className="w-4 h-4" /> Home
          </Link>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-6 py-10">
        <h1 className="text-3xl font-black text-slate-900 tracking-tight">Track your claim</h1>
        <p className="text-slate-500 mt-1.5">
          Enter the claim number your hospital shared to follow it in real time.
        </p>

        <form onSubmit={search} className="mt-6 flex gap-2 max-w-md">
          <input
            value={num}
            onChange={(e) => setNum(e.target.value)}
            placeholder="e.g. CLM-200001"
            className="flex-1 px-4 py-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
            required
          />
          <button
            disabled={busy}
            className="px-5 py-3 rounded-xl text-sm font-bold text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-60 inline-flex items-center gap-2"
          >
            <Search className="w-4 h-4" /> {busy ? "…" : "Track"}
          </button>
        </form>

        {err && <p className="mt-4 text-sm text-red-600 bg-red-50 rounded-xl px-4 py-3 max-w-md">{err}</p>}

        {claim && (
          <div className="mt-8 space-y-5">
            <div className="bg-white border border-sky-100 rounded-2xl p-6 shadow-sm">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="font-mono text-sm text-slate-500">{claim.claimNumber}</span>
                <StatusBadge status={claim.status} />
                <VerdictBadge verdict={claim.verdict} />
              </div>
              <h2 className="text-xl font-black text-slate-900 mt-3">{claim.patientName}</h2>
              <p className="text-sm text-slate-500">{claim.procedure}</p>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-5 text-sm">
                <Info icon={Building2} label="Hospital" value={claim.hospital} />
                <Info icon={ShieldCheck} label="Insurer" value={claim.insurer} />
                <Info label="Billed" value={inr(claim.billedPaise)} />
                <Info label="Approved" value={inr(claim.approvedAmountPaise)} strong={claim.verdict === "APPROVE"} />
              </div>

              {claim.rationale && (
                <div className="mt-5 rounded-xl bg-sky-50/60 border border-sky-100 p-4">
                  <p className="flex items-center gap-1.5 text-xs font-bold text-sky-700 mb-1">
                    <Bot className="w-3.5 h-3.5" /> Decision explained · resolved in {fmtTat(claim.tatSeconds)}
                  </p>
                  <p className="text-sm text-slate-700 leading-relaxed">{claim.rationale}</p>
                </div>
              )}
            </div>

            <div className="bg-white border border-sky-100 rounded-2xl p-6 shadow-sm">
              <p className="font-bold text-slate-800 text-sm mb-4">Progress</p>
              <ol className="relative border-l-2 border-slate-100 ml-2 space-y-4">
                {claim.events.map((e: any) => (
                  <li key={e.id} className="ml-5">
                    <span className="absolute -left-[7px] mt-1 w-3 h-3 rounded-full bg-sky-500 ring-4 ring-sky-50" />
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-slate-800">{e.type.replace(/_/g, " ")}</span>
                      <span className="text-[11px] text-slate-400">{fmtDate(e.createdAt)}</span>
                    </div>
                    <p className="text-sm text-slate-500">{e.message}</p>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

function Info({ icon: Icon, label, value, strong }: any) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold flex items-center gap-1">
        {Icon && <Icon className="w-3 h-3" />} {label}
      </p>
      <p className={`mt-0.5 ${strong ? "font-bold text-emerald-700" : "font-medium text-slate-800"}`}>{value}</p>
    </div>
  );
}
