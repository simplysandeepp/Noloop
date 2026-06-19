import { Injectable, NotFoundException } from "@nestjs/common";
import { TenantType } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  /** Headline counts for the dashboard. */
  async stats() {
    const [orgs, hospitals, insurers, users, logs] = await Promise.all([
      this.prisma.tenant.count(),
      this.prisma.tenant.count({ where: { type: TenantType.HOSPITAL } }),
      this.prisma.tenant.count({ where: { type: TenantType.INSURER } }),
      this.prisma.user.count(),
      this.prisma.activityLog.count(),
    ]);
    return { orgs, hospitals, insurers, users, logs };
  }

  /** All organizations with their employee counts. */
  async listOrgs() {
    const tenants = await this.prisma.tenant.findMany({
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { users: true } } },
    });
    return tenants.map((t) => ({
      id: t.id,
      name: t.name,
      type: t.type,
      createdAt: t.createdAt,
      employeeCount: t._count.users,
    }));
  }

  /** One org + its employees. */
  async getOrg(id: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      include: {
        users: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            createdAt: true,
          },
        },
      },
    });
    if (!tenant) throw new NotFoundException("Organization not found");
    return tenant;
  }

  /** Recent activity logs across the platform. */
  async listLogs(limit = 100) {
    return this.prisma.activityLog.findMany({
      take: Math.min(Math.max(limit, 1), 500),
      orderBy: { createdAt: "desc" },
      include: {
        tenant: { select: { name: true, type: true } },
        actor: { select: { name: true, email: true } },
      },
    });
  }
}
