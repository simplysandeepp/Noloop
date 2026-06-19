import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AiModule } from "../ai/ai.module";
import { ClaimsController } from "./claims.controller";
import { TrackController } from "./track.controller";
import { ClaimsService } from "./claims.service";

@Module({
  imports: [AuthModule, AiModule],
  controllers: [ClaimsController, TrackController],
  providers: [ClaimsService],
  exports: [ClaimsService],
})
export class ClaimsModule {}
