import type { LucideIcon } from "lucide-react";

// ── Stat card ────────────────────────────────────────────────
export function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  tint = "text-sky-600",
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon?: LucideIcon;
  tint?: string;
}) {
  return (
    <div className="bg-white border border-sky-100 rounded-2xl p-5 shadow-sm">
      {Icon && <Icon className={`w-5 h-5 mb-3 ${tint}`} />}
      <p className="text-2xl md:text-3xl font-black tracking-tight text-slate-900 tabular-nums">
        {value}
      </p>
      <p className="text-xs text-slate-500 mt-0.5">{label}</p>
      {sub != null && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
    </div>
  );
}

// ── Badges ──────────────────────────────────────────────────
const STATUS_COLORS: Record<string, string> = {
  APPROVED: "bg-emerald-50 text-emerald-700 border-emerald-100",
  SETTLED: "bg-teal-100 text-teal-700 border-teal-100",
  DENIED: "bg-red-50 text-red-600 border-red-100",
  QUERIED: "bg-amber-50 text-amber-700 border-amber-100",
  UNDER_REVIEW: "bg-indigo-50 text-indigo-600 border-indigo-100",
  PROCESSING: "bg-sky-50 text-sky-700 border-sky-100",
  SUBMITTED: "bg-slate-100 text-slate-500 border-slate-200",
};
const VERDICT_COLORS: Record<string, string> = {
  APPROVE: "bg-emerald-50 text-emerald-700 border-emerald-100",
  DENY: "bg-red-50 text-red-600 border-red-100",
  QUERY: "bg-amber-50 text-amber-700 border-amber-100",
};

export function StatusBadge({ status }: { status: string }) {
  const c = STATUS_COLORS[status] ?? "bg-slate-100 text-slate-500 border-slate-200";
  return (
    <span className={`inline-block text-[11px] font-bold px-2 py-0.5 rounded-full border ${c}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

export function VerdictBadge({ verdict }: { verdict: string | null }) {
  if (!verdict) return <span className="text-slate-300">—</span>;
  const c = VERDICT_COLORS[verdict] ?? "bg-slate-100 text-slate-500 border-slate-200";
  return (
    <span className={`inline-block text-[11px] font-bold px-2 py-0.5 rounded-full border ${c}`}>
      {verdict}
    </span>
  );
}

const SEVERITY_COLORS: Record<string, string> = {
  HIGH: "bg-red-50 text-red-600 border-red-100",
  MEDIUM: "bg-amber-50 text-amber-700 border-amber-100",
  LOW: "bg-slate-100 text-slate-500 border-slate-200",
};
export function SeverityBadge({ severity }: { severity: string }) {
  const c = SEVERITY_COLORS[severity] ?? SEVERITY_COLORS.LOW;
  return (
    <span className={`inline-block text-[10px] font-bold px-1.5 py-0.5 rounded border ${c}`}>
      {severity}
    </span>
  );
}

// ── Mini bar chart (claims-per-day trend) ───────────────────
export function Bars({
  data,
  labels,
  accent = "bg-sky-500",
}: {
  data: number[];
  labels?: string[];
  accent?: string;
}) {
  const max = Math.max(1, ...data);
  return (
    <div className="flex items-end gap-1.5 h-24">
      {data.map((v, i) => (
        <div key={i} className="flex-1 flex flex-col items-center gap-1">
          <div className="w-full flex items-end justify-center" style={{ height: "100%" }}>
            <div
              className={`w-full rounded-t-md ${accent} transition-all`}
              style={{ height: `${Math.max(4, (v / max) * 100)}%` }}
              title={`${v}`}
            />
          </div>
          {labels && (
            <span className="text-[9px] text-slate-400 leading-none">{labels[i]}</span>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Section heading ─────────────────────────────────────────
export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="mt-8 mb-3 text-lg font-bold text-slate-900">{children}</h2>;
}

// ── Modal ───────────────────────────────────────────────────
export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-[100] bg-slate-900/40 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className={`bg-white rounded-2xl shadow-2xl border border-slate-100 w-full ${wide ? "max-w-3xl" : "max-w-lg"} my-8`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 sticky top-0 bg-white rounded-t-2xl">
          <h3 className="text-lg font-bold text-slate-900">{title}</h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 text-xl leading-none w-8 h-8 rounded-lg hover:bg-slate-100"
          >
            ×
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}
