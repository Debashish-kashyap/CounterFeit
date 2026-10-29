import { Global, Module } from "@nestjs/common";
import { QrPayloadService } from "./qr-payload.service";

@Global()
@Module({
  providers: [QrPayloadService],
  exports: [QrPayloadService],
})
export class QrModule {}
