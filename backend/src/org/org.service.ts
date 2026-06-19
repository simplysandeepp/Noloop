import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { Role, TenantType } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CreateEmployeeDto } from "./dto/create-employee.dto";
import { toCompact, uniqueEmail } from "../common/slug";

@Injectable()
export class OrgService {
  constructor(private readonly prisma: PrismaService) {}

  private staffRoleFor(type: TenantType): Role {
    return type === TenantType.HOSPITAL
      ? Role.HOSPITAL_STAFF
      : Role.INSURER_ADJUDICATOR;
  }

  private async tenantOf(tenantId: string | null) {
    if (!tenantId) throw new BadRequestException("No organization on token");
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });
    if (!tenant) throw new NotFoundException("Organization not found");
    return tenant;
  }

  /** Org header + counts for the portal. */
  async overview(tenantId: string | null) {
    const tenant = await this.tenantOf(tenantId);
    const employeeCount = await this.prisma.user.count({
      where: { tenantId: tenant.id },
    });
    // The admin's own login email = the org email.
    const admin = await this.prisma.user.findFirst({
      where: {
        tenantId: tenant.id,
        role: { in: [Role.HOSPITAL_ADMIN, Role.INSURER_ADMIN] },
      },
      orderBy: { createdAt: "asc" },
      select: { email: true },
    });
    return {
      id: tenant.id,
      name: tenant.name,
      type: tenant.type,
      createdAt: tenant.createdAt,
      orgEmail: admin?.email ?? null,
      employeeCount,
    };
  }

  /** All users in the org (admin + staff). */
  async listEmployees(tenantId: string | null) {
    const tenant = await this.tenantOf(tenantId);
    return this.prisma.user.findMany({
      where: { tenantId: tenant.id },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
      },
    });
  }

  /**
   * Create a staff account under the admin's org. Email is generated:
   * "Sachin" under "Acme Hospital" -> sachin.acmehospital@noloop.in.
   */
  async createEmployee(tenantId: string | null, dto: CreateEmployeeDto) {
    const tenant = await this.tenantOf(tenantId);
    const localBase = `${toCompact(dto.name)}.${toCompact(tenant.name)}`;
    const email = await uniqueEmail(localBase, (e) =>
      this.prisma.user.findUnique({ where: { email: e } }).then(Boolean),
    );
    const passwordHash = await bcrypt.hash(dto.password, 10);
    const role = this.staffRoleFor(tenant.type);

    const user = await this.prisma.user.create({
      data: {
        email,
        name: dto.name,
        passwordHash,
        role,
        tenantId: tenant.id,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
      },
    });

    await this.prisma.activityLog.create({
      data: {
        tenantId: tenant.id,
        action: "EMPLOYEE_CREATED",
        detail: `${user.name} <${user.email}>`,
      },
    });

    return user;
  }
}
