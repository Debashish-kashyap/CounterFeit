import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { after, before, test } from "node:test";
import { hash } from "bcryptjs";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import {
  CaseStatus,
  PackStatus,
  Prisma,
  ScanAction,
  ScanResult,
  ScanTargetType,
  UserRole,
} from "@prisma/client";
import type { AddressInfo } from "node:net";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";

const TEST_DATABASE_NAME = "backend_integration_test";
const TEST_JWT_SECRET = "backend-integration-jwt-secret-not-for-production";
const TEST_QR_SECRET = "backend-integration-qr-secret-not-for-production";
const DEMO_PASSWORD = "IntegrationPass123!";
const TEST_USERS = {
  manufacturer: "manufacturer@backend-tests.invalid",
  pharmacyOne: "pharmacy-one@backend-tests.invalid",
  pharmacyTwo: "pharmacy-two@backend-tests.invalid",
  regulator: "regulator@backend-tests.invalid",
};

let app: Awaited<ReturnType<typeof NestFactory.create>> | undefined;
let prisma: PrismaService;
let baseUrl: string;

interface ApiResponse<T = Record<string, unknown>> {
  status: number;
  body: T;
}

async function request<T = Record<string, unknown>>(
  path: string,
  options: {
    token?: string;
    method?: string;
    body?: unknown;
  } = {},
): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = {};
  if (options.token) {
    headers.authorization = `Bearer ${options.token}`;
  }
  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers,
    body:
      options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body: body as T };
}

async function login(email: string): Promise<string> {
  const response = await request<{
    access_token: string;
    user: { role: UserRole };
  }>("/auth/login", {
    method: "POST",
    body: { email, password: DEMO_PASSWORD },
  });
  assert.equal(response.status, 200);
  assert.ok(response.body.access_token);
  return response.body.access_token;
}

function createQr(type: "P" | "C", serialOrCode: string): string {
  const payload = Buffer.from(
    JSON.stringify({ t: type, s: serialOrCode, v: 1 }),
  ).toString("base64url");
  const signature = createHmac("sha256", TEST_QR_SECRET)
    .update(`${type}.${serialOrCode}`)
    .digest("hex");
  return `${payload}.${signature}`;
}

function canonicalJson(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) {
      return item.map(normalize);
    }
    if (item !== null && typeof item === "object") {
      return Object.fromEntries(
        Object.entries(item)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, nestedValue]) => [key, normalize(nestedValue)]),
      );
    }
    return item;
  };
  return JSON.stringify(normalize(value));
}

before(async () => {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;
  if (!testDatabaseUrl) {
    throw new Error(
      "Set TEST_DATABASE_URL to a dedicated local database named backend_integration_test before running npm test.",
    );
  }

  const parsedUrl = new URL(testDatabaseUrl);
  const databaseName = decodeURIComponent(parsedUrl.pathname.slice(1));
  if (
    !["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsedUrl.hostname) ||
    databaseName !== TEST_DATABASE_NAME
  ) {
    throw new Error(
      `Refusing to run integration tests against ${parsedUrl.hostname}/${databaseName}; use local database ${TEST_DATABASE_NAME}.`,
    );
  }

  process.env.DATABASE_URL = testDatabaseUrl;
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  process.env.QR_HMAC_SECRET = TEST_QR_SECRET;

  app = await NestFactory.create(AppModule, { logger: ["error"] });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  await app.listen(0, "127.0.0.1");

  const address = app.getHttpServer().address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
  prisma = app.get(PrismaService);

  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "merkle_anchors", "ledger_events", "scans", "packs", "cases", "batches", "api_lots", "users" RESTART IDENTITY CASCADE',
  );

  const passwordHash = await hash(DEMO_PASSWORD, 4);
  await prisma.user.createMany({
    data: [
      {
        name: "Test Manufacturer",
        email: TEST_USERS.manufacturer,
        passwordHash,
        role: UserRole.MANUFACTURER,
        locationName: "Test Manufacturer",
        lat: 26.1445,
        lng: 91.7362,
      },
      {
        name: "Test Pharmacy One",
        email: TEST_USERS.pharmacyOne,
        passwordHash,
        role: UserRole.PHARMACY,
        locationName: "Test Pharmacy One",
        lat: 26.1445,
        lng: 91.7362,
      },
      {
        name: "Test Pharmacy Two",
        email: TEST_USERS.pharmacyTwo,
        passwordHash,
        role: UserRole.PHARMACY,
        locationName: "Test Pharmacy Two",
        lat: 19.076,
        lng: 72.8777,
      },
      {
        name: "Test Regulator",
        email: TEST_USERS.regulator,
        passwordHash,
        role: UserRole.REGULATOR,
        locationName: "Test Regulator",
        lat: 28.6139,
        lng: 77.209,
      },
    ],
  });
});

after(async () => {
  if (app) {
    await app.close();
  }
});

test("backend auth, batch, verification, dashboard, and ledger flows", async (t) => {
  const manufacturerToken = await login(TEST_USERS.manufacturer);
  const pharmacyOneToken = await login(TEST_USERS.pharmacyOne);
  const pharmacyTwoToken = await login(TEST_USERS.pharmacyTwo);
  const regulatorToken = await login(TEST_USERS.regulator);

  let createdBatchId: string;
  let batchCaseQr: string;
  let batchPackQr: string;
  let batchPackSerial: string;
  let impossibleTravelPackSerial: string;
  let impossibleTravelPackQr: string;
  let unshippedCaseCode: string;
  let unshippedPackQr: string;

  await t.test("auth rejects bad credentials and restricts roles", async () => {
    const invalidLogin = await request("/auth/login", {
      method: "POST",
      body: { email: TEST_USERS.manufacturer, password: "wrong-password" },
    });
    assert.equal(invalidLogin.status, 401);

    const emptyLogin = await request("/auth/login", {
      method: "POST",
      body: {},
    });
    assert.equal(emptyLogin.status, 400);

    const currentUser = await request<{
      email: string;
      passwordHash?: string;
    }>("/auth/me", { token: pharmacyOneToken });
    assert.equal(currentUser.status, 200);
    assert.equal(currentUser.body.email, TEST_USERS.pharmacyOne);
    assert.equal("passwordHash" in currentUser.body, false);

    const deniedBatch = await request("/batches", {
      token: pharmacyOneToken,
      method: "POST",
      body: {},
    });
    assert.equal(deniedBatch.status, 403);

    const deniedDashboard = await request("/dashboard/summary", {
      token: pharmacyOneToken,
    });
    assert.equal(deniedDashboard.status, 403);
  });

  await t.test("manufacturer batch creation generates signed QR content", async () => {
    const created = await request<{
      id: string;
      numCases: number;
      totalPacks: number;
    }>("/batches", {
      token: manufacturerToken,
      method: "POST",
      body: {
        drugName: "Integration Test Medicine",
        batchNumber: "BACKEND-TEST-VALID",
        mfgDate: "2026-01-01",
        expiryDate: "2030-01-01",
        numCases: 2,
        packsPerCase: 2,
      },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.numCases, 2);
    assert.equal(created.body.totalPacks, 4);
    createdBatchId = created.body.id;

    const sheet = await request<{
      cases: Array<{
        caseCode: string;
        content: string;
        packs: Array<{ serial: string; content: string }>;
      }>;
    }>(`/batches/${createdBatchId}/qr`, { token: manufacturerToken });
    assert.equal(sheet.status, 200);
    assert.equal(sheet.body.cases.length, 2);
    assert.equal(sheet.body.cases[0].packs.length, 2);

    const caseEntry = sheet.body.cases[0];
    batchCaseQr = caseEntry.content;
    batchPackQr = caseEntry.packs[0].content;
    batchPackSerial = caseEntry.packs[0].serial;
    impossibleTravelPackSerial = caseEntry.packs[1].serial;
    impossibleTravelPackQr = caseEntry.packs[1].content;
    unshippedCaseCode = sheet.body.cases[1].caseCode;
    unshippedPackQr = sheet.body.cases[1].packs[0].content;
    assert.equal(caseEntry.content.split(".")[1].length, 64);
    assert.equal(caseEntry.packs[0].content.split(".")[1].length, 64);

    const listed = await request<Array<{ id: string }>>("/batches", {
      token: manufacturerToken,
    });
    assert.equal(listed.status, 200);
    assert.ok(listed.body.some((batch) => batch.id === createdBatchId));

    const duplicate = await request("/batches", {
      token: manufacturerToken,
      method: "POST",
      body: {
        drugName: "Duplicate",
        batchNumber: "BACKEND-TEST-VALID",
        mfgDate: "2026-01-01",
        expiryDate: "2030-01-01",
        numCases: 1,
        packsPerCase: 1,
      },
    });
    assert.equal(duplicate.status, 409);

    const invalidBatch = await request("/batches", {
      token: manufacturerToken,
      method: "POST",
      body: {
        drugName: "Invalid",
        batchNumber: "BACKEND-TEST-INVALID-DATES",
        mfgDate: "2030-01-01",
        expiryDate: "2029-01-01",
        numCases: 1,
        packsPerCase: 1,
      },
    });
    assert.equal(invalidBatch.status, 400);
  });

  await t.test("shipments set an expected recipient and case receipts enforce it", async () => {
    const pharmacies = await request<Array<{ id: string }>>(
      "/shipments/recipients",
      { token: manufacturerToken },
    );
    assert.ok(pharmacies.body.length >= 2);
    const pharmacyOne = await prisma.user.findUniqueOrThrow({
      where: { email: TEST_USERS.pharmacyOne },
      select: { id: true },
    });

    const outsideReceipt = await request<{ result: ScanResult; reason: string }>(
      `/cases/${encodeURIComponent(unshippedCaseCode)}/receive`,
      {
        token: pharmacyTwoToken,
        method: "POST",
        body: {},
      },
    );
    assert.equal(outsideReceipt.body.result, ScanResult.SUSPICIOUS);
    assert.equal(outsideReceipt.body.reason, "outside intended chain");

    const shipped = await request<{ caseCode: string; repeated: boolean }>(
      "/shipments",
      {
        token: manufacturerToken,
        method: "POST",
        body: {
          caseCode: JSON.parse(
            Buffer.from(batchCaseQr.split(".")[0], "base64url").toString("utf8"),
          ).s as string,
          toOrgId: pharmacyOne.id,
        },
      },
    );
    assert.equal(shipped.status, 201);
    assert.equal(shipped.body.repeated, false);

    const caseCode = JSON.parse(
      Buffer.from(batchCaseQr.split(".")[0], "base64url").toString("utf8"),
    ).s as string;
    const received = await request<{
      result: ScanResult;
      packsReceived: number;
    }>(`/cases/${encodeURIComponent(caseCode)}/receive`, {
      token: pharmacyOneToken,
      method: "POST",
      body: {},
    });
    assert.equal(received.status, 200);
    assert.equal(received.body.result, ScanResult.GENUINE);
    assert.equal(received.body.packsReceived, 2);

    const caseRecord = await prisma.case.findUniqueOrThrow({
      where: { caseCode },
    });
    const packs = await prisma.pack.findMany({
      where: { caseId: caseRecord.id },
    });
    assert.equal(caseRecord.status, CaseStatus.RECEIVED);
    assert.ok(packs.every((pack) => pack.status === PackStatus.RECEIVED));

    const repeated = await request<{ result: ScanResult }>(
      `/cases/${encodeURIComponent(caseCode)}/receive`,
      {
      token: pharmacyOneToken,
      method: "POST",
      body: {},
      },
    );
    assert.equal(repeated.body.result, ScanResult.GENUINE);
    assert.equal(
      await prisma.ledgerEvent.count({
        where: {
          eventType: "CASE_RECEIVED",
          payload: { path: ["caseId"], equals: caseRecord.id },
        },
      }),
      1,
    );

    const secondPharmacy = await request<{ result: ScanResult; reason: string }>(
      `/cases/${encodeURIComponent(caseCode)}/receive`,
      {
        token: pharmacyTwoToken,
        method: "POST",
        body: {},
      },
    );
    assert.equal(secondPharmacy.body.result, ScanResult.SUSPICIOUS);
    assert.equal(secondPharmacy.body.reason, "outside intended chain");
  });

  await t.test("public checks never sell or flag by repeat count; sales are separate", async () => {
    const validResults: ScanResult[] = [];
    for (let scan = 0; scan < 4; scan += 1) {
      const result = await request<{ result: ScanResult; reasons: string[] }>(
        "/verify/check",
        {
          method: "POST",
          body: { payload: batchPackQr },
        },
      );
      assert.equal(result.status, 200);
      validResults.push(result.body.result);
      assert.deepEqual(result.body.reasons, []);
    }
    assert.deepEqual(validResults, [
      ScanResult.GENUINE,
      ScanResult.GENUINE,
      ScanResult.GENUINE,
      ScanResult.GENUINE,
    ]);
    const unchangedPack = await prisma.pack.findUniqueOrThrow({
      where: { serial: batchPackSerial },
    });
    assert.equal(unchangedPack.scanCount, 0);
    assert.equal(unchangedPack.status, PackStatus.RECEIVED);

    const firstSale = await request<{ result: ScanResult; sold: boolean }>(
      `/packs/${batchPackSerial}/sell`,
      { token: pharmacyOneToken, method: "POST", body: {} },
    );
    assert.equal(firstSale.body.result, ScanResult.GENUINE);
    assert.equal(firstSale.body.sold, true);

    const repeatedSale = await request<{
      result: ScanResult;
      reasons: string[];
    }>(`/packs/${batchPackSerial}/sell`, {
      token: pharmacyOneToken,
      method: "POST",
      body: {},
    });
    assert.equal(repeatedSale.body.result, ScanResult.SUSPICIOUS);
    assert.deepEqual(repeatedSale.body.reasons, ["already sold"]);

    const saleFromOtherOrg = await request<{
      result: ScanResult;
      reasons: string[];
    }>(`/packs/${batchPackSerial}/sell`, {
      token: pharmacyTwoToken,
      method: "POST",
      body: {},
    });
    assert.equal(saleFromOtherOrg.body.result, ScanResult.SUSPICIOUS);
    assert.deepEqual(saleFromOtherOrg.body.reasons, [
      "already sold",
      "sold by a different org than the one claiming it",
    ]);

    const afterSaleCheck = await request<{
      result: ScanResult;
      message: string;
      sold: boolean;
    }>("/verify/check", {
      method: "POST",
      body: { payload: batchPackQr },
    });
    assert.equal(afterSaleCheck.body.result, ScanResult.GENUINE);
    assert.equal(afterSaleCheck.body.sold, true);
    assert.match(afterSaleCheck.body.message, /Dispensed by Test Pharmacy One on/);

    const unshippedPackSerial = JSON.parse(
      Buffer.from(unshippedPackQr.split(".")[0], "base64url").toString("utf8"),
    ).s as string;
    const outsideSale = await request<{
      result: ScanResult;
      reasons: string[];
      sold: boolean;
    }>(`/packs/${unshippedPackSerial}/sell`, {
      token: pharmacyTwoToken,
      method: "POST",
      body: {},
    });
    assert.equal(outsideSale.body.result, ScanResult.SUSPICIOUS);
    assert.ok(outsideSale.body.reasons.includes("outside expected recipient"));
    assert.equal(outsideSale.body.sold, true);

    const devicesPack = await request<{ result: ScanResult; reasons: string[] }>(
      "/verify/check",
      {
        method: "POST",
        body: { payload: impossibleTravelPackQr, deviceId: "device-one" },
      },
    );
    assert.equal(devicesPack.body.result, ScanResult.GENUINE);
    await request("/verify/check", {
      method: "POST",
    body: { payload: impossibleTravelPackQr, deviceId: "device-two" },
    });
    const manyDevices = await request<{
      result: ScanResult;
      reasons: string[];
    }>("/verify/check", {
      method: "POST",
      body: { payload: impossibleTravelPackQr, deviceId: "device-three" },
    });
    assert.equal(manyDevices.body.result, ScanResult.SUSPICIOUS);
    assert.ok(manyDevices.body.reasons.includes("many distinct devices before sale"));

    const placeSerial = impossibleTravelPackSerial;
    const old = Date.now();
    await prisma.scan.createMany({
      data: [
        {
          targetType: ScanTargetType.PACK,
          action: ScanAction.CHECK,
          serialOrCode: placeSerial,
          result: ScanResult.GENUINE,
          lat: 26.1445,
          lng: 91.7362,
          createdAt: new Date(old - 6 * 3_600_000),
        },
        {
          targetType: ScanTargetType.PACK,
          action: ScanAction.CHECK,
          serialOrCode: placeSerial,
          result: ScanResult.GENUINE,
          lat: 25.5941,
          lng: 85.1376,
          createdAt: new Date(old - 3 * 3_600_000),
        },
      ],
    });
    const manyPlaces = await request<{
      result: ScanResult;
      reasons: string[];
    }>("/verify/check", {
      method: "POST",
      body: {
        payload: impossibleTravelPackQr,
        lat: 22.5726,
        lng: 88.3639,
        deviceId: "place-check-device",
      },
    });
    assert.equal(manyPlaces.body.result, ScanResult.SUSPICIOUS);
    assert.ok(manyPlaces.body.reasons.includes("many distinct places before sale"));

    const buyerReport = await request<{ accepted: boolean }>("/reports", {
      method: "POST",
      body: { payload: batchPackQr, message: "I bought this elsewhere" },
    });
    assert.equal(buyerReport.status, 201);
    assert.equal(buyerReport.body.accepted, true);

    const invalidSignature = `${batchPackQr.slice(0, -1)}${batchPackQr.endsWith("0") ? "1" : "0"}`;
    const invalid = await request<{ result: ScanResult; reason: string }>(
      "/verify/check",
      {
        method: "POST",
        body: { payload: invalidSignature },
      },
    );
    assert.equal(invalid.body.result, ScanResult.UNKNOWN);
    assert.equal(invalid.body.reason, "signature invalid");

    const unknown = await request<{ result: ScanResult; reason: string }>(
      "/verify/check",
      {
        method: "POST",
        body: { payload: createQr("P", "unregistered-pack") },
      },
    );
    assert.equal(unknown.body.result, ScanResult.UNKNOWN);
    assert.equal(unknown.body.reason, "serial not found");

    const createdExpired = await request<{ id: string }>(
      "/batches",
      {
        token: manufacturerToken,
        method: "POST",
        body: {
          drugName: "Expired Test Medicine",
          batchNumber: "BACKEND-TEST-EXPIRED",
          mfgDate: "2020-01-01",
          expiryDate: "2021-01-01",
          numCases: 1,
          packsPerCase: 1,
        },
      },
    );
    assert.equal(createdExpired.status, 201);
    const expiredSheet = await request<{
      cases: Array<{ packs: Array<{ content: string }> }>;
    }>(`/batches/${createdExpired.body.id}/qr`, {
      token: manufacturerToken,
    });
    const expired = await request<{ result: ScanResult }>("/verify/check", {
      method: "POST",
      body: { payload: expiredSheet.body.cases[0].packs[0].content },
    });
    assert.equal(expired.body.result, ScanResult.EXPIRED);
  });

  await t.test("impossible travel and scan input validation are enforced", async () => {
    const pharmacyOne = await prisma.user.findUniqueOrThrow({
      where: { email: TEST_USERS.pharmacyOne },
    });
    await prisma.scan.create({
      data: {
        scannedBy: pharmacyOne.id,
        targetType: ScanTargetType.PACK,
        action: ScanAction.CHECK,
        serialOrCode: impossibleTravelPackSerial,
        result: ScanResult.GENUINE,
        lat: 19.076,
        lng: 72.8777,
        createdAt: new Date(Date.now() - 3_600_000),
      },
    });
    const qrSheet = await request<{
      cases: Array<{ packs: Array<{ serial: string; content: string }> }>;
    }>(`/batches/${createdBatchId}/qr`, { token: manufacturerToken });
    const travelPack = qrSheet.body.cases
      .flatMap((item) => item.packs)
      .find((pack) => pack.serial === impossibleTravelPackSerial);
    assert.ok(travelPack);

    const travel = await request<{ result: ScanResult; reasons: string[] }>(
      "/verify/check",
      {
        method: "POST",
        body: {
          payload: travelPack.content,
          lat: 26.1445,
          lng: 91.7362,
          deviceId: "travel-test-device",
        },
      },
    );
    assert.equal(travel.body.result, ScanResult.SUSPICIOUS);
    assert.ok(travel.body.reasons.includes("impossible travel"));

    const halfCoordinates = await request("/verify/check", {
      method: "POST",
      body: { payload: travelPack.content, lat: 26.1445 },
    });
    assert.equal(halfCoordinates.status, 400);

    const invalidCoordinates = await request("/verify/check", {
      method: "POST",
      body: { payload: travelPack.content, lat: 120, lng: 10 },
    });
    assert.equal(invalidCoordinates.status, 400);

    const unknownCase = await request("/cases/unregistered-case/receive", {
      token: pharmacyOneToken,
      method: "POST",
      body: {},
    });
    assert.equal(unknownCase.status, 404);
  });

  await t.test("dashboard data is paginated, filtered, and regulator-only", async () => {
    const summary = await request<{
      totalScans: number;
      genuine: number;
      suspicious: number;
      expired: number;
      unknown: number;
    }>("/dashboard/summary", { token: regulatorToken });
    assert.equal(summary.status, 200);
    assert.ok(summary.body.totalScans > 0);
    assert.ok(summary.body.suspicious > 0);
    assert.ok(summary.body.expired > 0);
    assert.ok(summary.body.unknown > 0);

    const flagged = await request<{
      data: Array<{ reason: string | null }>;
      pagination: { total: number; page: number; limit: number };
    }>("/dashboard/flagged?page=1&limit=1", { token: regulatorToken });
    assert.equal(flagged.status, 200);
    assert.equal(flagged.body.data.length, 1);
    assert.ok(flagged.body.data[0].reason);
    assert.ok(flagged.body.pagination.total > 0);

    const filtered = await request<{
      data: Array<{ result: ScanResult }>;
    }>("/dashboard/scans?result=EXPIRED&targetType=PACK", {
      token: regulatorToken,
    });
    assert.equal(filtered.status, 200);
    assert.ok(filtered.body.data.length > 0);
    assert.ok(
      filtered.body.data.every((scan) => scan.result === ScanResult.EXPIRED),
    );

    const badFilter = await request("/dashboard/scans?limit=999", {
      token: regulatorToken,
    });
    assert.equal(badFilter.status, 400);

    const hotspots = await request<
      Array<{ lat: number; lng: number; count: number }>
    >("/dashboard/hotspots", { token: regulatorToken });
    assert.equal(hotspots.status, 200);
    assert.ok(
      hotspots.body.some(
        (spot) => spot.lat === 26.1445 && spot.lng === 91.7362,
      ),
    );

    const reconciliation = await request<
      Array<{
        pharmacy: { email: string };
        flagged: boolean;
        reasons: string[];
        outsideShipmentPacks: number;
      }>
    >("/reports/reconciliation", { token: regulatorToken });
    assert.equal(reconciliation.status, 200);
    const pharmacyTwoStock = reconciliation.body.find(
      (item) => item.pharmacy.email === TEST_USERS.pharmacyTwo,
    );
    assert.ok(pharmacyTwoStock?.flagged);
    assert.ok(pharmacyTwoStock?.outsideShipmentPacks > 0);
  });

  await t.test("ledger verification detects tampering and validates restoration", async () => {
    const validBefore = await request<{
      valid: boolean;
      checkedEvents: number;
    }>("/ledger/verify", { token: regulatorToken });
    assert.equal(validBefore.status, 200);
    assert.equal(validBefore.body.valid, true);
    assert.ok(validBefore.body.checkedEvents > 0);

    const events = await request<Array<{ id: string; hash: string }>>(
      "/ledger/events?limit=2",
      { token: regulatorToken },
    );
    assert.equal(events.status, 200);
    assert.equal(events.body.length, 2);
    assert.equal(typeof events.body[0].id, "string");

    const first = await prisma.ledgerEvent.findFirstOrThrow({
      orderBy: { id: "asc" },
    });
    const originalPayload = structuredClone(first.payload);
    await prisma.ledgerEvent.update({
      where: { id: first.id },
      data: { payload: { tampered: true } },
    });

    const tampered = await request<{
      valid: boolean;
      brokenAtId: string | null;
    }>("/ledger/verify", { token: regulatorToken });
    assert.equal(tampered.body.valid, false);
    assert.equal(tampered.body.brokenAtId, first.id.toString());

    await prisma.ledgerEvent.update({
      where: { id: first.id },
      data: { payload: originalPayload as Prisma.InputJsonValue },
    });
    const restored = await request<{ valid: boolean }>("/ledger/verify", {
      token: regulatorToken,
    });
    assert.equal(restored.body.valid, true);

    const deniedEvents = await request("/ledger/events", {
      token: pharmacyOneToken,
    });
    assert.equal(deniedEvents.status, 403);

    const anchorResponse = await request<{
      fromEventId: string;
      toEventId: string;
      merkleRoot: string;
      eventCount: number;
    }>("/ledger/anchor?limit=2", {
      token: regulatorToken,
      method: "POST",
    });
    assert.equal(anchorResponse.status, 201, JSON.stringify(anchorResponse.body));
    assert.equal(anchorResponse.body.eventCount, 2);
    assert.match(anchorResponse.body.merkleRoot, /^[a-f0-9]{64}$/);

    const anchors = await request<
      Array<{
        fromEventId: string;
        toEventId: string;
        merkleRoot: string;
      }>
    >("/ledger/anchors", { token: regulatorToken });
    assert.equal(anchors.status, 200);
    assert.equal(anchors.body[0].fromEventId, anchorResponse.body.fromEventId);
    assert.equal(anchors.body[0].toEventId, anchorResponse.body.toEventId);
    assert.equal(anchors.body[0].merkleRoot, anchorResponse.body.merkleRoot);

    const remainingAnchor = await request("/ledger/anchor?limit=1000", {
      token: regulatorToken,
      method: "POST",
    });
    assert.equal(remainingAnchor.status, 201);

    const noUnanchoredEvents = await request("/ledger/anchor", {
      token: regulatorToken,
      method: "POST",
    });
    assert.equal(noUnanchoredEvents.status, 400);

    const deniedAnchor = await request("/ledger/anchor", {
      token: pharmacyOneToken,
      method: "POST",
    });
    assert.equal(deniedAnchor.status, 403);
  });

  await t.test("public checks rate-limit a source without mutating pack state", async () => {
    const firstCheck = await prisma.scan.findFirstOrThrow({
      where: {
        action: ScanAction.CHECK,
        sourceIpHash: { not: null },
      },
      select: { sourceIpHash: true },
    });
    const since = new Date(Date.now() - 60_000);
    let checksInWindow = await prisma.scan.count({
      where: {
        action: ScanAction.CHECK,
        sourceIpHash: firstCheck.sourceIpHash,
        createdAt: { gte: since },
      },
    });
    const rateLimitQrValues = [
      batchPackQr,
      impossibleTravelPackQr,
      unshippedPackQr,
    ];
    let requestIndex = 0;
    while (checksInWindow < 60) {
      const response = await request("/verify/check", {
        method: "POST",
        body: {
          payload: rateLimitQrValues[requestIndex % rateLimitQrValues.length],
        },
      });
      assert.equal(response.status, 200);
      checksInWindow += 1;
      requestIndex += 1;
    }

    const limited = await request("/verify/check", {
      method: "POST",
      body: { payload: batchPackQr },
    });
    assert.equal(limited.status, 429);
    const pack = await prisma.pack.findUniqueOrThrow({
      where: { serial: batchPackSerial },
    });
    assert.equal(pack.status, PackStatus.SOLD);
    assert.equal(pack.scanCount, 0);
  });
});
