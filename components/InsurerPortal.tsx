"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  LayoutDashboard,
  ClipboardCheck,
  ScrollText,
  UsersRound,
  Users,
  Activity,
  Clock,
  ShieldAlert,
  IndianRupee,
  CheckCircle2,
  UserPlus,
  Bot,
} from "lucide-react";
import PortalShell from "./PortalShell";
import ClaimDetail from "./ClaimDetail";
import {
  authedGet,
  authedPost,
  ApiError,
  inr,
  inrCompact,
  fmtTat,
  fmtDay,
  getUser,
} from "../lib/api";
import { StatCard, StatusBadge, VerdictBadge, Bars, SectionTitle } from "./ui/dash";

type Tab = "dashboard" | "review" | "policies" | "patients" | "team";

export default function InsurerPortal() {
  const router = useRouter();
  const role = getUser()?.role ?? "INSURER_ADJUDICATOR";
  const [tab, setTab] = useState<Tab>("dashboard");
  const [metrics, setMetrics] = useState<any>(null);
  const [claims, setClaims] = useState<any[]>([]);
  const [policies, setPolicies] = useState<any[]>([]);
  const [patients, setPatients] = useState<any[]>([]);
  const [team, setTeam] = useState<{ overview: any; employees: any[] } | null>(null);
  const [openClaim, setOpenClaim] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [m, c] = await Promise.all([
        authedGet<any>("/metrics"),
        authedGet<any[]>("/claims"),
      ]);
      setMetrics(m);
      setClaims(c);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403))
        router.replace("/login");
      else setErr(e instanceof Error ? e.message : "Failed to load");
    }
  }, [router]);

  useEffect(() => {
    refresh();
    authedGet<any[]>("/insurer/policies").then(setPolicies).catch(() => {});
    authedGet<any[]>("/insurer/patients").then(setPatients).catch(() => {});
    authedGet<any>("/org/overview")
      .then((o) => authedGet<any[]>("/org/employees").then((e) => setTeam({ overview: o, employees: e })))
      .catch(() => {});
  }, [refresh]);

  const TABS: { id: Tab; label: string; icon: any }[] = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "review", label: "Review queue", icon: ClipboardCheck },
    { id: "policies", label: "Policies", icon: ScrollText },
    { id: "patients", label: "Members", icon: UsersRound },
    { id: "team", label: "Team", icon: Users },
  ];

  const filtered = statusFilter ? claims.filter((c) => c.status === statusFilter) : claims;

  return (
    <PortalShell>
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-2xl font-black text-slate-900 tracking-tight">
          {team?.overview?.name ?? "Insurer"}
        </h1>
        <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-teal-100 text-teal-700">
          INSURER
        </span>
      </div>

      <div className="mt-5 flex gap-1 border-b border-slate-200 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-3.5 py-2.5 text-sm font-semibold border-b-2 -mb-px whitespace-nowrap transition ${
              tab === t.id
                ? "border-teal-600 text-teal-700"
                : "border-transparent text-slate-500 hover:text-teal-700"
            }`}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {tab === "dashboard" && <Dashboard metrics={metrics} onOpen={setOpenClaim} />}
        {tab === "review" && (
          <ReviewQueue
            claims={filtered}
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
            onOpen={setOpenClaim}
          />
        )}
        {tab === "policies" && <PoliciesTab policies={policies} />}
        {tab === "patients" && <PatientsTab patients={patients} />}
        {tab === "team" && <TeamTab team={team} reload={() => authedGet<any>("/org/overview").then((o) => authedGet<any[]>("/org/employees").then((e) => setTeam({ overview: o, employees: e })))} />}
      </div>

      {err && <p className="mt-6 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{err}</p>}

      {openClaim && (
        <ClaimDetail claimId={openClaim} role={role} onClose={() => setOpenClaim(null)} onChanged={refresh} />
      )}
    </PortalShell>
  );
}

function Dashboard({ metrics, onOpen }: any) {
  if (!metrics) return <p className="text-slate-400 text-sm">Loading…</p>;
  const m = metrics;
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={Activity} label="Total claims" value={m.totals.claims} sub={`${m.totals.decided} decided · ${m.totals.processing} processing`} tint="text-teal-600" />
        <StatCard icon={CheckCircle2} label="Approval rate" value={`${m.rates.approvalPct}%`} sub={`auto-decided ${m.rates.autoDecisionPct}%`} tint="text-emerald-600" />
        <StatCard icon={Clock} label="Avg turnaround" value={fmtTat(m.tat.avgSeconds)} sub={`fastest ${fmtTat(m.tat.fastestSeconds)}`} tint="text-amber-600" />
        <StatCard icon={ShieldAlert} label="Fraud-flag rate" value={`${m.rates.fraudPct}%`} sub={`${m.fraud.totalFlags} signals raised`} tint="text-rose-600" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-3">
        <StatCard icon={IndianRupee} label="Total billed" value={inrCompact(m.money.billedPaise)} tint="text-slate-600" />
        <StatCard icon={IndianRupee} label="Approved payout" value={inrCompact(m.money.approvedPaise)} tint="text-emerald-600" />
        <StatCard icon={ShieldAlert} label="Protected by AI" value={inrCompact(m.money.savedPaise)} sub="over-claims & errors caught" tint="text-teal-600" />
      </div>

      <div className="grid md:grid-cols-2 gap-4 mt-6">
        <div className="bg-white border border-sky-100 rounded-2xl p-5 shadow-sm">
          <p className="font-bold text-slate-800 text-sm mb-3">Claim volume — last 7 days</p>
          <Bars data={m.trend.map((d: any) => d.count)} labels={m.trend.map((d: any) => fmtDay(d.date))} accent="bg-teal-500" />
        </div>
        <div className="bg-white border border-sky-100 rounded-2xl p-5 shadow-sm">
          <p className="font-bold text-slate-800 text-sm mb-3">Top anomaly signals</p>
          {m.fraud.topSignals.length === 0 ? (
            <p className="text-sm text-slate-400">No anomalies detected.</p>
          ) : (
            <div className="space-y-2">
              {m.fraud.topSignals.slice(0, 5).map((s: any) => {
                const max = m.fraud.topSignals[0].count;
                return (
                  <div key={s.signal}>
                    <div className="flex justify-between text-xs text-slate-600 mb-0.5">
                      <span className="font-medium">{s.signal}</span>
                      <span>{s.count}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                      <div className="h-full bg-rose-400" style={{ width: `${(s.count / max) * 100}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <SectionTitle>Recent claims</SectionTitle>
      <ClaimRows claims={m.recent} onOpen={onOpen} />
    </>
  );
}

function ReviewQueue({ claims, statusFilter, setStatusFilter, onOpen }: any) {
  const STATUSES = ["", "PROCESSING", "QUERIED", "UNDER_REVIEW", "APPROVED", "DENIED", "SETTLED"];
  return (
    <>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <span className="text-sm text-slate-500">Filter:</span>
        {STATUSES.map((s) => (
          <button
            key={s || "all"}
            onClick={() => setStatusFilter(s)}
            className={`text-xs font-semibold px-2.5 py-1 rounded-full border transition ${
              statusFilter === s
                ? "bg-teal-600 text-white border-teal-600"
                : "bg-white text-slate-500 border-slate-200 hover:border-teal-300"
            }`}
          >
            {s ? s.replace(/_/g, " ") : "All"}
          </button>
        ))}
        <span className="ml-auto text-xs text-slate-400 flex items-center gap-1">
          <Bot className="w-3.5 h-3.5" /> click a row to review &amp; override
        </span>
      </div>
      <ClaimRows claims={claims} onOpen={onOpen} />
    </>
  );
}

function ClaimRows({ claims, onOpen }: { claims: any[]; onOpen: (id: string) => void }) {
  return (
    <div className="bg-white border border-sky-100 rounded-2xl overflow-hidden shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-slate-500">
              {["Claim #", "Patient", "Procedure", "Hospital", "Billed", "Approved", "Verdict", "Status", "Flags"].map((h) => (
                <th key={h} className="text-left font-semibold text-xs uppercase tracking-wider px-4 py-3 border-b border-slate-100">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {claims.map((c, i) => (
              <tr
                key={c.id ?? i}
                className={`hover:bg-teal-50/40 ${c.id ? "cursor-pointer" : ""}`}
                onClick={() => c.id && onOpen(c.id)}
              >
                <td className="px-4 py-3 border-b border-slate-50 font-mono text-xs text-slate-600">{c.claimNumber}</td>
                <td className="px-4 py-3 border-b border-slate-50">{c.patientName}</td>
                <td className="px-4 py-3 border-b border-slate-50 text-slate-600">{c.procedure}</td>
                <td className="px-4 py-3 border-b border-slate-50 text-slate-500">{c.hospital ?? "—"}</td>
                <td className="px-4 py-3 border-b border-slate-50 tabular-nums">{inr(c.billedPaise)}</td>
                <td className="px-4 py-3 border-b border-slate-50 tabular-nums font-medium">{inr(c.approvedAmountPaise)}</td>
                <td className="px-4 py-3 border-b border-slate-50"><VerdictBadge verdict={c.verdict} /></td>
                <td className="px-4 py-3 border-b border-slate-50"><StatusBadge status={c.status} /></td>
                <td className="px-4 py-3 border-b border-slate-50">
                  {c.fraudFlagCount || c.flagCount ? (
                    <span className="text-xs font-bold text-amber-600">{c.fraudFlagCount ?? c.flagCount}</span>
                  ) : <span className="text-slate-300">0</span>}
                </td>
              </tr>
            ))}
            {claims.length === 0 && <tr><td colSpan={9} className="px-4 py-6 text-center text-slate-400">No claims.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PoliciesTab({ policies }: { policies: any[] }) {
  return (
    <div className="bg-white border border-sky-100 rounded-2xl overflow-hidden shadow-sm">
      <table className="w-full text-sm">
        <thead><tr className="bg-slate-50 text-slate-500">{["Plan", "Code", "Sum insured", "Room cap/day", "Co-pay", "Members", "Claims"].map((h) => <th key={h} className="text-left font-semibold text-xs uppercase tracking-wider px-4 py-3 border-b border-slate-100">{h}</th>)}</tr></thead>
        <tbody>
          {policies.map((p) => (
            <tr key={p.id} className="hover:bg-slate-50">
              <td className="px-4 py-3 border-b border-slate-50 font-medium">{p.name}</td>
              <td className="px-4 py-3 border-b border-slate-50 font-mono text-xs">{p.planCode}</td>
              <td className="px-4 py-3 border-b border-slate-50 tabular-nums">{inr(p.sumInsuredPaise)}</td>
              <td className="px-4 py-3 border-b border-slate-50 tabular-nums">{inr(p.roomRentCapPerDayPaise)}</td>
              <td className="px-4 py-3 border-b border-slate-50">{p.copayPct}%</td>
              <td className="px-4 py-3 border-b border-slate-50">{p._count?.patients ?? 0}</td>
              <td className="px-4 py-3 border-b border-slate-50">{p._count?.claims ?? 0}</td>
            </tr>
          ))}
          {policies.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-400">No policies.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function PatientsTab({ patients }: { patients: any[] }) {
  return (
    <div className="bg-white border border-sky-100 rounded-2xl overflow-hidden shadow-sm">
      <table className="w-full text-sm">
        <thead><tr className="bg-slate-50 text-slate-500">{["Member ID", "Name", "Age", "Gender", "Policy", "Claims"].map((h) => <th key={h} className="text-left font-semibold text-xs uppercase tracking-wider px-4 py-3 border-b border-slate-100">{h}</th>)}</tr></thead>
        <tbody>
          {patients.map((p) => (
            <tr key={p.id} className="hover:bg-slate-50">
              <td className="px-4 py-3 border-b border-slate-50 font-mono text-xs">{p.memberId}</td>
              <td className="px-4 py-3 border-b border-slate-50 font-medium">{p.name}</td>
              <td className="px-4 py-3 border-b border-slate-50">{p.age}</td>
              <td className="px-4 py-3 border-b border-slate-50">{p.gender}</td>
              <td className="px-4 py-3 border-b border-slate-50 text-slate-600">{p.policy?.name ?? "—"}</td>
              <td className="px-4 py-3 border-b border-slate-50">{p._count?.claims ?? 0}</td>
            </tr>
          ))}
          {patients.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-400">No members.</td></tr>}
        </tbody>
      </table>
    </div>
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
  const field = "px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100";

  return (
    <>
      <form onSubmit={add} className="bg-white border border-sky-100 rounded-2xl p-5 shadow-sm mb-6">
        <p className="flex items-center gap-2 font-bold text-slate-900 mb-3"><UserPlus className="w-5 h-5 text-teal-600" /> Add adjudicator</p>
        <div className="flex gap-2 flex-wrap items-center">
          <input className={`${field} flex-1 min-w-[160px]`} placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} minLength={2} required />
          <input className={`${field} flex-1 min-w-[160px]`} type="password" placeholder="Temp password (8+)" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required />
          <button disabled={busy} className="px-5 py-2 rounded-xl text-sm font-bold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-60">{busy ? "Creating…" : "Create"}</button>
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
