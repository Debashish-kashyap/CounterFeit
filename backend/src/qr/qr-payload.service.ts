import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { createHmac } from "node:crypto";

export type QrTargetType = "P" | "C";

export interface SignedQrPayload {
  payload: string;
  signature: string;
  content: string;
}

@Injectable()
export class QrPayloadService {
  create(type: QrTargetType, serialOrCode: string): SignedQrPayload {
    const secret = process.env.QR_HMAC_SECRET;
    if (
      !secret ||
      secret === "change-me" ||
      secret.startsWith("replace-with-") ||
      secret.length < 32
    ) {
      throw new ServiceUnavailableException(
        "Set QR_HMAC_SECRET to a random value of at least 32 characters",
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
