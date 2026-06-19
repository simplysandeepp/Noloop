import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { BedsController } from "./beds.controller";
import { BedsService } from "./beds.service";

@Module({
  imports: [AuthModule],
  controllers: [BedsController],
  providers: [BedsService],
})
export class BedsModule {}
