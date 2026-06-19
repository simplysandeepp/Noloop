import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { Role } from "@prisma/client";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { BedsService } from "./beds.service";
import { AdmitDto } from "./dto/admit.dto";

@Controller("beds")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.HOSPITAL_ADMIN, Role.HOSPITAL_STAFF)
export class BedsController {
  constructor(private readonly beds: BedsService) {}

  @Get("overview")
  overview(@Req() req: any) {
    return this.beds.overview(req.user.tenantId);
  }

  @Post("admit")
  admit(@Req() req: any, @Body() dto: AdmitDto) {
    return this.beds.admit(req.user.tenantId, dto);
  }

  @Post("discharge/:admissionId")
  discharge(@Req() req: any, @Param("admissionId") admissionId: string) {
    return this.beds.discharge(req.user.tenantId, admissionId);
  }
}
