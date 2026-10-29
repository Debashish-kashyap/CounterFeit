import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { CasesController } from "./cases.controller";
import { PacksController } from "./packs.controller";
import { ReportsController } from "./reports.controller";
import { ShipmentsController } from "./shipments.controller";
import { SupplyChainController } from "./supply-chain.controller";
import { SupplyChainService } from "./supply-chain.service";

@Module({
  imports: [AuthModule],
  controllers: [
    CasesController,
    PacksController,
    ReportsController,
    ShipmentsController,
    SupplyChainController,
  ],
  providers: [SupplyChainService],
})
export class SupplyChainModule {}
