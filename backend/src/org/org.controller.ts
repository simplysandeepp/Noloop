import { Body, Controller, Get, Post, Req, UseGuards } from "@nestjs/common";
import { Role } from "@prisma/client";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { OrgService } from "./org.service";
import { CreateEmployeeDto } from "./dto/create-employee.dto";

/** Org-admin self-service: manage your own organization's employees. */
@Controller("org")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.HOSPITAL_ADMIN, Role.INSURER_ADMIN)
export class OrgController {
  constructor(private readonly org: OrgService) {}

  @Get("overview")
  overview(@Req() req: any) {
    return this.org.overview(req.user.tenantId);
  }

  @Get("employees")
  employees(@Req() req: any) {
    return this.org.listEmployees(req.user.tenantId);
  }

  @Post("employees")
  createEmployee(@Req() req: any, @Body() dto: CreateEmployeeDto) {
    return this.org.createEmployee(req.user.tenantId, dto);
  }
}
