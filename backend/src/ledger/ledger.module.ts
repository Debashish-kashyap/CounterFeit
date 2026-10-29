import { Global, Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { LedgerController } from "./ledger.controller";
import { LedgerService } from "./ledger.service";

@Global()
@Module({
  imports: [AuthModule],
  controllers: [LedgerController],
  providers: [LedgerService],
  exports: [LedgerService],
})
export class LedgerModule {}
