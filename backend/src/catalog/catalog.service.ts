import { Injectable, BadRequestException } from "@nestjs/common";
import { TenantType } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  /** Insurers + their primary policy — drives the hospital's claim form. */
  async insurers() {
    const insurers = await this.prisma.tenant.findMany({
      where: { type: TenantType.INSURER },
      orderBy: { name: "asc" },
      include: { policies: { orderBy: { createdAt: "asc" }, take: 1 } },
    });
    return insurers.map((i) => {
      const p = i.policies[0];
      return {
        id: i.id,
        name: i.name,
        policy: p
          ? {
              name: p.name,
              planCode: p.planCode,
              sumInsuredPaise: p.sumInsuredPaise,
              roomRentCapPerDayPaise: p.roomRentCapPerDayPaise,
              copayPct: p.copayPct,
              coveredProcedures: p.coveredProcedures,
              exclusions: p.exclusions,
            }
          : null,
      };
    });
  }

  /** An insurer's own policies. */
  async policies(tenantId: string | null) {
    if (!tenantId) throw new BadRequestException("No insurer on token");
    return this.prisma.policy.findMany({
      where: { insurerTenantId: tenantId },
      orderBy: { createdAt: "asc" },
      include: { _count: { select: { patients: true, claims: true } } },
    });
  }

  /** An insurer's own policyholders. */
  async patients(tenantId: string | null) {
    if (!tenantId) throw new BadRequestException("No insurer on token");
    return this.prisma.patient.findMany({
      where: { insurerTenantId: tenantId },
      orderBy: { createdAt: "desc" },
      include: {
        policy: { select: { name: true } },
        _count: { select: { claims: true } },
      },
    });
  }
}
