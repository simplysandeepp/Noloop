"use client";

import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowRight, CheckCircle } from "lucide-react";
import Logo from "../components/ui/Logo";

const fadeUp = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
};

export default function LandingPage() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-white">
      {/* ── Navbar ── */}
      <header className="sticky top-0 z-50 bg-white/95 backdrop-blur border-b border-sky-100 shadow-sm">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <Logo size={36} />
          <nav className="hidden md:flex items-center gap-1">
            {[
              ["Problem", "#problem"],
              ["Platform", "#solution"],
              ["Patients", "#patients"],
              ["Agents", "#agents"],
            ].map(([t, h]) => (
              <a
                key={t}
                href={h}
                className="px-4 py-2 text-sm font-medium text-slate-500 hover:text-sky-700 hover:bg-sky-50 rounded-xl transition-all"
              >
                {t}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            {/* TODO: temporary demo link — remove once product is ready */}
            <a
              href="https://youtu.be/946GA4_ADkc?si=Zpp9CV9ecDXSeQLU"
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 text-sm font-semibold text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-sky-50 hover:border-sky-200 hover:text-sky-700 transition-all shadow-sm"
            >
              Demo
            </a>
            <button
              onClick={() => router.push("/login")}
              className="px-4 py-2 text-sm font-semibold text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-sky-50 hover:border-sky-200 hover:text-sky-700 transition-all shadow-sm"
            >
              Log in
            </button>
            <button
              onClick={() => router.push("/signup")}
              className="px-4 py-2 text-sm font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-xl transition-all shadow-sm"
            >
              Get started
            </button>
          </div>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="py-24 px-6 bg-gradient-to-b from-sky-50 to-white">
        <motion.div
          className="max-w-4xl mx-auto text-center"
          initial="initial"
          animate="animate"
          transition={{ staggerChildren: 0.08 }}
        >
          <motion.div
            variants={fadeUp}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold mb-8 bg-sky-100 text-sky-700 border border-sky-200"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-sky-500 animate-pulse" />
            IRDAI-aligned · AI claims adjudication
          </motion.div>

          <motion.h1
            variants={fadeUp}
            className="font-black mb-6 text-slate-900 leading-tight text-4xl sm:text-5xl tracking-tight"
          >
            Cashless claims decided
            <br />
            in <span className="gradient-text">60 seconds,</span> not 3 hours.
          </motion.h1>

          <motion.p
            variants={fadeUp}
            className="text-lg sm:text-xl mb-10 max-w-2xl mx-auto text-slate-500 leading-relaxed"
          >
            Hospitals submit. AI adjudicates — with the exact policy clause
            cited and fraud flagged. Insurers oversee. Patients watch it all
            happen, live.
          </motion.p>

          <motion.div
            variants={fadeUp}
            className="flex flex-col sm:flex-row items-center justify-center gap-4"
          >
            <button
              onClick={() => router.push("/signup")}
              className="flex items-center gap-2 px-8 py-4 rounded-2xl text-base font-bold text-white bg-sky-600 hover:bg-sky-700 shadow-md shadow-sky-200 transition-all hover:scale-[1.02]"
            >
              Start your organization <ArrowRight className="w-5 h-5" />
            </button>
            <button
              onClick={() => router.push("/login")}
              className="flex items-center gap-2 px-8 py-4 rounded-2xl text-base font-bold text-teal-700 bg-white border border-teal-200 hover:bg-teal-50 transition-all hover:scale-[1.02]"
            >
              Log in
            </button>
          </motion.div>

          <motion.div
            variants={fadeUp}
            className="mt-10 flex items-center justify-center gap-6 flex-wrap"
          >
            {[
              "Every decision cites its policy clause",
              "Fraud flagged before payout, not after",
              "Patients track claims live — no calls",
            ].map((f) => (
              <div
                key={f}
                className="flex items-center gap-1.5 text-sm text-slate-500"
              >
                <CheckCircle className="w-4 h-4 text-emerald-500" />
                {f}
              </div>
            ))}
          </motion.div>
        </motion.div>
      </section>

      {/* ── Problem ── */}
      <section id="problem" className="py-20 px-6 bg-white border-y border-sky-100">
        <div className="max-w-5xl mx-auto">
          <p className="text-xs font-bold tracking-widest uppercase text-center text-sky-600 mb-2">
            The Problem
          </p>
          <h2 className="text-3xl font-bold text-center mb-4 text-slate-900">
            Claims run on paperwork, phone calls, and prayer
          </h2>
          <p className="text-sm text-slate-500 text-center max-w-xl mx-auto mb-12">
            An adjudicator hand-processes 50–80 claims a day. A patient waits
            on a hospital bed while faxes fly. Nobody can say why a claim was
            denied.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                stat: "11–12.5%",
                icon: "📉",
                label: "Claims denied in India",
                desc: "Mostly documentation gaps — the kind AI catches before the claim is even submitted.",
                bg: "bg-red-50 border-red-100",
                text: "text-red-600",
              },
              {
                stat: "₹8–10k Cr",
                icon: "⚠️",
                label: "Lost to fraud every year",
                desc: "Inflated bills and duplicate claims that slip through because no one cross-checks every line item.",
                bg: "bg-amber-50 border-amber-100",
                text: "text-amber-600",
              },
              {
                stat: "2–3 hrs",
                icon: "⏱️",
                label: "Per cashless approval",
                desc: "While the patient waits, discharged but not released. NoLoop decides in under a minute.",
                bg: "bg-sky-50 border-sky-100",
                text: "text-sky-700",
              },
            ].map((s) => (
              <div key={s.stat} className={`rounded-2xl border p-7 ${s.bg}`}>
                <div className="text-3xl mb-4">{s.icon}</div>
                <p className={`text-4xl font-black mb-2 tracking-tight ${s.text}`}>
                  {s.stat}
                </p>
                <p className="font-bold text-slate-800 mb-2">{s.label}</p>
                <p className="text-sm text-slate-500 leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Two portals ── */}
      <section id="solution" className="py-20 px-6 bg-sky-50">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <p className="text-xs font-bold tracking-widest uppercase text-sky-600 mb-2">
              The Platform
            </p>
            <h2 className="text-3xl font-bold text-slate-900 mb-3">
              One platform. A portal for every side of the claim.
            </h2>
            <p className="text-slate-500 max-w-lg mx-auto text-sm">
              No shared inboxes, no PDFs over email — each role sees exactly
              what it needs, nothing more.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {[
              {
                accent: "sky",
                emoji: "🏥",
                title: "Hospital Portal",
                desc: "Snap a photo of the bill — AI reads it into the claim form. Submit, and watch the decision land in seconds.",
                feats: [
                  "Document OCR fills the claim form for you",
                  "Live bed & admission board — discharge files the claim",
                  "Real-time claim tracker, event by event",
                  "One-click responses when a query is raised",
                ],
              },
              {
                accent: "teal",
                emoji: "🛡️",
                title: "Insurance Portal",
                desc: "Every claim arrives pre-adjudicated: verdict, cited clauses, fraud flags. Your team reviews the exceptions, not the pile.",
                feats: [
                  "AI verdict with the exact policy clause cited",
                  "Fraud signals with severity, flag by flag",
                  "Override, settle, or query — with a full audit trail",
                  "Analytics: approval rates, TAT, money protected",
                ],
              },
            ].map((p) => (
              <div
                key={p.title}
                className={`rounded-2xl border overflow-hidden bg-white shadow-sm ${
                  p.accent === "sky" ? "border-sky-200" : "border-teal-200"
                }`}
              >
                <div
                  className={`px-7 pt-8 pb-6 bg-gradient-to-br ${
                    p.accent === "sky"
                      ? "from-sky-50 to-white"
                      : "from-teal-50 to-white"
                  }`}
                >
                  <div
                    className={`w-12 h-12 rounded-2xl flex items-center justify-center text-2xl mb-4 shadow-sm ${
                      p.accent === "sky" ? "bg-sky-600" : "bg-teal-600"
                    }`}
                  >
                    {p.emoji}
                  </div>
                  <h3 className="text-xl font-bold text-slate-900 mb-2">
                    {p.title}
                  </h3>
                  <p className="text-sm text-slate-500 leading-relaxed">
                    {p.desc}
                  </p>
                </div>
                <div className="px-7 py-6 border-t border-slate-50">
                  <ul className="space-y-3 mb-6">
                    {p.feats.map((f) => (
                      <li
                        key={f}
                        className="flex items-start gap-2.5 text-sm text-slate-600"
                      >
                        <CheckCircle
                          className={`w-4 h-4 shrink-0 mt-0.5 ${
                            p.accent === "sky" ? "text-sky-500" : "text-teal-500"
                          }`}
                        />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <button
                    onClick={() => router.push("/signup")}
                    className={`w-full py-3 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 transition-colors shadow-sm ${
                      p.accent === "sky"
                        ? "bg-sky-600 hover:bg-sky-700"
                        : "bg-teal-600 hover:bg-teal-700"
                    }`}
                  >
                    Get started <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Patients strip ── */}
      <section id="patients" className="py-16 px-6 bg-white border-t border-sky-100">
        <div className="max-w-3xl mx-auto text-center">
          <p className="text-xs font-bold tracking-widest uppercase text-teal-600 mb-2">
            For Patients
          </p>
          <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-3">
            Your claim, live — like tracking a parcel
          </h2>
          <p className="text-sm text-slate-500 max-w-xl mx-auto mb-8 leading-relaxed">
            Every claim gets a number. Type it in and see the whole story —
            submitted, decided, settled — with the reason for every decision in
            plain language. No app install, no login, no calling the TPA twice
            a day.
          </p>
          <button
            onClick={() => router.push("/patient")}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl text-sm font-bold text-teal-700 bg-teal-50 border border-teal-200 hover:bg-teal-100 transition-all"
          >
            Track a claim <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </section>

      {/* ── Claim flow ── */}
      <section className="py-20 px-6 bg-white border-y border-sky-100">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <p className="text-xs font-bold tracking-widest uppercase text-sky-600 mb-2">
              Claim Lifecycle
            </p>
            <h2 className="text-3xl font-bold text-slate-900">
              Admission to payout, in five steps
            </h2>
          </div>
          <div className="flex flex-col md:flex-row gap-3">
            {[
              { n: "1", emoji: "🏥", title: "Admit", sub: "Hospital", desc: "Patient admitted, bed assigned. Discharge auto-drafts the claim.", bg: "bg-sky-50 border-sky-200", num: "bg-sky-600" },
              { n: "2", emoji: "📸", title: "Submit", sub: "Hospital", desc: "AI reads the bill photo into the form. One click to file.", bg: "bg-emerald-50 border-emerald-200", num: "bg-emerald-600" },
              { n: "3", emoji: "🤖", title: "Adjudicate", sub: "AI Engine", desc: "Coverage, fraud checks, and verdict — with cited clauses, in seconds.", bg: "bg-teal-50 border-teal-200", num: "bg-teal-600" },
              { n: "4", emoji: "⚖️", title: "Review", sub: "Insurer", desc: "Adjudicator confirms or overrides. Every action logged.", bg: "bg-sky-50 border-sky-200", num: "bg-sky-700" },
              { n: "5", emoji: "✅", title: "Settle", sub: "Everyone", desc: "Payout released. Patient watched every step live.", bg: "bg-emerald-50 border-emerald-200", num: "bg-emerald-600" },
            ].map((s, i) => (
              <div key={i} className="flex-1 relative">
                <div className={`rounded-2xl border p-5 h-full ${s.bg}`}>
                  <div
                    className={`w-7 h-7 rounded-full ${s.num} text-white text-xs font-black flex items-center justify-center mb-3 shadow-sm`}
                  >
                    {s.n}
                  </div>
                  <p className="text-xl mb-1.5">{s.emoji}</p>
                  <p className="font-bold text-slate-800 text-sm mb-0.5">
                    {s.title}
                  </p>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                    {s.sub}
                  </p>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    {s.desc}
                  </p>
                </div>
                {i < 4 && (
                  <div className="hidden md:flex absolute -right-2.5 top-1/2 -translate-y-1/2 z-10 w-5 h-5 rounded-full bg-white border border-sky-200 items-center justify-center shadow-sm">
                    <ArrowRight className="w-2.5 h-2.5 text-sky-400" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Agents ── */}
      <section id="agents" className="py-20 px-6 bg-sky-50">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <p className="text-xs font-bold tracking-widest uppercase text-sky-600 mb-2">
              AI Agents
            </p>
            <h2 className="text-3xl font-bold text-slate-900 mb-3">
              Four agents, one loop — closed.
            </h2>
            <p className="text-slate-500 max-w-md mx-auto text-sm">
              Each fires automatically at its stage of the claim. Nobody
              presses a button.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {[
              { n: "01", emoji: "🔍", title: "Query-Proofing Agent", trigger: "Fires when the hospital uploads documents", desc: "Validates document completeness, runs a policy-coverage check via RAG (clause-level citations), and flags billing inconsistencies before the claim reaches the insurer.", iconBg: "bg-sky-100 text-sky-600" },
              { n: "02", emoji: "⚖️", title: "Adjudication-Assist Agent", trigger: "Fires when the insurer opens the claim", desc: "Generates a clinical justification summary, checks billing line items against benchmarks, and produces a recommendation with cited policy clauses.", iconBg: "bg-teal-100 text-teal-600" },
              { n: "03", emoji: "🛡️", title: "Fraud Detection Agent", trigger: "Runs in parallel with Agent 2", desc: "Calculates a weighted fraud-risk score across billing variance, duplicate checks, historical patterns, hospital credibility, and diagnosis-procedure consistency.", iconBg: "bg-emerald-100 text-emerald-600" },
              { n: "04", emoji: "💬", title: "Patient Communication Agent", trigger: "Fires on every state transition", desc: "Sends warm, plain-language updates to the patient at every step, and powers a policy Q&A bot so patients can ask about coverage.", iconBg: "bg-sky-100 text-sky-600" },
            ].map((a) => (
              <div
                key={a.n}
                className="rounded-2xl border border-sky-100 bg-white p-6 shadow-sm hover:shadow-md hover:border-sky-200 transition-all"
              >
                <div className="flex items-start gap-4 mb-4">
                  <div
                    className={`w-11 h-11 rounded-2xl flex items-center justify-center text-xl shrink-0 ${a.iconBg}`}
                  >
                    {a.emoji}
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">
                      Agent {a.n}
                    </p>
                    <p className="font-bold text-slate-900 text-sm">{a.title}</p>
                  </div>
                </div>
                <p className="text-xs font-semibold text-sky-600 mb-3 italic">
                  {a.trigger}
                </p>
                <p className="text-sm text-slate-500 leading-relaxed">{a.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── IRDAI callout (no real brand names) ── */}
      <section className="py-14 px-6 bg-amber-50 border-y border-amber-100">
        <div className="max-w-3xl mx-auto text-center">
          <p className="text-2xl font-black text-amber-900 mb-3">
            ⚖️ IRDAI fined a major insurer ₹1 crore for slow cashless claims
          </p>
          <p className="text-sm text-amber-800 leading-relaxed max-w-xl mx-auto">
            December 2025. The message to insurers: automate or pay. NoLoop
            answers with sub-minute decisions and an audit trail behind every
            single one.
          </p>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="py-10 px-6 bg-white border-t border-sky-100">
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
          <Logo size={30} />
          <p className="text-xs text-slate-400 text-center">
            © 2026 NoLoop · Capstone project · IRDAI-aligned
          </p>
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push("/signup")}
              className="text-xs font-semibold text-slate-500 hover:text-sky-600 transition-colors"
            >
              Get started
            </button>
            <button
              onClick={() => router.push("/login")}
              className="text-xs font-semibold text-slate-500 hover:text-teal-600 transition-colors"
            >
              Log in
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
