import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import { Role, TenantType, User, UserStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { SignupDto } from "./dto/signup.dto";
import { LoginDto } from "./dto/login.dto";
import { toDotted, uniqueEmail } from "../common/slug";

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  private adminRoleFor(type: TenantType): Role {
    return type === TenantType.HOSPITAL
      ? Role.HOSPITAL_ADMIN
      : Role.INSURER_ADMIN;
  }

  /** Create an org (tenant) + its first admin, atomically.
   *  The admin's email is generated from the org name: "Acme Hospital"
   *  -> acme.hospital@noloop.in (with a numeric suffix on collision). */
  async signup(dto: SignupDto) {
    const email = await uniqueEmail(toDotted(dto.orgName), (e) =>
      this.prisma.user.findUnique({ where: { email: e } }).then(Boolean),
    );

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const role = this.adminRoleFor(dto.orgType);

    const user = await this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: { name: dto.orgName, type: dto.orgType },
      });
      const created = await tx.user.create({
        data: {
          email,
          name: dto.adminName,
          passwordHash,
          role,
          tenantId: tenant.id,
        },
      });
      await tx.activityLog.create({
        data: {
          tenantId: tenant.id,
          actorId: created.id,
          action: "ORG_CREATED",
          detail: `${dto.orgType} "${dto.orgName}" created`,
        },
      });
      return created;
    });

    return this.issue(user);
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (!user) throw new UnauthorizedException("Invalid credentials");

    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) throw new UnauthorizedException("Invalid credentials");

    if (user.status === UserStatus.REVOKED)
      throw new UnauthorizedException("Account access has been revoked");

    await this.prisma.activityLog.create({
      data: { tenantId: user.tenantId, actorId: user.id, action: "LOGIN" },
    });

    return this.issue(user);
  }

  /** Build the JWT + the safe (no password hash) user payload. */
  private issue(user: User) {
    const token = this.jwt.sign({
      sub: user.id,
      role: user.role,
      tenantId: user.tenantId,
    });
    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        tenantId: user.tenantId,
      },
    };
  }
}
