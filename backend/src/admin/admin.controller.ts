import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { Role, UserStatus } from "@prisma/client";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { AdminService } from "./admin.service";
import {
  AdminCreateUserDto,
  CreateOrgDto,
  ResetPasswordDto,
  UpdateUserDto,
} from "./dto/admin-dtos";

/** All routes here require a logged-in PLATFORM_ADMIN. */
@Controller("admin")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.PLATFORM_ADMIN)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  // reads
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

  @Get("users")
  users() {
    return this.admin.listUsers();
  }

  @Get("logs")
  logs(@Query("limit") limit?: string) {
    return this.admin.listLogs(limit ? Number(limit) : 100);
  }

  // org mutations
  @Post("orgs")
  createOrg(@Req() req: any, @Body() dto: CreateOrgDto) {
    return this.admin.createOrg(req.user.sub, dto);
  }

  @Delete("orgs/:id")
  deleteOrg(@Param("id") id: string) {
    return this.admin.deleteOrg(id);
  }

  // user mutations
  @Post("users")
  createUser(@Req() req: any, @Body() dto: AdminCreateUserDto) {
    return this.admin.createUser(req.user.sub, dto);
  }

  @Patch("users/:id")
  updateUser(@Param("id") id: string, @Body() dto: UpdateUserDto) {
    return this.admin.updateUser(id, dto);
  }

  @Post("users/:id/reset-password")
  resetPassword(@Param("id") id: string, @Body() dto: ResetPasswordDto) {
    return this.admin.resetPassword(id, dto);
  }

  @Post("users/:id/revoke")
  revoke(@Param("id") id: string) {
    return this.admin.setStatus(id, UserStatus.REVOKED);
  }

  @Post("users/:id/restore")
  restore(@Param("id") id: string) {
    return this.admin.setStatus(id, UserStatus.ACTIVE);
  }

  @Delete("users/:id")
  deleteUser(@Param("id") id: string) {
    return this.admin.deleteUser(id);
  }
}
