/**
 * Synthetic claim-packet generator.
 *
 * Real insurer policy/claim data can't be used (IP/legal), so we generate
 * realistic FAKE claim packets to develop and evaluate the adjudication engine.
 * Each packet carries a `groundTruth` label (verdict + fraud signals) so we can
 * later measure the engine's accuracy with an eval harness.
 *
 * Usage:
 *   bun scripts/generate-synthetic-claims.ts [count] [seed]
 *   bun run gen:claims -- 25 7
 *
 * Output: backend/data/synthetic/claim-*.json + index.json  (gitignored)
 */
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

// ── deterministic PRNG (mulberry32) so runs are reproducible per seed ──
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COUNT = Number(process.argv[2] ?? 20);
const SEED = Number(process.argv[3] ?? 42);
const rand = rng(SEED);

const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
const int = (lo: number, hi: number) => Math.floor(rand() * (hi - lo + 1)) + lo;
const rupees = (n: number) => n * 100; // paise

const FIRST = ["Sachin", "Priya", "Rahul", "Anita", "Vikram", "Neha", "Arjun", "Kavya", "Rohit", "Meera", "Aditya", "Sneha"];
const LAST = ["Sharma", "Patel", "Reddy", "Iyer", "Nair", "Gupta", "Singh", "Mehta", "Rao", "Das"];
// ⚠️ All names below are ENTIRELY FICTIONAL. Never use real hospital or
// insurer brand names — doing so is a legal/IP risk.
const HOSPITALS = [
  "Meadowpine Hospital",
  "Brightwater Medical Center",
  "Stonehaven Hospital",
  "Cedarview Hospital",
  "Larkmont General Hospital",
];
const INSURERS = [
  "Everwell Assurance",
  "Trustline Health Cover",
  "Aegisbay Insurance",
  "Harborlight Health",
  "Brightpath Assurance",
];

interface Procedure {
  name: string;
  typicalLosDays: number;
  costLo: number; // rupees
  costHi: number;
}
const PROCEDURES: Procedure[] = [
  { name: "Appendectomy", typicalLosDays: 2, costLo: 40000, costHi: 90000 },
  { name: "Cataract Surgery", typicalLosDays: 1, costLo: 25000, costHi: 60000 },
  { name: "Angioplasty", typicalLosDays: 3, costLo: 150000, costHi: 350000 },
  { name: "Cesarean Delivery", typicalLosDays: 3, costLo: 60000, costHi: 140000 },
  { name: "Knee Replacement", typicalLosDays: 4, costLo: 200000, costHi: 450000 },
  { name: "Dialysis Session", typicalLosDays: 1, costLo: 8000, costHi: 20000 },
];
// Procedures an insurer may exclude (cosmetic / non-covered).
const EXCLUDABLE = ["Cosmetic Rhinoplasty", "LASIK Eye Surgery", "Dental Implants"];

type Anomaly =
  | "CLEAN"
  | "LENGTH_OF_STAY_ANOMALY"
  | "BILL_MATH_MISMATCH"
  | "POLICY_EXCLUSION"
  | "AMOUNT_OUTLIER";

const BASE = new Date("2026-01-01T00:00:00Z").getTime();
const dayMs = 86400000;

function buildClaim(i: number) {
  const anomaly: Anomaly = (() => {
    const r = rand();
    if (r < 0.55) return "CLEAN";
    if (r < 0.68) return "LENGTH_OF_STAY_ANOMALY";
    if (r < 0.81) return "BILL_MATH_MISMATCH";
    if (r < 0.92) return "POLICY_EXCLUSION";
    return "AMOUNT_OUTLIER";
  })();

  const excluded = anomaly === "POLICY_EXCLUSION";
  const proc = excluded
    ? { name: pick(EXCLUDABLE), typicalLosDays: 2, costLo: 50000, costHi: 120000 }
    : pick(PROCEDURES);

  const patientName = `${pick(FIRST)} ${pick(LAST)}`;
  const hospital = pick(HOSPITALS);
  const insurer = pick(INSURERS);
  const sumInsured = rupees(pick([300000, 500000, 1000000]));

  // Length of stay — inflate for the LOS anomaly.
  const los =
    anomaly === "LENGTH_OF_STAY_ANOMALY"
      ? proc.typicalLosDays + int(8, 15)
      : Math.max(1, proc.typicalLosDays + int(-1, 1));

  const admittedAt = new Date(BASE + int(0, 150) * dayMs);
  const dischargedAt = new Date(admittedAt.getTime() + los * dayMs);

  // Bill line items.
  const roomPerDay = rupees(int(3000, 8000));
  const procedureCost = rupees(int(proc.costLo, proc.costHi));
  const meds = rupees(int(2000, 15000));
  const items = [
    { desc: `Room charges (${los} days)`, amountPaise: roomPerDay * los },
    { desc: proc.name, amountPaise: procedureCost },
    { desc: "Medicines & consumables", amountPaise: meds },
  ];
  const lineSum = items.reduce((s, it) => s + it.amountPaise, 0);

  // Total — for AMOUNT_OUTLIER push beyond sum insured; for BILL_MATH_MISMATCH desync.
  let totalPaise = lineSum;
  if (anomaly === "AMOUNT_OUTLIER") totalPaise = sumInsured + rupees(int(50000, 200000));
  if (anomaly === "BILL_MATH_MISMATCH") totalPaise = lineSum + rupees(int(15000, 60000));

  // Ground-truth label for the eval harness.
  const fraudSignals: string[] = [];
  let verdict: "APPROVE" | "DENY" | "QUERY" = "APPROVE";
  const reasons: string[] = [];
  switch (anomaly) {
    case "LENGTH_OF_STAY_ANOMALY":
      fraudSignals.push("LENGTH_OF_STAY_ANOMALY");
      verdict = "QUERY";
      reasons.push(`Length of stay ${los}d far exceeds typical ${proc.typicalLosDays}d for ${proc.name}`);
      break;
    case "BILL_MATH_MISMATCH":
      fraudSignals.push("BILL_MATH_MISMATCH");
      verdict = "DENY";
      reasons.push("Bill total does not equal the sum of line items");
      break;
    case "POLICY_EXCLUSION":
      fraudSignals.push("POLICY_EXCLUSION");
      verdict = "DENY";
      reasons.push(`${proc.name} is excluded under the policy`);
      break;
    case "AMOUNT_OUTLIER":
      fraudSignals.push("AMOUNT_OUTLIER");
      verdict = "QUERY";
      reasons.push("Claimed amount exceeds the sum insured");
      break;
    default:
      reasons.push("Procedure covered, amounts consistent, stay within norms");
  }

  const ref = `NLP-${String(SEED).padStart(2, "0")}${String(i + 1).padStart(4, "0")}`;
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  return {
    ref,
    type: rand() < 0.6 ? "CASHLESS" : "REIMBURSEMENT",
    patient: { name: patientName, age: int(8, 82), gender: pick(["M", "F"]) },
    hospital,
    insurer,
    policy: {
      policyNo: `POL-${int(100000, 999999)}`,
      sumInsuredPaise: sumInsured,
      coveredProcedures: PROCEDURES.map((p) => p.name),
      exclusions: EXCLUDABLE,
    },
    admission: {
      admittedAt: fmt(admittedAt),
      dischargedAt: fmt(dischargedAt),
      lengthOfStayDays: los,
      procedure: proc.name,
      diagnosis: `${proc.name} indicated`,
    },
    bill: { lineItems: items, totalPaise },
    dischargeSummary:
      `Patient ${patientName} (${int(8, 82)}y) admitted on ${fmt(admittedAt)} for ${proc.name}. ` +
      `Hospitalized ${los} day(s) at ${hospital}. Discharged ${fmt(dischargedAt)} in stable condition. ` +
      `Total billed ₹${(totalPaise / 100).toLocaleString("en-IN")}.`,
    groundTruth: { verdict, fraudSignals, reasons, anomaly },
  };
}

// ── write output ──
const outDir = join(__dirname, "..", "data", "synthetic");
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const claims = Array.from({ length: COUNT }, (_, i) => buildClaim(i));
for (const c of claims) {
  writeFileSync(join(outDir, `${c.ref}.json`), JSON.stringify(c, null, 2));
}

const summary = {
  generatedCount: claims.length,
  seed: SEED,
  byVerdict: claims.reduce<Record<string, number>>((acc, c) => {
    acc[c.groundTruth.verdict] = (acc[c.groundTruth.verdict] ?? 0) + 1;
    return acc;
  }, {}),
  byAnomaly: claims.reduce<Record<string, number>>((acc, c) => {
    acc[c.groundTruth.anomaly] = (acc[c.groundTruth.anomaly] ?? 0) + 1;
    return acc;
  }, {}),
  refs: claims.map((c) => c.ref),
};
writeFileSync(join(outDir, "index.json"), JSON.stringify(summary, null, 2));

console.log(`✅ Generated ${claims.length} synthetic claims -> ${outDir}`);
console.log("   By verdict:", summary.byVerdict);
console.log("   By anomaly:", summary.byAnomaly);
