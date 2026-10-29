import { createHash, createHmac, randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import { getAppSecret } from "../src/config/secrets";
import { hash } from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  CaseStatus,
  PackStatus,
  Prisma,
  PrismaClient,
  ScanResult,
  ScanTargetType,
  UserRole,
} from "@prisma/client";
import { Pool } from "pg";

loadEnv({ path: resolve(process.cwd(), "../.env") });

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL must be set before seeding the database");
}
const databaseHost = new URL(connectionString).hostname;
if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(databaseHost)) {
  throw new Error(
    `Refusing to reset non-local database host "${databaseHost}". Seed only a local demo database.`,
  );
}
const hmacSecret = getAppSecret("QR_HMAC_SECRET");

const pool = new Pool({ connectionString });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const demoUsers = [
  {
    name: "Demo Manufacturer",
    email: "manufacturer@xuino.demo",
    role: UserRole.MANUFACTURER,
    locationName: "XUINO Manufacturing, Guwahati",
    lat: 26.1445,
    lng: 91.7362,
  },
  {
    name: "Guwahati Pharmacy",
    email: "pharmacy.guwahati@xuino.demo",
    role: UserRole.PHARMACY,
    locationName: "Guwahati Pharmacy",
    lat: 26.1445,
    lng: 91.7362,
  },
  {
    name: "Mumbai Pharmacy",
    email: "pharmacy.mumbai@xuino.demo",
    role: UserRole.PHARMACY,
    locationName: "Mumbai Pharmacy",
    lat: 19.076,
    lng: 72.8777,
  },
  {
    name: "Demo Regulator",
    email: "regulator@xuino.demo",
    role: UserRole.REGULATOR,
    locationName: "National Regulator",
    lat: 28.6139,
    lng: 77.209,
  },
];

function qrSignature(type: "P" | "C", serialOrCode: string): string {
  return createHmac("sha256", hmacSecret)
    .update(`${type}.${serialOrCode}`)
    .digest("hex");
}

async function appendSeedEvent(
  tx: Prisma.TransactionClient,
  eventType: string,
  payload: Prisma.InputJsonValue,
  createdAt: Date,
): Promise<void> {
  const previous = await tx.ledgerEvent.findFirst({
    orderBy: { id: "desc" },
    select: { hash: true },
  });
  const prevHash = previous?.hash ?? "GENESIS";
  const normalize = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map(normalize);
    }
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, nestedValue]) => [key, normalize(nestedValue)]),
      );
    }
    return value;
  };
  const hash = createHash("sha256")
    .update(
      `${prevHash}${eventType}${JSON.stringify(normalize(payload))}${createdAt.toISOString()}`,
    )
    .digest("hex");

  await tx.ledgerEvent.create({
    data: { eventType, payload, prevHash, hash, createdAt },
  });
}

async function main(): Promise<void> {
  const passwordHash = await hash("DemoPass123!", 10);

  await prisma.$transaction(async (tx) => {
    await tx.merkleAnchor.deleteMany();
    await tx.ledgerEvent.deleteMany();
    await tx.scan.deleteMany();
    await tx.pack.deleteMany();
    await tx.case.deleteMany();
    await tx.batch.deleteMany();
    await tx.apiLot.deleteMany();
    await tx.user.deleteMany();

    const users = await Promise.all(
      demoUsers.map((user) =>
        tx.user.create({ data: { ...user, passwordHash } }),
      ),
    );
    const manufacturer = users.find(
      (user) => user.role === UserRole.MANUFACTURER,
    );
    const guwahatiPharmacy = users.find(
      (user) => user.email === "pharmacy.guwahati@xuino.demo",
    );
    if (!manufacturer || !guwahatiPharmacy) {
      throw new Error("Required demo accounts were not created");
    }

    const apiLot = await tx.apiLot.create({
      data: { lotNumber: "API-DEMO-001", supplier: "Demo API Supplier" },
    });

    const now = new Date();
    const currentYear = now.getUTCFullYear();
    const batches = [
      {
        drugName: "Paracetamol 500 mg",
        batchNumber: "XUINO-DEMO-2026-001",
        mfgDate: new Date(Date.UTC(currentYear - 1, 0, 1)),
        expiryDate: new Date(Date.UTC(currentYear + 2, 0, 1)),
      },
      {
        drugName: "Amoxicillin 250 mg",
        batchNumber: "XUINO-DEMO-EXPIRED",
        mfgDate: new Date(Date.UTC(currentYear - 4, 0, 1)),
        expiryDate: new Date(Date.UTC(currentYear - 1, 0, 1)),
      },
    ];

    for (const [batchIndex, batchData] of batches.entries()) {
      const batch = await tx.batch.create({
        data: {
          ...batchData,
          manufacturerId: manufacturer.id,
          apiLotId: apiLot.id,
        },
      });
      await appendSeedEvent(
        tx,
        "BATCH_REGISTERED",
        {
          batchId: batch.id,
          batchNumber: batch.batchNumber,
          manufacturerId: manufacturer.id,
        },
        now,
      );

      for (let caseIndex = 0; caseIndex < 3; caseIndex += 1) {
        const received = batchIndex === 0 && caseIndex === 0;
        const caseCode = `CASE-${batchIndex + 1}-${caseIndex + 1}-${randomBytes(8).toString("hex")}`;
        const createdCase = await tx.case.create({
          data: {
            batchId: batch.id,
            caseCode,
            signature: qrSignature("C", caseCode),
            status: received ? CaseStatus.RECEIVED : CaseStatus.CREATED,
            receivedBy: received ? guwahatiPharmacy.id : null,
            receivedAt: received ? now : null,
            expectedRecipientOrgId: received ? guwahatiPharmacy.id : null,
            shippedAt: received ? now : null,
          },
        });
        const packs = Array.from({ length: 10 }, () => {
          const serial = randomBytes(16).toString("hex");
          return {
            caseId: createdCase.id,
            serial,
            signature: qrSignature("P", serial),
            status: received ? PackStatus.RECEIVED : PackStatus.ACTIVE,
          };
        });
        await tx.pack.createMany({ data: packs });

        if (received) {
          await appendSeedEvent(
            tx,
            "SHIPPED",
            {
              caseId: createdCase.id,
              caseCode: createdCase.caseCode,
              fromOrgId: manufacturer.id,
              toOrgId: guwahatiPharmacy.id,
            },
            now,
          );
          await appendSeedEvent(
            tx,
            "CASE_RECEIVED",
            {
              caseId: createdCase.id,
              caseCode: createdCase.caseCode,
              receivedBy: guwahatiPharmacy.id,
            },
            now,
          );
        }
      }
    }

    const unknownScan = await tx.scan.create({
      data: {
        scannedBy: guwahatiPharmacy.id,
        targetType: ScanTargetType.PACK,
        serialOrCode: "UNKNOWN-DEMO-SERIAL",
        result: ScanResult.UNKNOWN,
        reason: "Seeded unknown serial for dashboard demo",
        lat: guwahatiPharmacy.lat,
        lng: guwahatiPharmacy.lng,
      },
    });
    await appendSeedEvent(
      tx,
      "PACK_SCANNED",
      {
        scanId: unknownScan.id,
        serialOrCode: unknownScan.serialOrCode,
        result: unknownScan.result,
      },
      now,
    );
  });

  console.log(
    "Database reset and seeded with 4 demo users, 2 batches, 6 cases, and 60 packs.",
  );
  console.log("Demo password for all seeded accounts: DemoPass123!");
}

main()
  .catch((error: unknown) => {
    console.error("Failed to reset and seed the database:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
