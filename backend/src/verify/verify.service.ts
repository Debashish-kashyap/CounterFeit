import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  CaseStatus,
  Prisma,
  ScanResult,
  ScanTargetType,
  UserRole,
} from "@prisma/client";
import { createHmac, timingSafeEqual } from "node:crypto";
import { AuthUser } from "../auth/auth-user";
import { AnomalyService } from "../anomaly/anomaly.service";
import { LedgerService } from "../ledger/ledger.service";
import { PrismaService } from "../prisma/prisma.service";
import { QrTargetType } from "../qr/qr-payload.service";
import { VerifyQrDto } from "./dto/verify-qr.dto";

interface ParsedQr {
  type: QrTargetType;
  serialOrCode: string;
  signature: string;
}

interface ParsedQrResult {
  qr: ParsedQr | null;
  signatureValid: boolean;
}

const UNKNOWN_SERIAL_PREFIX = "INVALID_QR:";

function localDateStart(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

@Injectable()
export class VerifyService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LedgerService) private readonly ledger: LedgerService,
    @Inject(AnomalyService) private readonly anomaly: AnomalyService,
  ) {}

  async verifyPack(dto: VerifyQrDto, user: AuthUser) {
    this.assertPharmacy(user);
    this.assertCoordinates(dto);
    const parsed = this.parseAndVerify(dto.payload, "P");

    if (!parsed.qr || !parsed.signatureValid) {
      const location = await this.resolveCoordinates(dto, user.id);
      const serialOrCode =
        parsed.qr?.serialOrCode ??
        `${UNKNOWN_SERIAL_PREFIX}${dto.payload.slice(0, 256)}`;
      await this.recordUnknownScan(
        user,
        ScanTargetType.PACK,
        serialOrCode,
        location,
        parsed.qr ? "signature invalid" : "QR payload invalid",
        true,
      );
      return {
        result: ScanResult.UNKNOWN,
        reason: parsed.qr ? "signature invalid" : "QR payload invalid",
        batch: null,
        expiry: null,
        scanCount: null,
      };
    }

    const { serialOrCode } = parsed.qr;
    const location = await this.resolveCoordinates(dto, user.id);
    const pack = await this.prisma.pack.findUnique({
      where: { serial: serialOrCode },
      include: { parentCase: { include: { batch: true } } },
    });

    if (!pack) {
      await this.recordUnknownScan(
        user,
        ScanTargetType.PACK,
        serialOrCode,
        location,
        "serial not found",
        true,
      );
      return {
        result: ScanResult.UNKNOWN,
        reason: "serial not found",
        batch: null,
        expiry: null,
        scanCount: null,
      };
    }

    const scannedAt = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.pack.update({
        where: { id: pack.id },
        data: {
          scanCount: { increment: 1 },
          firstScannedAt: pack.firstScannedAt ?? scannedAt,
        },
        select: { scanCount: true, status: true },
      });

      const previousScans = await tx.scan.findMany({
        where: { serialOrCode, targetType: ScanTargetType.PACK },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { scannedBy: true, lat: true, lng: true, createdAt: true },
      });
      const anomalyReasons = this.anomaly.evaluatePackScan(
        updated.scanCount,
        user,
        {
          lat: location.lat,
          lng: location.lng,
          createdAt: scannedAt,
        },
        previousScans,
      );
      if (pack.parentCase.receivedBy !== user.id) {
        anomalyReasons.push(
          pack.parentCase.receivedBy
            ? "pack scanned at a different pharmacy than its received case"
            : "parent case has not been received by this pharmacy",
        );
      }

      const expired =
        localDateStart(pack.parentCase.batch.expiryDate) <
        localDateStart(scannedAt);
      const result =
        expired
          ? ScanResult.EXPIRED
          : anomalyReasons.length > 0 || updated.status === "FLAGGED"
            ? ScanResult.SUSPICIOUS
            : ScanResult.GENUINE;
      const reason = expired
        ? "batch expired"
        : anomalyReasons.length > 0
          ? anomalyReasons.join("; ")
          : updated.status === "FLAGGED"
            ? "pack previously flagged"
            : null;

      const scan = await tx.scan.create({
        data: {
          scannedBy: user.id,
          targetType: ScanTargetType.PACK,
          serialOrCode,
          result,
          reason,
          lat: location.lat,
          lng: location.lng,
          createdAt: scannedAt,
        },
      });

      if (result === ScanResult.SUSPICIOUS) {
        await tx.pack.update({
          where: { id: pack.id },
          data: { status: "FLAGGED" },
        });
      }

      await this.ledger.append(
        tx,
        "PACK_SCANNED",
        {
          scanId: scan.id,
          packId: pack.id,
          serial: serialOrCode,
          scannedBy: user.id,
          result,
          reason,
        },
        scannedAt,
      );

      if (result === ScanResult.SUSPICIOUS) {
        await this.ledger.append(
          tx,
          "FLAGGED",
          {
            targetType: "PACK",
            packId: pack.id,
            serial: serialOrCode,
            reason,
          },
          scannedAt,
        );
      }

      return { result, reason, scanCount: updated.scanCount };
    });

    return {
      ...result,
      batch: {
        drugName: pack.parentCase.batch.drugName,
        batchNumber: pack.parentCase.batch.batchNumber,
      },
      expiry: pack.parentCase.batch.expiryDate,
    };
  }

  async verifyCase(dto: VerifyQrDto, user: AuthUser) {
    this.assertPharmacy(user);
    this.assertCoordinates(dto);
    const parsed = this.parseAndVerify(dto.payload, "C");

    if (!parsed.qr || !parsed.signatureValid) {
      const location = await this.resolveCoordinates(dto, user.id);
      const caseCode =
        parsed.qr?.serialOrCode ??
        `${UNKNOWN_SERIAL_PREFIX}${dto.payload.slice(0, 256)}`;
      await this.recordUnknownScan(
        user,
        ScanTargetType.CASE,
        caseCode,
        location,
        parsed.qr ? "signature invalid" : "QR payload invalid",
        false,
      );
      return {
        result: ScanResult.UNKNOWN,
        reason: parsed.qr ? "signature invalid" : "QR payload invalid",
        packsReceived: 0,
        batch: null,
        expiry: null,
      };
    }

    const { serialOrCode: caseCode } = parsed.qr;
    const location = await this.resolveCoordinates(dto, user.id);
    const scannedAt = new Date();
    return this.prisma.$transaction(async (tx) => {
      let existingCase = await tx.case.findUnique({
        where: { caseCode },
        include: {
          batch: true,
          _count: { select: { packs: true } },
        },
      });

      if (!existingCase) {
        await tx.scan.create({
          data: {
            scannedBy: user.id,
            targetType: ScanTargetType.CASE,
            serialOrCode: caseCode,
            result: ScanResult.UNKNOWN,
            reason: "case code not found",
            lat: location.lat,
            lng: location.lng,
            createdAt: scannedAt,
          },
        });
        return {
          result: ScanResult.UNKNOWN,
          reason: "case code not found",
          packsReceived: 0,
          batch: null,
          expiry: null,
        };
      }

      await tx.$queryRaw<{ id: string }[]>`
        SELECT id::text AS id FROM cases WHERE id = ${existingCase.id}::uuid FOR UPDATE
      `;
      existingCase = await tx.case.findUnique({
        where: { id: existingCase.id },
        include: {
          batch: true,
          _count: { select: { packs: true } },
        },
      });
      if (!existingCase) {
        throw new BadRequestException("Case no longer exists");
      }

      const receivedElsewhere =
        existingCase.status === CaseStatus.RECEIVED &&
        existingCase.receivedBy !== user.id;
      if (receivedElsewhere) {
        const reason = "case received at two places";
        const scan = await tx.scan.create({
          data: {
            scannedBy: user.id,
            targetType: ScanTargetType.CASE,
            serialOrCode: caseCode,
            result: ScanResult.SUSPICIOUS,
            reason,
            lat: location.lat,
            lng: location.lng,
            createdAt: scannedAt,
          },
        });
        await this.ledger.append(
          tx,
          "FLAGGED",
          {
            scanId: scan.id,
            targetType: "CASE",
            caseId: existingCase.id,
            caseCode,
            firstReceivedBy: existingCase.receivedBy,
            attemptedReceivedBy: user.id,
            reason,
          },
          scannedAt,
        );

        return {
          result: ScanResult.SUSPICIOUS,
          reason,
          packsReceived: 0,
          batch: {
            drugName: existingCase.batch.drugName,
            batchNumber: existingCase.batch.batchNumber,
          },
          expiry: existingCase.batch.expiryDate,
        };
      }

      const alreadyReceived = existingCase.status === CaseStatus.RECEIVED;
      if (!alreadyReceived) {
        await tx.case.update({
          where: { id: existingCase.id },
          data: {
            status: CaseStatus.RECEIVED,
            receivedBy: user.id,
            receivedAt: scannedAt,
          },
        });
      }

      const scan = await tx.scan.create({
        data: {
          scannedBy: user.id,
          targetType: ScanTargetType.CASE,
          serialOrCode: caseCode,
          result: ScanResult.GENUINE,
          reason: alreadyReceived ? "case already received by this pharmacy" : null,
          lat: location.lat,
          lng: location.lng,
          createdAt: scannedAt,
        },
      });

      if (!alreadyReceived) {
        await this.ledger.append(
          tx,
          "CASE_RECEIVED",
          {
            scanId: scan.id,
            caseId: existingCase.id,
            caseCode,
            receivedBy: user.id,
            packsReceived: existingCase._count.packs,
          },
          scannedAt,
        );
      }

      return {
        result: ScanResult.GENUINE,
        reason: alreadyReceived ? "case already received by this pharmacy" : null,
        packsReceived: existingCase._count.packs,
        batch: {
          drugName: existingCase.batch.drugName,
          batchNumber: existingCase.batch.batchNumber,
        },
        expiry: existingCase.batch.expiryDate,
      };
    });
  }

  private parseAndVerify(
    content: string,
    expectedType: QrTargetType,
  ): ParsedQrResult {
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

    const parts = content.split(".");
    if (parts.length !== 2 || !/^[a-f0-9]{64}$/i.test(parts[1])) {
      return { qr: null, signatureValid: false };
    }

    let value: unknown;
    try {
      const decoded = Buffer.from(parts[0], "base64url");
      if (decoded.toString("base64url") !== parts[0]) {
        return { qr: null, signatureValid: false };
      }
      value = JSON.parse(decoded.toString("utf8"));
    } catch {
      return { qr: null, signatureValid: false };
    }

    if (
      value === null ||
      typeof value !== "object" ||
      !("t" in value) ||
      !("s" in value) ||
      !("v" in value)
    ) {
      return { qr: null, signatureValid: false };
    }
    const data = value as { t: unknown; s: unknown; v: unknown };
    if (
      data.t !== expectedType ||
      data.v !== 1 ||
      typeof data.s !== "string" ||
      data.s.length < 1 ||
      data.s.length > 128 ||
      !/^[A-Za-z0-9_-]+$/.test(data.s)
    ) {
      return { qr: null, signatureValid: false };
    }

    const qr: ParsedQr = {
      type: expectedType,
      serialOrCode: data.s,
      signature: parts[1].toLowerCase(),
    };
    const expected = createHmac("sha256", secret)
      .update(`${qr.type}.${qr.serialOrCode}`)
      .digest();
    const provided = Buffer.from(qr.signature, "hex");
    return {
      qr,
      signatureValid:
        provided.length === expected.length &&
        timingSafeEqual(provided, expected),
    };
  }

  private async recordUnknownScan(
    user: AuthUser,
    targetType: ScanTargetType,
    serialOrCode: string,
    location: { lat: number | null; lng: number | null },
    reason: string,
    appendLedger: boolean,
  ): Promise<void> {
    const createdAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      const scan = await tx.scan.create({
        data: {
          scannedBy: user.id,
          targetType,
          serialOrCode,
          result: ScanResult.UNKNOWN,
          reason,
          lat: location.lat,
          lng: location.lng,
          createdAt,
        },
      });
      if (appendLedger) {
        await this.ledger.append(
          tx,
          "PACK_SCANNED",
          {
            scanId: scan.id,
            targetType,
            serialOrCode,
            scannedBy: user.id,
            result: ScanResult.UNKNOWN,
            reason,
          },
          createdAt,
        );
      }
    });
  }

  private assertPharmacy(user: AuthUser): void {
    if (user.role !== UserRole.PHARMACY) {
      throw new ForbiddenException("Only pharmacy users can verify QR codes");
    }
  }

  private assertCoordinates(dto: VerifyQrDto): void {
    if ((dto.lat === undefined) !== (dto.lng === undefined)) {
      throw new BadRequestException(
        "Provide both lat and lng, or omit both coordinates",
      );
    }
  }

  private async resolveCoordinates(
    dto: VerifyQrDto,
    userId: string,
  ): Promise<{ lat: number | null; lng: number | null }> {
    if (dto.lat !== undefined && dto.lng !== undefined) {
      return { lat: dto.lat, lng: dto.lng };
    }

    const location = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { lat: true, lng: true },
    });
    if (!location || location.lat === null || location.lng === null) {
      return { lat: null, lng: null };
    }
    return { lat: location.lat, lng: location.lng };
  }
}
