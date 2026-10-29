import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { createHmac } from "node:crypto";
import { getAppSecret } from "../config/secrets";

export type QrTargetType = "P" | "C";

export interface SignedQrPayload {
  payload: string;
  signature: string;
  content: string;
}

@Injectable()
export class QrPayloadService {
  create(type: QrTargetType, serialOrCode: string): SignedQrPayload {
    let secret: string;
    try {
      secret = getAppSecret("QR_HMAC_SECRET");
    } catch {
      throw new ServiceUnavailableException(
        "Set QR_HMAC_SECRET to a private value of at least 32 characters",
      );
    }

    const payload = Buffer.from(
      JSON.stringify({ t: type, s: serialOrCode, v: 1 }),
    ).toString("base64url");
    const signature = createHmac("sha256", secret)
      .update(`${type}.${serialOrCode}`)
      .digest("hex");

    return {
      payload,
      signature,
      content: `${payload}.${signature}`,
    };
  }
}
