import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import { Role } from "@prisma/client";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { CatalogService } from "./catalog.service";

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  // Hospitals (and admin) pick an insurer when filing a claim.
  @Get("catalog/insurers")
  @Roles(
    Role.HOSPITAL_ADMIN,
    Role.HOSPITAL_STAFF,
    Role.PLATFORM_ADMIN,
    Role.INSURER_ADMIN,
    Role.INSURER_ADJUDICATOR,
  )
  insurers() {
    return this.catalog.insurers();
  }

  @Get("insurer/policies")
  @Roles(Role.INSURER_ADMIN, Role.INSURER_ADJUDICATOR)
  policies(@Req() req: any) {
    return this.catalog.policies(req.user.tenantId);
  }

  @Get("insurer/patients")
  @Roles(Role.INSURER_ADMIN, Role.INSURER_ADJUDICATOR)
  patients(@Req() req: any) {
    return this.catalog.patients(req.user.tenantId);
  }
}
