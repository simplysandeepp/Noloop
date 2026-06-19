import { Injectable } from "@nestjs/common";
import { BedStatus, ClaimStatus, Prisma, Role, Verdict } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

interface AuthUser {
  sub: string;
  role: Role;
  tenantId: string | null;
}

@Injectable()
export class MetricsService {
  constructor(private readonly prisma: PrismaService) {}

  private scope(user: AuthUser): {
    where: Prisma.ClaimWhereInput;
    label: "INSURER" | "HOSPITAL" | "PLATFORM";
    hospitalId?: string;
  } {
    if (user.role === Role.HOSPITAL_ADMIN || user.role === Role.HOSPITAL_STAFF)
      return {
        where: { hospitalTenantId: user.tenantId ?? "__none__" },
        label: "HOSPITAL",
        hospitalId: user.tenantId ?? undefined,
      };
    if (user.role === Role.INSURER_ADMIN || user.role === Role.INSURER_ADJUDICATOR)
      return {
        where: { insurerTenantId: user.tenantId ?? "__none__" },
        label: "INSURER",
      };
    return { where: {}, label: "PLATFORM" };
  }

  async summary(user: AuthUser) {
    const { where, label, hospitalId } = this.scope(user);

    const claims = await this.prisma.claim.findMany({
      where,
      select: {
        claimNumber: true,
        patientName: true,
        procedure: true,
        status: true,
        verdict: true,
        billedPaise: true,
        approvedAmountPaise: true,
        tatSeconds: true,
        confidence: true,
        overriddenById: true,
        submittedAt: true,
        fraudFlags: { select: { signal: true } },
      },
      orderBy: { submittedAt: "desc" },
    });

    const total = claims.length;
    const count = (s: ClaimStatus) => claims.filter((c) => c.status === s).length;
    const decided = claims.filter((c) => c.verdict !== null);
    const approved = claims.filter((c) => c.verdict === Verdict.APPROVE).length;
    const denied = claims.filter((c) => c.verdict === Verdict.DENY).length;
    const queried = claims.filter((c) => c.verdict === Verdict.QUERY).length;
    const flagged = claims.filter((c) => c.fraudFlags.length > 0).length;
    const auto = decided.filter((c) => !c.overriddenById).length;

    const tats = decided
      .map((c) => c.tatSeconds)
      .filter((t): t is number => typeof t === "number");
    const avgTat = tats.length
      ? Math.round(tats.reduce((s, t) => s + t, 0) / tats.length)
      : 0;

    const billedPaise = claims.reduce((s, c) => s + c.billedPaise, 0);
    const approvedPaise = claims
      .filter(
        (c) =>
          c.status === ClaimStatus.APPROVED || c.status === ClaimStatus.SETTLED,
      )
      .reduce((s, c) => s + (c.approvedAmountPaise ?? 0), 0);
    // Money the engine protected: billed minus approved on every decided claim.
    const savedPaise = decided.reduce(
      (s, c) => s + Math.max(0, c.billedPaise - (c.approvedAmountPaise ?? 0)),
      0,
    );

    const signalCounts = new Map<string, number>();
    for (const c of claims)
      for (const f of c.fraudFlags)
        signalCounts.set(f.signal, (signalCounts.get(f.signal) ?? 0) + 1);
    const topSignals = [...signalCounts.entries()]
      .map(([signal, count]) => ({ signal, count }))
      .sort((a, b) => b.count - a.count);

    // 7-day trend (oldest → newest).
    const trend: { date: string; count: number; approvedPaise: number }[] = [];
    const today = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today.getTime() - i * 86_400_000);
      const key = d.toISOString().slice(0, 10);
      const dayClaims = claims.filter(
        (c) => c.submittedAt.toISOString().slice(0, 10) === key,
      );
      trend.push({
        date: key,
        count: dayClaims.length,
        approvedPaise: dayClaims.reduce(
          (s, c) => s + (c.approvedAmountPaise ?? 0),
          0,
        ),
      });
    }

    const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);

    const result: any = {
      scope: label,
      totals: {
        claims: total,
        decided: decided.length,
        processing: count(ClaimStatus.PROCESSING),
        approved: count(ClaimStatus.APPROVED),
        denied: count(ClaimStatus.DENIED),
        queried: count(ClaimStatus.QUERIED),
        underReview: count(ClaimStatus.UNDER_REVIEW),
        settled: count(ClaimStatus.SETTLED),
      },
      rates: {
        approvalPct: pct(approved, decided.length),
        denialPct: pct(denied, decided.length),
        queryPct: pct(queried, decided.length),
        autoDecisionPct: pct(auto, decided.length),
        fraudPct: pct(flagged, total),
      },
      tat: {
        avgSeconds: avgTat,
        fastestSeconds: tats.length ? Math.min(...tats) : 0,
        slowestSeconds: tats.length ? Math.max(...tats) : 0,
      },
      money: { billedPaise, approvedPaise, savedPaise },
      fraud: {
        totalFlags: [...signalCounts.values()].reduce((s, n) => s + n, 0),
        flaggedClaims: flagged,
        topSignals,
      },
      trend,
      recent: claims.slice(0, 8).map((c) => ({
        claimNumber: c.claimNumber,
        patientName: c.patientName,
        procedure: c.procedure,
        status: c.status,
        verdict: c.verdict,
        billedPaise: c.billedPaise,
        approvedAmountPaise: c.approvedAmountPaise,
        tatSeconds: c.tatSeconds,
        flagCount: c.fraudFlags.length,
        submittedAt: c.submittedAt,
      })),
    };

    if (label === "HOSPITAL" && hospitalId) {
      const [totalBeds, occupied, maintenance] = await Promise.all([
        this.prisma.bed.count({ where: { hospitalTenantId: hospitalId } }),
        this.prisma.bed.count({
          where: { hospitalTenantId: hospitalId, status: BedStatus.OCCUPIED },
        }),
        this.prisma.bed.count({
          where: { hospitalTenantId: hospitalId, status: BedStatus.MAINTENANCE },
        }),
      ]);
      result.beds = {
        totalBeds,
        occupied,
        available: totalBeds - occupied - maintenance,
        occupancyRate: totalBeds ? Math.round((occupied / totalBeds) * 100) : 0,
      };
    }

    return result;
  }
}
