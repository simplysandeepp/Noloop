import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { OrgController } from "./org.controller";
import { OrgService } from "./org.service";

// Imports AuthModule so JwtAuthGuard/RolesGuard resolve here.
@Module({
  imports: [AuthModule],
  controllers: [OrgController],
  providers: [OrgService],
})
export class OrgModule {}
