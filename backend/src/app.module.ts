import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module";
import { BatchesModule } from "./batches/batches.module";
import { DashboardModule } from "./dashboard/dashboard.module";
import { HealthController } from "./health/health.controller";
import { LedgerModule } from "./ledger/ledger.module";
import { PrismaModule } from "./prisma/prisma.module";
import { QrModule } from "./qr/qr.module";
import { SupplyChainModule } from "./supply-chain/supply-chain.module";

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    BatchesModule,
    DashboardModule,
    LedgerModule,
    QrModule,
    SupplyChainModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
