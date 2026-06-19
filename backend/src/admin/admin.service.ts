import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { Role, TenantType, UserStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { toCompact, toDotted, uniqueEmail } from "../common/slug";
import { genPassword } from "../common/password";
import {
  AdminCreateUserDto,
  CreateOrgDto,
  ResetPasswordDto,
  UpdateUserDto,
} from "./dto/admin-dtos";

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  // ── dashboard reads ──────────────────────────────────────
  async stats() {
    const [orgs, hospitals, insurers, users, claims, logs] = await Promise.all([
      this.prisma.tenant.count(),
      this.prisma.tenant.count({ where: { type: TenantType.HOSPITAL } }),
      this.prisma.tenant.count({ where: { type: TenantType.INSURER } }),
      this.prisma.user.count(),
      this.prisma.claim.count(),
      this.prisma.activityLog.count(),
    ]);
    return { orgs, hospitals, insurers, users, claims, logs };
  }

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
            status: true,
            createdAt: true,
          },
        },
      },
    });
    if (!tenant) throw new NotFoundException("Organization not found");
    return tenant;
  }

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

  /** Every user across the platform — the god-mode roster. */
  async listUsers() {
    return this.prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        createdAt: true,
        tenant: { select: { id: true, name: true, type: true } },
      },
    });
  }

  // ── god-mode mutations ───────────────────────────────────
  private adminRoleFor(type: TenantType): Role {
    return type === TenantType.HOSPITAL
      ? Role.HOSPITAL_ADMIN
      : Role.INSURER_ADMIN;
  }
  private staffRoleFor(type: TenantType): Role {
    return type === TenantType.HOSPITAL
      ? Role.HOSPITAL_STAFF
      : Role.INSURER_ADJUDICATOR;
  }

  /** Create an org + its first admin. Returns the login credentials once. */
  async createOrg(actorId: string, dto: CreateOrgDto) {
    const type = dto.type as TenantType;
    const email = await uniqueEmail(toDotted(dto.name), (e) =>
      this.prisma.user.findUnique({ where: { email: e } }).then(Boolean),
    );
    const tempPassword = dto.password ?? genPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 10);

    const { tenant, admin } = await this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({ data: { name: dto.name, type } });
      const admin = await tx.user.create({
        data: {
          email,
          name: dto.adminName,
          passwordHash,
          role: this.adminRoleFor(type),
          tenantId: tenant.id,
        },
      });
      await tx.activityLog.create({
        data: {
          tenantId: tenant.id,
          actorId,
          action: "ORG_CREATED",
          detail: `${type} "${dto.name}" created by platform admin`,
        },
      });
      return { tenant, admin };
    });

    return {
      tenant: { id: tenant.id, name: tenant.name, type: tenant.type },
      credentials: {
        email: admin.email,
        password: tempPassword,
        role: admin.role,
      },
    };
  }

  /** Delete an org and everything that belongs to it. */
  async deleteOrg(id: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundException("Organization not found");

    await this.prisma.$transaction(async (tx) => {
      const users = await tx.user.findMany({
        where: { tenantId: id },
        select: { id: true },
      });
      const userIds = users.map((u) => u.id);

      await tx.claim.deleteMany({
        where: { OR: [{ hospitalTenantId: id }, { insurerTenantId: id }] },
      });
      await tx.claimEvent.updateMany({
        where: { actorId: { in: userIds } },
        data: { actorId: null },
      });
      await tx.admission.deleteMany({ where: { hospitalTenantId: id } });
      await tx.bed.deleteMany({ where: { hospitalTenantId: id } });
      await tx.ward.deleteMany({ where: { hospitalTenantId: id } });
      await tx.patient.deleteMany({ where: { insurerTenantId: id } });
      await tx.policy.deleteMany({ where: { insurerTenantId: id } });
      await tx.activityLog.deleteMany({
        where: { OR: [{ tenantId: id }, { actorId: { in: userIds } }] },
      });
      await tx.user.deleteMany({ where: { tenantId: id } });
      await tx.tenant.delete({ where: { id } });
    });
    return { deleted: true, id, name: tenant.name };
  }

  /** Create an employee in any org. Returns credentials once. */
  async createUser(actorId: string, dto: AdminCreateUserDto) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: dto.tenantId },
    });
    if (!tenant) throw new BadRequestException("Organization not found");

    const role = (dto.role as Role) ?? this.staffRoleFor(tenant.type);
    const localBase = `${toCompact(dto.name)}.${toCompact(tenant.name)}`;
    const email = await uniqueEmail(localBase, (e) =>
      this.prisma.user.findUnique({ where: { email: e } }).then(Boolean),
    );
    const tempPassword = dto.password ?? genPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 10);

    const user = await this.prisma.user.create({
      data: { email, name: dto.name, passwordHash, role, tenantId: tenant.id },
    });
    await this.prisma.activityLog.create({
      data: {
        tenantId: tenant.id,
        actorId,
        action: "EMPLOYEE_CREATED",
        detail: `${user.name} <${user.email}> (${role}) created by platform admin`,
      },
    });
    return {
      user: { id: user.id, name: user.name, role: user.role },
      credentials: { email: user.email, password: tempPassword, role: user.role },
    };
  }

  async updateUser(id: string, dto: UpdateUserDto) {
    await this.mustExist(id);
    return this.prisma.user.update({
      where: { id },
      data: {
        ...(dto.name ? { name: dto.name } : {}),
        ...(dto.role ? { role: dto.role as Role } : {}),
      },
      select: { id: true, name: true, email: true, role: true, status: true },
    });
  }

  async resetPassword(id: string, dto: ResetPasswordDto) {
    await this.mustExist(id);
    const tempPassword = dto.password ?? genPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 10);
    const user = await this.prisma.user.update({
      where: { id },
      data: { passwordHash },
      select: { email: true },
    });
    return { credentials: { email: user.email, password: tempPassword } };
  }

  async setStatus(id: string, status: UserStatus) {
    await this.mustExist(id);
    return this.prisma.user.update({
      where: { id },
      data: { status },
      select: { id: true, name: true, email: true, role: true, status: true },
    });
  }

  async deleteUser(id: string) {
    const user = await this.mustExist(id);
    await this.prisma.$transaction(async (tx) => {
      await tx.claimEvent.updateMany({
        where: { actorId: id },
        data: { actorId: null },
      });
      await tx.claim.updateMany({
        where: { submittedById: id },
        data: { submittedById: null },
      });
      await tx.claim.updateMany({
        where: { overriddenById: id },
        data: { overriddenById: null },
      });
      await tx.activityLog.updateMany({
        where: { actorId: id },
        data: { actorId: null },
      });
      await tx.user.delete({ where: { id } });
    });
    return { deleted: true, id, email: user.email };
  }

  private async mustExist(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException("User not found");
    return user;
  }
}
