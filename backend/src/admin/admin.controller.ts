import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from "@nestjs/common";
import { Role } from "@prisma/client";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { AdminService } from "./admin.service";

/** All routes here require a logged-in PLATFORM_ADMIN. */
@Controller("admin")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.PLATFORM_ADMIN)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get("stats")
  stats() {
    return this.admin.stats();
  }

  @Get("orgs")
  orgs() {
    return this.admin.listOrgs();
  }

  @Get("orgs/:id")
  org(@Param("id") id: string) {
    return this.admin.getOrg(id);
  }

  @Get("logs")
  logs(@Query("limit") limit?: string) {
    return this.admin.listLogs(limit ? Number(limit) : 100);
  }
}
