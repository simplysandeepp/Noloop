import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { PrismaModule } from "./prisma/prisma.module";
import { AuthModule } from "./auth/auth.module";
import { AdminModule } from "./admin/admin.module";
import { OrgModule } from "./org/org.module";
import { AiModule } from "./ai/ai.module";
import { ClaimsModule } from "./claims/claims.module";
import { BedsModule } from "./beds/beds.module";
import { MetricsModule } from "./metrics/metrics.module";
import { CatalogModule } from "./catalog/catalog.module";
import { HealthController } from "./health/health.controller";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    AdminModule,
    OrgModule,
    AiModule,
    ClaimsModule,
    BedsModule,
    MetricsModule,
    CatalogModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
