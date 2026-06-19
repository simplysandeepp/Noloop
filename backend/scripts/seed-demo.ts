/**
 * Demo seeder — makes the whole platform "live".
 *
 * Creates a demo insurer + hospital (each with an admin and staff), a policy,
 * policyholders, wards/beds with real occupancy, and ~50 historical claims that
 * are adjudicated by the REAL AI engine (HTTP, with an inline fallback if it's
 * down). Every dashboard number is then computed from this data.
 *
 * ⚠️ All org/hospital/insurer names are ENTIRELY FICTIONAL (legal requirement).
 *
 * Usage:
 *   bun run seed:demo                 # uses AI engine at http://localhost:8000
 *   AI_ENGINE_URL=... bun run seed:demo
 */
import { PrismaClient, Prisma } from "@prisma/client";
import * as bcrypt from "bcryptjs";

const prisma = new PrismaClient();
const AI_URL = process.env.AI_ENGINE_URL ?? "http://localhost:8000";
const DAY = 86_400_000;
const rupees = (n: number) => n * 100;

const rint = (lo: number, hi: number) =>
  Math.floor(Math.random() * (hi - lo + 1)) + lo;
const pick = <T>(a: T[]): T => a[Math.floor(Math.random() * a.length)];

// ── fictional reference data ────────────────────────────────
const INSURER_NAME = "Everwell Assurance";
const HOSPITAL_NAME = "Meadowpine Hospital";
const FIRST = ["Sachin", "Priya", "Rahul", "Anita", "Vikram", "Neha", "Arjun", "Kavya", "Rohit", "Meera", "Aditya", "Sneha", "Karan", "Divya"];
const LAST = ["Sharma", "Patel", "Reddy", "Iyer", "Nair", "Gupta", "Singh", "Mehta", "Rao", "Das"];
const PROCEDURES = [
  { name: "Appendectomy", los: 2, lo: 40000, hi: 90000 },
  { name: "Cataract Surgery", los: 1, lo: 25000, hi: 60000 },
  { name: "Angioplasty", los: 3, lo: 150000, hi: 350000 },
  { name: "Cesarean Delivery", los: 3, lo: 60000, hi: 140000 },
  { name: "Knee Replacement", los: 4, lo: 200000, hi: 450000 },
  { name: "Dialysis Session", los: 1, lo: 8000, hi: 20000 },
];
const COVERED = PROCEDURES.map((p) => p.name);
const EXCLUSIONS = ["Cosmetic Rhinoplasty", "LASIK Eye Surgery", "Dental Implants"];

type Anomaly = "CLEAN" | "LENGTH_OF_STAY_ANOMALY" | "BILL_MATH_MISMATCH" | "POLICY_EXCLUSION" | "AMOUNT_OUTLIER";

interface Packet {
  ref: string;
  type: string;
  hospital: string;
  insurer: string;
  policy: {
    policyNo: string;
    sumInsuredPaise: number;
    roomRentCapPerDayPaise: number | null;
    copayPct: number;
    coveredProcedures: string[];
    exclusions: string[];
  };
  admission: { admittedAt: string; dischargedAt: string; lengthOfStayDays: number; procedure: string; diagnosis: string };
  bill: { lineItems: { desc: string; amountPaise: number }[]; totalPaise: number };
}

async function adjudicate(packet: Packet) {
  try {
    const res = await fetch(`${AI_URL}/adjudicate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(packet),
    });
    if (res.ok) return (await res.json()) as any;
  } catch {
    /* fall through to inline fallback */
  }
  return fallback(packet);
}

// Minimal inline fallback so seeding works without the engine running.
function fallback(p: Packet) {
  const proc = p.admission.procedure.toLowerCase();
  const covered = p.policy.coveredProcedures.map((x) => x.toLowerCase()).includes(proc);
  const excluded = p.policy.exclusions.map((x) => x.toLowerCase()).includes(proc);
  const lineSum = p.bill.lineItems.reduce((s, li) => s + li.amountPaise, 0);
  const overSI = p.bill.totalPaise > p.policy.sumInsuredPaise;
  const flags: any[] = [];
  if (lineSum !== p.bill.totalPaise && !(overSI && lineSum <= p.policy.sumInsuredPaise))
    flags.push({ signal: "BILL_MATH_MISMATCH", severity: "HIGH", detail: "Line items do not sum to total." });
  if (overSI) flags.push({ signal: "AMOUNT_OUTLIER", severity: "MEDIUM", detail: "Exceeds sum insured." });
  if (excluded) flags.push({ signal: "POLICY_EXCLUSION", severity: "HIGH", detail: "Procedure excluded." });
  const sig = new Set(flags.map((f) => f.signal));
  let verdict = "APPROVE";
  let approved: number | null = Math.min(p.bill.totalPaise, p.policy.sumInsuredPaise);
  if (sig.has("BILL_MATH_MISMATCH") || sig.has("POLICY_EXCLUSION")) { verdict = "DENY"; approved = 0; }
  else if (!covered) { verdict = "QUERY"; approved = null; }
  else if (sig.has("AMOUNT_OUTLIER")) { verdict = "QUERY"; approved = null; }
  return {
    verdict, approvedAmountPaise: approved, confidence: verdict === "QUERY" ? 0.6 : 0.92,
    rationale: `${verdict} (seed fallback).`, citedClauseRefs: covered ? ["COVERED_PROCEDURES"] : excluded ? ["EXCLUSIONS"] : [],
    fraudFlags: flags, model: "seed-fallback",
  };
}

function buildClaim(i: number, policy: any) {
  const r = Math.random();
  const anomaly: Anomaly =
    r < 0.6 ? "CLEAN" : r < 0.72 ? "LENGTH_OF_STAY_ANOMALY" : r < 0.84 ? "BILL_MATH_MISMATCH" : r < 0.93 ? "POLICY_EXCLUSION" : "AMOUNT_OUTLIER";
  const excluded = anomaly === "POLICY_EXCLUSION";
  const proc = excluded
    ? { name: pick(EXCLUSIONS), los: 2, lo: 50000, hi: 120000 }
    : pick(PROCEDURES);
  const los = anomaly === "LENGTH_OF_STAY_ANOMALY" ? proc.los + rint(8, 14) : Math.max(1, proc.los + rint(-1, 1));
  const submittedAt = new Date(Date.now() - rint(0, 6) * DAY - rint(0, 80000) * 1000);
  const admittedAt = new Date(submittedAt.getTime() - (los + 1) * DAY);
  const dischargedAt = new Date(admittedAt.getTime() + los * DAY);
  const roomPerDay = rupees(rint(3000, 8000));
  const procedureCost = rupees(rint(proc.lo, proc.hi));
  const meds = rupees(rint(2000, 15000));
  const items = [
    { desc: `Room charges (${los} days)`, amountPaise: roomPerDay * los },
    { desc: proc.name, amountPaise: procedureCost },
    { desc: "Medicines & consumables", amountPaise: meds },
  ];
  const lineSum = items.reduce((s, it) => s + it.amountPaise, 0);
  let total = lineSum;
  if (anomaly === "AMOUNT_OUTLIER") total = policy.sumInsuredPaise + rupees(rint(50000, 200000));
  if (anomaly === "BILL_MATH_MISMATCH") total = lineSum + rupees(rint(15000, 60000));
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { proc, los, submittedAt, admittedAt, dischargedAt, items, total, anomaly, fmt };
}

async function main() {
  console.log("🌱 Seeding NoLoop demo data…");

  // Clean any prior demo orgs (idempotent re-seed).
  for (const name of [INSURER_NAME, HOSPITAL_NAME]) {
    const t = await prisma.tenant.findFirst({ where: { name } });
    if (t) {
      const users = await prisma.user.findMany({ where: { tenantId: t.id }, select: { id: true } });
      const ids = users.map((u) => u.id);
      await prisma.claim.deleteMany({ where: { OR: [{ hospitalTenantId: t.id }, { insurerTenantId: t.id }] } });
      await prisma.claimEvent.updateMany({ where: { actorId: { in: ids } }, data: { actorId: null } });
      await prisma.admission.deleteMany({ where: { hospitalTenantId: t.id } });
      await prisma.bed.deleteMany({ where: { hospitalTenantId: t.id } });
      await prisma.ward.deleteMany({ where: { hospitalTenantId: t.id } });
      await prisma.patient.deleteMany({ where: { insurerTenantId: t.id } });
      await prisma.policy.deleteMany({ where: { insurerTenantId: t.id } });
      await prisma.activityLog.deleteMany({ where: { OR: [{ tenantId: t.id }, { actorId: { in: ids } }] } });
      await prisma.user.deleteMany({ where: { tenantId: t.id } });
      await prisma.tenant.delete({ where: { id: t.id } });
    }
  }

  const pwHash = (p: string) => bcrypt.hash(p, 10);

  // Insurer + users
  const insurer = await prisma.tenant.create({ data: { name: INSURER_NAME, type: "INSURER" } });
  await prisma.user.create({ data: { email: "everwell.assurance@noloop.in", name: "Everwell Admin", passwordHash: await pwHash("Insurer@123"), role: "INSURER_ADMIN", tenantId: insurer.id } });
  await prisma.user.create({ data: { email: "adjudicator.everwellassurance@noloop.in", name: "Asha Verma", passwordHash: await pwHash("Adjudicator@123"), role: "INSURER_ADJUDICATOR", tenantId: insurer.id } });

  // Hospital + users
  const hospital = await prisma.tenant.create({ data: { name: HOSPITAL_NAME, type: "HOSPITAL" } });
  await prisma.user.create({ data: { email: "meadowpine.hospital@noloop.in", name: "Meadowpine Admin", passwordHash: await pwHash("Hospital@123"), role: "HOSPITAL_ADMIN", tenantId: hospital.id } });
  const hospStaff = await prisma.user.create({ data: { email: "nurse.meadowpinehospital@noloop.in", name: "Ravi Kumar", passwordHash: await pwHash("Staff@123"), role: "HOSPITAL_STAFF", tenantId: hospital.id } });

  // Policy
  const policy = await prisma.policy.create({
    data: {
      insurerTenantId: insurer.id,
      name: "Everwell Secure Health",
      planCode: "EW-SEC-500",
      sumInsuredPaise: rupees(500000),
      roomRentCapPerDayPaise: rupees(6000),
      copayPct: 10,
      waitingPeriodDays: 30,
      coveredProcedures: COVERED,
      exclusions: EXCLUSIONS,
    },
  });

  // Patients
  const patients: any[] = [];
  for (let i = 0; i < 12; i++) {
    const name = `${pick(FIRST)} ${pick(LAST)}`;
    patients.push(
      await prisma.patient.create({
        data: {
          insurerTenantId: insurer.id,
          policyId: policy.id,
          memberId: `EW-${100000 + i}`,
          name,
          age: rint(8, 82),
          gender: pick(["M", "F"]),
          phone: `9${rint(100000000, 999999999)}`,
        },
      }),
    );
  }

  // Wards + beds
  const wardDefs = [
    { name: "General Ward", beds: 12 },
    { name: "ICU", beds: 6 },
    { name: "Maternity", beds: 6 },
    { name: "Private Rooms", beds: 8 },
  ];
  const allBeds: { id: string }[] = [];
  for (const w of wardDefs) {
    const ward = await prisma.ward.create({ data: { hospitalTenantId: hospital.id, name: w.name } });
    for (let b = 1; b <= w.beds; b++) {
      const bed = await prisma.bed.create({
        data: { hospitalTenantId: hospital.id, wardId: ward.id, label: `${w.name[0]}${b}` },
      });
      allBeds.push(bed);
    }
  }

  // Occupy ~60% of beds with active admissions.
  const occupyCount = Math.round(allBeds.length * 0.6);
  for (let i = 0; i < occupyCount; i++) {
    const bed = allBeds[i];
    const proc = pick(PROCEDURES);
    const p = pick(patients);
    await prisma.admission.create({
      data: {
        hospitalTenantId: hospital.id,
        bedId: bed.id,
        patientId: p.id,
        patientName: p.name,
        patientAge: p.age,
        patientGender: p.gender,
        diagnosis: `${proc.name} indicated`,
        procedure: proc.name,
        status: "ADMITTED",
        admittedAt: new Date(Date.now() - rint(0, 8) * DAY),
      },
    });
    await prisma.bed.update({ where: { id: bed.id }, data: { status: "OCCUPIED" } });
  }

  // Historical claims, adjudicated by the real engine.
  const N = 52;
  let approved = 0, denied = 0, queried = 0, engineUsed = 0;
  for (let i = 0; i < N; i++) {
    const c = buildClaim(i, policy);
    const linkPatient = Math.random() < 0.5 ? pick(patients) : null;
    const packet: Packet = {
      ref: `SEED-${i}`,
      type: Math.random() < 0.7 ? "CASHLESS" : "REIMBURSEMENT",
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
        admittedAt: c.fmt(c.admittedAt),
        dischargedAt: c.fmt(c.dischargedAt),
        lengthOfStayDays: c.los,
        procedure: c.proc.name,
        diagnosis: `${c.proc.name} indicated`,
      },
      bill: { lineItems: c.items, totalPaise: c.total },
    };
    const decision = await adjudicate(packet);
    if (decision.model !== "seed-fallback") engineUsed++;

    const status = decision.verdict === "APPROVE" ? "APPROVED" : decision.verdict === "DENY" ? "DENIED" : "QUERIED";
    if (status === "APPROVED") approved++; else if (status === "DENIED") denied++; else queried++;
    const tat = rint(12, 52);
    const decidedAt = new Date(c.submittedAt.getTime() + tat * 1000);
    const patientName = linkPatient?.name ?? `${pick(FIRST)} ${pick(LAST)}`;
    const claimNumber = `CLM-${200000 + i}`;

    await prisma.claim.create({
      data: {
        claimNumber,
        type: packet.type as any,
        hospitalTenantId: hospital.id,
        insurerTenantId: insurer.id,
        policyId: policy.id,
        patientId: linkPatient?.id ?? null,
        patientName,
        patientAge: linkPatient?.age ?? rint(8, 82),
        patientGender: linkPatient?.gender ?? pick(["M", "F"]),
        diagnosis: `${c.proc.name} indicated`,
        procedure: c.proc.name,
        admittedAt: c.admittedAt,
        dischargedAt: c.dischargedAt,
        lengthOfStayDays: c.los,
        sumInsuredPaise: policy.sumInsuredPaise,
        billedPaise: c.total,
        lineItems: c.items as unknown as Prisma.InputJsonValue,
        status: status as any,
        verdict: decision.verdict,
        approvedAmountPaise: decision.approvedAmountPaise ?? null,
        confidence: decision.confidence,
        rationale: decision.rationale,
        citedClauseRefs: decision.citedClauseRefs ?? [],
        aiModel: decision.model,
        aiLatencyMs: rint(120, 900),
        tatSeconds: tat,
        submittedById: hospStaff.id,
        submittedAt: c.submittedAt,
        decidedAt,
        decisions: {
          create: {
            verdict: decision.verdict,
            approvedAmountPaise: decision.approvedAmountPaise ?? null,
            confidence: decision.confidence,
            rationale: decision.rationale,
            citedClauseRefs: decision.citedClauseRefs ?? [],
            model: decision.model,
            latencyMs: rint(120, 900),
            createdAt: decidedAt,
          },
        },
        fraudFlags: decision.fraudFlags?.length
          ? {
              create: decision.fraudFlags.map((f: any) => ({
                signal: f.signal,
                severity: f.severity,
                detail: f.detail,
                createdAt: decidedAt,
              })),
            }
          : undefined,
        events: {
          create: [
            { type: "SUBMITTED", message: `Claim ${claimNumber} submitted.`, createdAt: c.submittedAt },
            { type: "AI_STARTED", message: "AI adjudication engine started.", createdAt: new Date(c.submittedAt.getTime() + 1000) },
            { type: "AI_DECISION", message: `AI verdict: ${decision.verdict}. ${decision.rationale}`, createdAt: decidedAt },
            ...(decision.fraudFlags?.length
              ? [{ type: "FRAUD_FLAGGED" as const, message: `${decision.fraudFlags.length} anomaly signal(s).`, createdAt: decidedAt }]
              : []),
          ],
        },
      },
    });
  }

  console.log(`\n✅ Demo seeded.`);
  console.log(`   Insurer:  ${INSURER_NAME}`);
  console.log(`   Hospital: ${HOSPITAL_NAME}`);
  console.log(`   Beds: ${allBeds.length} (${occupyCount} occupied)`);
  console.log(`   Patients: ${patients.length}`);
  console.log(`   Claims: ${N}  → ${approved} approved, ${denied} denied, ${queried} queried`);
  console.log(`   AI engine used for ${engineUsed}/${N} (rest via fallback)\n`);
  console.log("🔑 Demo logins (all @noloop.in):");
  console.log("   Hospital admin:  meadowpine.hospital@noloop.in  /  Hospital@123");
  console.log("   Hospital staff:  nurse.meadowpinehospital@noloop.in  /  Staff@123");
  console.log("   Insurer admin:   everwell.assurance@noloop.in  /  Insurer@123");
  console.log("   Adjudicator:     adjudicator.everwellassurance@noloop.in  /  Adjudicator@123\n");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
