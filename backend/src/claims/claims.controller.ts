import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Role } from "@prisma/client";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { ClaimsService } from "./claims.service";
import { SubmitClaimDto } from "./dto/submit-claim.dto";
import { OverrideClaimDto } from "./dto/override-claim.dto";

@Controller("claims")
@UseGuards(JwtAuthGuard, RolesGuard)
export class ClaimsController {
  constructor(private readonly claims: ClaimsService) {}

  @Post()
  @Roles(Role.HOSPITAL_ADMIN, Role.HOSPITAL_STAFF)
  submit(@Req() req: any, @Body() dto: SubmitClaimDto) {
    return this.claims.submit(req.user, dto);
  }

  // OCR a bill / discharge summary into form fields (Groq vision).
  @Post("extract")
  @Roles(Role.HOSPITAL_ADMIN, Role.HOSPITAL_STAFF)
  @UseInterceptors(FileInterceptor("file"))
  extract(@UploadedFile() file: any) {
    return this.claims.extractDocument(file);
  }

  @Get()
  @Roles(
    Role.HOSPITAL_ADMIN,
    Role.HOSPITAL_STAFF,
    Role.INSURER_ADMIN,
    Role.INSURER_ADJUDICATOR,
    Role.PLATFORM_ADMIN,
  )
  list(@Req() req: any, @Query("status") status?: string) {
    return this.claims.list(req.user, status);
  }

  @Get(":id")
  @Roles(
    Role.HOSPITAL_ADMIN,
    Role.HOSPITAL_STAFF,
    Role.INSURER_ADMIN,
    Role.INSURER_ADJUDICATOR,
    Role.PLATFORM_ADMIN,
  )
  get(@Req() req: any, @Param("id") id: string) {
    return this.claims.get(req.user, id);
  }

  @Post(":id/override")
  @Roles(Role.INSURER_ADMIN, Role.INSURER_ADJUDICATOR, Role.PLATFORM_ADMIN)
  override(
    @Req() req: any,
    @Param("id") id: string,
    @Body() dto: OverrideClaimDto,
  ) {
    return this.claims.override(req.user, id, dto);
  }

  @Post(":id/settle")
  @Roles(Role.INSURER_ADMIN, Role.INSURER_ADJUDICATOR, Role.PLATFORM_ADMIN)
  settle(@Req() req: any, @Param("id") id: string) {
    return this.claims.settle(req.user, id);
  }

  @Post(":id/respond")
  @Roles(Role.HOSPITAL_ADMIN, Role.HOSPITAL_STAFF)
  respond(
    @Req() req: any,
    @Param("id") id: string,
    @Body() body: { message: string },
  ) {
    return this.claims.respondQuery(req.user, id, body?.message ?? "");
  }
}
