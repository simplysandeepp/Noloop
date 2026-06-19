"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  LayoutDashboard,
  BedDouble,
  FilePlus2,
  ListChecks,
  Users,
  Activity,
  Clock,
  CheckCircle2,
  IndianRupee,
  UserPlus,
  LogOut as LogOutIcon,
} from "lucide-react";
import PortalShell from "./PortalShell";
import SubmitClaimForm from "./SubmitClaimForm";
import ClaimDetail from "./ClaimDetail";
import {
  authedGet,
  authedPost,
  ApiError,
  inr,
  inrCompact,
  fmtTat,
  fmtDate,
  fmtDay,
  getUser,
} from "../lib/api";
import { StatCard, StatusBadge, VerdictBadge, Bars, SectionTitle } from "./ui/dash";

type Tab = "overview" | "beds" | "new" | "claims" | "team";

export default function HospitalPortal() {
  const router = useRouter();
  const role = getUser()?.role ?? "HOSPITAL_STAFF";
  const [tab, setTab] = useState<Tab>("overview");
  const [metrics, setMetrics] = useState<any>(null);
  const [beds, setBeds] = useState<any>(null);
  const [claims, setClaims] = useState<any[]>([]);
  const [team, setTeam] = useState<{ overview: any; employees: any[] } | null>(null);
  const [openClaim, setOpenClaim] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [m, b, c] = await Promise.all([
        authedGet<any>("/metrics"),
        authedGet<any>("/beds/overview"),
        authedGet<any[]>("/claims"),
      ]);
      setMetrics(m);
      setBeds(b);
      setClaims(c);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403))
        router.replace("/login");
      else setErr(e instanceof Error ? e.message : "Failed to load");
    }
  }, [router]);

  useEffect(() => {
    refresh();
    authedGet<any>("/org/overview")
      .then((o) => authedGet<any[]>("/org/employees").then((e) => setTeam({ overview: o, employees: e })))
      .catch(() => {});
  }, [refresh]);

  const TABS: { id: Tab; label: string; icon: any }[] = [
    { id: "overview", label: "Overview", icon: LayoutDashboard },
    { id: "beds", label: "Beds", icon: BedDouble },
    { id: "new", label: "New claim", icon: FilePlus2 },
    { id: "claims", label: "Claims", icon: ListChecks },
    { id: "team", label: "Team", icon: Users },
  ];

  return (
    <PortalShell>
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-2xl font-black text-slate-900 tracking-tight">
          {beds || metrics ? team?.overview?.name ?? "Hospital" : "Hospital"}
        </h1>
        <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-sky-100 text-sky-700">
          HOSPITAL
        </span>
      </div>

      {/* Tabs */}
      <div className="mt-5 flex gap-1 border-b border-slate-200 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-3.5 py-2.5 text-sm font-semibold border-b-2 -mb-px whitespace-nowrap transition ${
              tab === t.id
                ? "border-sky-600 text-sky-700"
                : "border-transparent text-slate-500 hover:text-sky-700"
            }`}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {tab === "overview" && <Overview metrics={metrics} beds={beds} onOpen={setOpenClaim} />}
        {tab === "beds" && <BedsTab beds={beds} refresh={refresh} />}
        {tab === "new" && (
          <div className="max-w-3xl">
            <SubmitClaimForm onSubmitted={refresh} />
          </div>
        )}
        {tab === "claims" && <ClaimsTable claims={claims} onOpen={setOpenClaim} />}
        {tab === "team" && <TeamTab team={team} reload={() => authedGet<any>("/org/overview").then((o) => authedGet<any[]>("/org/employees").then((e) => setTeam({ overview: o, employees: e })))} />}
      </div>

      {err && (
        <p className="mt-6 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{err}</p>
      )}

      {openClaim && (
        <ClaimDetail
          claimId={openClaim}
          role={role}
          onClose={() => setOpenClaim(null)}
          onChanged={refresh}
        />
      )}
    </PortalShell>
  );
}

function Overview({ metrics, beds, onOpen }: any) {
  if (!metrics) return <p className="text-slate-400 text-sm">Loading…</p>;
  const m = metrics;
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={Activity} label="Claims submitted" value={m.totals.claims} tint="text-sky-600" />
        <StatCard
          icon={CheckCircle2}
          label="Approval rate"
          value={`${m.rates.approvalPct}%`}
          sub={`${m.totals.approved} approved · ${m.totals.queried} queried`}
          tint="text-emerald-600"
        />
        <StatCard icon={Clock} label="Avg turnaround" value={fmtTat(m.tat.avgSeconds)} sub="AI adjudication" tint="text-amber-600" />
        <StatCard
          icon={IndianRupee}
          label="Approved value"
          value={inrCompact(m.money.approvedPaise)}
          sub={`of ${inrCompact(m.money.billedPaise)} billed`}
          tint="text-teal-600"
        />
      </div>

      {beds && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
          <StatCard icon={BedDouble} label="Total beds" value={beds.totalBeds} tint="text-slate-600" />
          <StatCard icon={BedDouble} label="Available" value={beds.available} tint="text-emerald-600" />
          <StatCard icon={BedDouble} label="Occupied" value={beds.occupied} tint="text-sky-600" />
          <StatCard icon={Activity} label="Occupancy" value={`${beds.occupancyRate}%`} tint="text-amber-600" />
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4 mt-6">
        <div className="bg-white border border-sky-100 rounded-2xl p-5 shadow-sm">
          <p className="font-bold text-slate-800 text-sm mb-3">Claims — last 7 days</p>
          <Bars data={m.trend.map((d: any) => d.count)} labels={m.trend.map((d: any) => fmtDay(d.date))} />
        </div>
        <div className="bg-white border border-sky-100 rounded-2xl p-5 shadow-sm">
          <p className="font-bold text-slate-800 text-sm mb-3">Money protected by AI checks</p>
          <p className="text-3xl font-black text-slate-900">{inr(m.money.savedPaise)}</p>
          <p className="text-xs text-slate-500 mt-1">
            Billed minus approved across decided claims — over-claims, exclusions and bill errors caught.
          </p>
          <p className="text-xs text-slate-400 mt-3">Fraud-flag rate: {m.rates.fraudPct}%</p>
        </div>
      </div>

      <SectionTitle>Recent claims</SectionTitle>
      <ClaimsTable claims={m.recent.map((r: any) => ({ ...r, id: undefined }))} onOpen={onOpen} recent />
    </>
  );
}

function ClaimsTable({ claims, onOpen, recent }: { claims: any[]; onOpen: (id: string) => void; recent?: boolean }) {
  return (
    <div className="bg-white border border-sky-100 rounded-2xl overflow-hidden shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-slate-500">
              {["Claim #", "Patient", "Procedure", "Billed", "Approved", "Status", "TAT", "Flags"].map((h) => (
                <th key={h} className="text-left font-semibold text-xs uppercase tracking-wider px-4 py-3 border-b border-slate-100">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {claims.map((c, i) => (
              <tr
                key={c.id ?? c.claimNumber ?? i}
                className={`hover:bg-sky-50/50 ${c.id ? "cursor-pointer" : ""}`}
                onClick={() => c.id && onOpen(c.id)}
              >
                <td className="px-4 py-3 border-b border-slate-50 font-mono text-xs text-slate-600">{c.claimNumber}</td>
                <td className="px-4 py-3 border-b border-slate-50">{c.patientName}</td>
                <td className="px-4 py-3 border-b border-slate-50 text-slate-600">{c.procedure}</td>
                <td className="px-4 py-3 border-b border-slate-50 tabular-nums">{inr(c.billedPaise)}</td>
                <td className="px-4 py-3 border-b border-slate-50 tabular-nums font-medium">{inr(c.approvedAmountPaise)}</td>
                <td className="px-4 py-3 border-b border-slate-50"><StatusBadge status={c.status} /></td>
                <td className="px-4 py-3 border-b border-slate-50 text-slate-500">{fmtTat(c.tatSeconds)}</td>
                <td className="px-4 py-3 border-b border-slate-50">
                  {c.fraudFlagCount || c.flagCount ? (
                    <span className="text-xs font-bold text-amber-600">{c.fraudFlagCount ?? c.flagCount}</span>
                  ) : (
                    <span className="text-slate-300">0</span>
                  )}
                </td>
              </tr>
            ))}
            {claims.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-slate-400">No claims yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BedsTab({ beds, refresh }: { beds: any; refresh: () => void }) {
  const [form, setForm] = useState({ patientName: "", patientAge: "", patientGender: "M", diagnosis: "", procedure: "", wardId: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!beds) return <p className="text-slate-400 text-sm">Loading…</p>;

  async function admit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await authedPost("/beds/admit", {
        patientName: form.patientName,
        patientAge: Number(form.patientAge || 30),
        patientGender: form.patientGender,
        diagnosis: form.diagnosis || `${form.procedure} indicated`,
        procedure: form.procedure,
        wardId: form.wardId || undefined,
      });
      setForm({ patientName: "", patientAge: "", patientGender: "M", diagnosis: "", procedure: "", wardId: "" });
      refresh();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Failed");
    } finally {
      setBusy(false);
    }
  }
  async function discharge(id: string) {
    await authedPost(`/beds/discharge/${id}`);
    refresh();
  }

  const field = "w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100";

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <StatCard icon={BedDouble} label="Total beds" value={beds.totalBeds} tint="text-slate-600" />
        <StatCard icon={BedDouble} label="Available" value={beds.available} tint="text-emerald-600" />
        <StatCard icon={BedDouble} label="Occupied" value={beds.occupied} tint="text-sky-600" />
        <StatCard icon={Activity} label="Occupancy" value={`${beds.occupancyRate}%`} tint="text-amber-600" />
      </div>

      <div className="grid md:grid-cols-4 gap-3 mb-6">
        {beds.wards.map((w: any) => (
          <div key={w.id} className="bg-white border border-sky-100 rounded-xl p-4 shadow-sm">
            <p className="font-bold text-slate-800 text-sm">{w.name}</p>
            <p className="text-2xl font-black text-slate-900 mt-1">
              {w.available}<span className="text-sm font-medium text-slate-400">/{w.totalBeds} free</span>
            </p>
            <div className="mt-2 h-1.5 rounded-full bg-slate-100 overflow-hidden">
              <div className="h-full bg-sky-500" style={{ width: `${(w.occupied / Math.max(1, w.totalBeds)) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>

      <form onSubmit={admit} className="bg-white border border-sky-100 rounded-2xl p-5 shadow-sm mb-6">
        <p className="flex items-center gap-2 font-bold text-slate-900 mb-3">
          <UserPlus className="w-5 h-5 text-sky-600" /> Admit a patient
        </p>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2 items-end">
          <input className={`${field} md:col-span-2`} placeholder="Patient name" value={form.patientName} onChange={(e) => setForm({ ...form, patientName: e.target.value })} required />
          <input className={field} type="number" placeholder="Age" value={form.patientAge} onChange={(e) => setForm({ ...form, patientAge: e.target.value })} />
          <select className={field} value={form.patientGender} onChange={(e) => setForm({ ...form, patientGender: e.target.value })}><option>M</option><option>F</option></select>
          <input className={`${field} md:col-span-2`} placeholder="Procedure" value={form.procedure} onChange={(e) => setForm({ ...form, procedure: e.target.value })} required />
          <select className={`${field} md:col-span-2`} value={form.wardId} onChange={(e) => setForm({ ...form, wardId: e.target.value })}>
            <option value="">Any ward with a free bed</option>
            {beds.wards.map((w: any) => <option key={w.id} value={w.id} disabled={w.available === 0}>{w.name} ({w.available} free)</option>)}
          </select>
          <input className={`${field} md:col-span-2`} placeholder="Diagnosis (optional)" value={form.diagnosis} onChange={(e) => setForm({ ...form, diagnosis: e.target.value })} />
          <button disabled={busy} className="md:col-span-2 px-4 py-2 rounded-xl text-sm font-bold text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-60">
            {busy ? "Admitting…" : "Admit"}
          </button>
        </div>
        {err && <p className="text-sm text-red-600 mt-2">{err}</p>}
      </form>

      <SectionTitle>Current inpatients ({beds.patients.length})</SectionTitle>
      <div className="bg-white border border-sky-100 rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-slate-500">
                {["Patient", "Ward", "Bed", "Diagnosis", "Admitted", ""].map((h) => (
                  <th key={h} className="text-left font-semibold text-xs uppercase tracking-wider px-4 py-3 border-b border-slate-100">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {beds.patients.map((p: any) => (
                <tr key={p.admissionId} className="hover:bg-slate-50">
                  <td className="px-4 py-3 border-b border-slate-50 font-medium">{p.patientName} <span className="text-slate-400 text-xs">{p.patientAge}{p.patientGender}</span></td>
                  <td className="px-4 py-3 border-b border-slate-50 text-slate-600">{p.ward}</td>
                  <td className="px-4 py-3 border-b border-slate-50 font-mono text-xs">{p.bed}</td>
                  <td className="px-4 py-3 border-b border-slate-50 text-slate-600">{p.diagnosis}</td>
                  <td className="px-4 py-3 border-b border-slate-50 text-slate-400 text-xs">{fmtDate(p.admittedAt)}</td>
                  <td className="px-4 py-3 border-b border-slate-50">
                    <button onClick={() => discharge(p.admissionId)} className="text-xs font-semibold text-rose-600 hover:text-rose-700">Discharge</button>
                  </td>
                </tr>
              ))}
              {beds.patients.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-400">No inpatients.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function TeamTab({ team, reload }: { team: any; reload: () => Promise<any> }) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (!team) return <p className="text-slate-400 text-sm">Loading…</p>;

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null); setMsg(null);
    try {
      const emp = await authedPost<any>("/org/employees", { name, password });
      setMsg(`Created ${emp.email}`);
      setName(""); setPassword("");
      await reload();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Failed");
    } finally { setBusy(false); }
  }
  const field = "px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100";

  return (
    <>
      <form onSubmit={add} className="bg-white border border-sky-100 rounded-2xl p-5 shadow-sm mb-6">
        <p className="flex items-center gap-2 font-bold text-slate-900 mb-3"><UserPlus className="w-5 h-5 text-sky-600" /> Add staff</p>
        <div className="flex gap-2 flex-wrap items-center">
          <input className={`${field} flex-1 min-w-[160px]`} placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} minLength={2} required />
          <input className={`${field} flex-1 min-w-[160px]`} type="password" placeholder="Temp password (8+)" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required />
          <button disabled={busy} className="px-5 py-2 rounded-xl text-sm font-bold text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-60">{busy ? "Creating…" : "Create"}</button>
        </div>
        {msg && <p className="text-sm text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2 mt-3">{msg}</p>}
        {err && <p className="text-sm text-red-600 mt-2">{err}</p>}
      </form>
      <div className="bg-white border border-sky-100 rounded-2xl overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-50 text-slate-500">{["Name", "Email", "Role"].map((h) => <th key={h} className="text-left font-semibold text-xs uppercase tracking-wider px-4 py-3 border-b border-slate-100">{h}</th>)}</tr></thead>
          <tbody>
            {team.employees.map((u: any) => (
              <tr key={u.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 border-b border-slate-50">{u.name ?? "—"}</td>
                <td className="px-4 py-3 border-b border-slate-50">{u.email}</td>
                <td className="px-4 py-3 border-b border-slate-50"><span className="text-xs font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">{u.role}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
