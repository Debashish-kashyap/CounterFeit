import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { VerifyController } from "./verify.controller";
import { VerifyService } from "./verify.service";

@Module({
  imports: [AuthModule],
  controllers: [VerifyController],
  providers: [VerifyService],
})
export class VerifyModule {}
