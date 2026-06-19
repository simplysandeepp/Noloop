import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import { Role } from "@prisma/client";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { MetricsService } from "./metrics.service";

@Controller("metrics")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(
  Role.HOSPITAL_ADMIN,
  Role.HOSPITAL_STAFF,
  Role.INSURER_ADMIN,
  Role.INSURER_ADJUDICATOR,
  Role.PLATFORM_ADMIN,
)
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  summary(@Req() req: any) {
    return this.metrics.summary(req.user);
  }
}
