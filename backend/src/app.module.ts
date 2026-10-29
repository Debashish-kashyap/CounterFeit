import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module";
import { AnomalyModule } from "./anomaly/anomaly.module";
import { BatchesModule } from "./batches/batches.module";
import { DashboardModule } from "./dashboard/dashboard.module";
import { HealthController } from "./health/health.controller";
import { LedgerModule } from "./ledger/ledger.module";
import { PrismaModule } from "./prisma/prisma.module";
import { QrModule } from "./qr/qr.module";
import { VerifyModule } from "./verify/verify.module";

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    AnomalyModule,
    BatchesModule,
    DashboardModule,
    LedgerModule,
    QrModule,
    VerifyModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
