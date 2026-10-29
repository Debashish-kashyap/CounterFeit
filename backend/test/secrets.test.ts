import assert from "node:assert/strict";
import { test } from "node:test";
import { getAppSecret } from "../src/config/secrets";

test("uses distinct local demo secrets and rejects them in production", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousJwtSecret = process.env.JWT_SECRET;
  const previousQrSecret = process.env.QR_HMAC_SECRET;

  try {
    process.env.NODE_ENV = "development";
    delete process.env.JWT_SECRET;
    delete process.env.QR_HMAC_SECRET;

    const jwtSecret = getAppSecret("JWT_SECRET");
    const qrSecret = getAppSecret("QR_HMAC_SECRET");
    assert.ok(jwtSecret.length >= 32);
    assert.ok(qrSecret.length >= 32);
    assert.notEqual(jwtSecret, qrSecret);

    process.env.NODE_ENV = "production";
    assert.throws(() => getAppSecret("JWT_SECRET"));
    assert.throws(() => getAppSecret("QR_HMAC_SECRET"));
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousJwtSecret;
    if (previousQrSecret === undefined) delete process.env.QR_HMAC_SECRET;
    else process.env.QR_HMAC_SECRET = previousQrSecret;
  }
});
