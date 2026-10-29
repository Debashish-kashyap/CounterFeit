import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  CaseStatus,
  PackStatus,
  Prisma,
  ScanAction,
  ScanResult,
  ScanTargetType,
  UserRole,
} from "@prisma/client";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { getAppSecret } from "../config/secrets";
import { AuthUser } from "../auth/auth-user";
import { LedgerService } from "../ledger/ledger.service";
import { PrismaService } from "../prisma/prisma.service";
import { CheckPackDto } from "./dto/check-pack.dto";
import { ConsumerReportDto } from "./dto/consumer-report.dto";
import { RecordEventDto } from "./dto/record-event.dto";
import { ShipCaseDto } from "./dto/ship-case.dto";

const IP_CHECKS_PER_MINUTE = 60;
const PACK_CHECKS_PER_MINUTE = 30;
const DEVICE_ANOMALY_THRESHOLD = 3;
const PLACE_ANOMALY_THRESHOLD = 3;
const DISTINCT_PLACE_DISTANCE_KM = 10;
const MAX_TRAVEL_SPEED_KMH = 800;
const EARTH_RADIUS_KM = 6371;

interface RequestMetadata {
  ip?: string;
}

interface ParsedPayload {
  type: "P" | "C";
  serial: string;
}

export interface CheckResult {
  result: ScanResult;
  reasons: string[];
  reason: string | null;
  message: string | null;
}

export interface CheckPackResponse extends CheckResult {
  batch?: { drugName: string; batchNumber: string } | null;
  expiry?: Date | null;
  sold?: boolean;
  saleRecorded?: boolean;
  soldAt?: Date;
  soldBy?: { id: string; name: string };
}

function hashIp(ip: string | undefined): string | null {
  return ip ? createHash("sha256").update(ip).digest("hex") : null;
}

function distanceKm(
  first: { lat: number; lng: number },
  second: { lat: number; lng: number },
): number {
  const radians = (value: number) => (value * Math.PI) / 180;
  const latitudeDelta = radians(second.lat - first.lat);
  const longitudeDelta = radians(second.lng - first.lng);
  const firstLatitude = radians(first.lat);
  const secondLatitude = radians(second.lat);
  const value =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(firstLatitude) *
      Math.cos(secondLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(value));
}

function localDateStart(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

@Injectable()
export class SupplyChainService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LedgerService) private readonly ledger: LedgerService,
  ) {}

  async checkPack(
    dto: CheckPackDto,
    metadata: RequestMetadata,
  ): Promise<CheckPackResponse> {
    this.assertCoordinates(dto);
    const sourceIpHash = hashIp(metadata.ip);
    await this.enforceIpRateLimit(sourceIpHash);
    const parsed = this.parseAndVerify(dto.payload, "P");
    const checkedAt = new Date();
    const deviceId = dto.deviceId?.trim() || null;

    if (!parsed) {
      const reason = "signature invalid";
      await this.recordCheck({
        serial: `INVALID_QR:${dto.payload.slice(0, 256)}`,
        result: ScanResult.UNKNOWN,
        reasons: [reason],
        checkedAt,
        sourceIpHash,
        deviceId,
        lat: dto.lat ?? null,
        lng: dto.lng ?? null,
      });
      return this.checkResponse(ScanResult.UNKNOWN, [reason]);
    }

    await this.enforcePackRateLimit(parsed.serial, checkedAt);
    const pack = await this.prisma.pack.findUnique({
      where: { serial: parsed.serial },
      include: {
        parentCase: {
          include: {
            batch: true,
            expectedRecipient: { select: { id: true, name: true } },
          },
        },
        soldBy: { select: { id: true, name: true } },
      },
    });

    if (!pack) {
      await this.recordCheck({
        serial: parsed.serial,
        result: ScanResult.UNKNOWN,
        reasons: ["serial not found"],
        checkedAt,
        sourceIpHash,
        deviceId,
        lat: dto.lat ?? null,
        lng: dto.lng ?? null,
      });
      return this.checkResponse(ScanResult.UNKNOWN, ["serial not found"]);
    }

    const previousEvents = await this.prisma.scan.findMany({
      where: {
        serialOrCode: parsed.serial,
        targetType: ScanTargetType.PACK,
        action: { in: [ScanAction.CHECK, ScanAction.SALE] },
        createdAt: { lte: checkedAt },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        action: true,
        deviceId: true,
        lat: true,
        lng: true,
        createdAt: true,
      },
    });

    const reasons = this.checkConflictReasons(
      previousEvents,
      {
        deviceId,
        lat: dto.lat ?? null,
        lng: dto.lng ?? null,
        createdAt: checkedAt,
      },
      pack.soldAt,
    );
    if (
      pack.soldAt &&
      (pack.parentCase.shippedAt === null ||
        pack.parentCase.expectedRecipientOrgId !== pack.soldByOrgId)
    ) {
      reasons.push("outside expected recipient");
    }
    const expired =
      localDateStart(pack.parentCase.batch.expiryDate) <
      localDateStart(checkedAt);
    const result = reasons.length
      ? ScanResult.SUSPICIOUS
      : expired
        ? ScanResult.EXPIRED
        : ScanResult.GENUINE;
    await this.recordCheck({
      serial: parsed.serial,
      result,
      reasons: reasons.length ? reasons : expired ? ["batch expired"] : [],
      checkedAt,
      sourceIpHash,
      deviceId,
      lat: dto.lat ?? null,
      lng: dto.lng ?? null,
    });

    const response = this.checkResponse(
      result,
      reasons.length ? reasons : expired ? ["batch expired"] : [],
    );
    return {
      ...response,
      batch: {
        drugName: pack.parentCase.batch.drugName,
        batchNumber: pack.parentCase.batch.batchNumber,
      },
      expiry: pack.parentCase.batch.expiryDate,
      sold: Boolean(pack.soldAt),
      ...(pack.soldAt && pack.soldBy
        ? {
            message: `Dispensed by ${pack.soldBy.name} on ${pack.soldAt.toISOString()}`,
            soldAt: pack.soldAt,
            soldBy: { id: pack.soldBy.id, name: pack.soldBy.name },
          }
        : {}),
    };
  }

  async sellPack(
    serial: string,
    dto: RecordEventDto,
    user: AuthUser,
  ): Promise<CheckResult & { sold: boolean; soldAt: Date | null }> {
    this.assertPharmacy(user);
    this.assertCoordinates(dto);
    const soldAt = new Date();
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id::text AS id FROM packs WHERE serial = ${serial} FOR UPDATE
      `;
      if (!locked.length) {
        throw new NotFoundException("Pack serial not found");
      }

      const pack = await tx.pack.findUniqueOrThrow({
        where: { serial },
        include: {
          parentCase: {
            include: {
              batch: true,
              expectedRecipient: { select: { id: true, name: true } },
            },
          },
          soldBy: { select: { id: true, name: true } },
        },
      });
      const deviceId = dto.deviceId?.trim() || null;
      const location = { lat: dto.lat ?? null, lng: dto.lng ?? null };

      if (pack.soldAt) {
        const reasons = ["already sold"];
        if (
          pack.parentCase.shippedAt === null ||
          pack.parentCase.expectedRecipientOrgId !== pack.soldByOrgId
        ) {
          reasons.push("outside expected recipient");
        }
        if (pack.soldByOrgId && pack.soldByOrgId !== user.id) {
          reasons.push("sold by a different org than the one claiming it");
        }
        await this.recordPackAction(tx, {
          serial,
          action: ScanAction.SALE,
          result: ScanResult.SUSPICIOUS,
          reasons,
          createdAt: soldAt,
          userId: user.id,
          deviceId,
          ...location,
        });
        await this.ledger.append(
          tx,
          "SALE_REJECTED",
          { serial, orgId: user.id, reasons },
          soldAt,
        );
        await this.ledger.append(
          tx,
          "FLAGGED",
          { targetType: "PACK", serial, orgId: user.id, reasons },
          soldAt,
        );
        return {
          ...this.checkResponse(ScanResult.SUSPICIOUS, reasons),
          batch: {
            drugName: pack.parentCase.batch.drugName,
            batchNumber: pack.parentCase.batch.batchNumber,
          },
          expiry: pack.parentCase.batch.expiryDate,
          sold: true,
          saleRecorded: false,
          soldAt: pack.soldAt,
        };
      }

      const expired =
        localDateStart(pack.parentCase.batch.expiryDate) <
        localDateStart(soldAt);
      if (expired) {
        const reasons = ["batch expired"];
        await this.recordPackAction(tx, {
          serial,
          action: ScanAction.SALE,
          result: ScanResult.EXPIRED,
          reasons,
          createdAt: soldAt,
          userId: user.id,
          deviceId,
          ...location,
        });
        await this.ledger.append(
          tx,
          "SALE_REJECTED",
          { serial, orgId: user.id, reasons },
          soldAt,
        );
        return {
          ...this.checkResponse(ScanResult.EXPIRED, reasons),
          batch: {
            drugName: pack.parentCase.batch.drugName,
            batchNumber: pack.parentCase.batch.batchNumber,
          },
          expiry: pack.parentCase.batch.expiryDate,
          sold: false,
          soldAt: null,
        };
      }

      const reasons =
        pack.parentCase.expectedRecipientOrgId === user.id &&
        pack.parentCase.shippedAt
          ? []
          : ["outside expected recipient"];
      await tx.pack.update({
        where: { id: pack.id },
        data: {
          status: PackStatus.SOLD,
          soldByOrgId: user.id,
          soldAt,
        },
      });
      await this.recordPackAction(tx, {
        serial,
        action: ScanAction.SALE,
        result: reasons.length ? ScanResult.SUSPICIOUS : ScanResult.GENUINE,
        reasons,
        createdAt: soldAt,
        userId: user.id,
        deviceId,
        ...location,
      });
      await this.ledger.append(
        tx,
        "PACK_SOLD",
        { serial, orgId: user.id, reasons },
        soldAt,
      );
      if (reasons.length) {
        await this.ledger.append(
          tx,
          "FLAGGED",
          { targetType: "PACK", serial, orgId: user.id, reasons },
          soldAt,
        );
      }
      return {
        ...this.checkResponse(
          reasons.length ? ScanResult.SUSPICIOUS : ScanResult.GENUINE,
          reasons,
        ),
        message: reasons.length ? null : "Sale recorded",
        batch: {
          drugName: pack.parentCase.batch.drugName,
          batchNumber: pack.parentCase.batch.batchNumber,
        },
        expiry: pack.parentCase.batch.expiryDate,
        sold: true,
        saleRecorded: true,
        soldAt,
      };
    });
  }

  async shipCase(dto: ShipCaseDto, user: AuthUser) {
    this.assertRole(user, UserRole.MANUFACTURER);
    const recipient = await this.prisma.user.findUnique({
      where: { id: dto.toOrgId },
      select: { id: true, name: true, role: true },
    });
    if (!recipient || recipient.role !== UserRole.PHARMACY) {
      throw new BadRequestException("toOrgId must identify a pharmacy");
    }
    return this.prisma.$transaction(async (tx) => {
      const caseRecord = await tx.case.findUnique({
        where: { caseCode: dto.caseCode },
        include: { batch: true },
      });
      if (!caseRecord || caseRecord.batch.manufacturerId !== user.id) {
        throw new NotFoundException("Case not found for this manufacturer");
      }
      await tx.$queryRaw`
        SELECT id FROM cases WHERE id = ${caseRecord.id}::uuid FOR UPDATE
      `;
      const current = await tx.case.findUniqueOrThrow({
        where: { id: caseRecord.id },
        include: { batch: true },
      });
      if (current.status === CaseStatus.RECEIVED) {
        throw new ConflictException("A received case cannot be shipped again");
      }
      if (current.shippedAt) {
        if (current.expectedRecipientOrgId === recipient.id) {
          return {
            caseCode: current.caseCode,
            expectedRecipient: recipient,
            shippedAt: current.shippedAt,
            repeated: true,
          };
        }
        throw new ConflictException("Case already has a different recipient");
      }

      const shippedAt = new Date();
      await tx.case.update({
        where: { id: current.id },
        data: {
          status: CaseStatus.DISPATCHED,
          expectedRecipientOrgId: recipient.id,
          shippedAt,
        },
      });
      await this.ledger.append(
        tx,
        "SHIPPED",
        {
          caseId: current.id,
          caseCode: current.caseCode,
          fromOrgId: user.id,
          toOrgId: recipient.id,
        },
        shippedAt,
      );
      return {
        caseCode: current.caseCode,
        expectedRecipient: recipient,
        shippedAt,
        repeated: false,
      };
    });
  }

  async listShipmentRecipients(user: AuthUser) {
    this.assertRole(user, UserRole.MANUFACTURER);
    return this.prisma.user.findMany({
      where: { role: UserRole.PHARMACY },
      orderBy: { name: "asc" },
      select: { id: true, name: true, locationName: true },
    });
  }

  async receiveCase(
    caseCode: string,
    dto: RecordEventDto,
    user: AuthUser,
    metadata: RequestMetadata,
  ) {
    this.assertPharmacy(user);
    this.assertCoordinates(dto);
    const receivedAt = new Date();
    const sourceIpHash = hashIp(metadata.ip);
    return this.prisma.$transaction(async (tx) => {
      const found = await tx.case.findUnique({
        where: { caseCode },
        include: {
          batch: true,
          _count: { select: { packs: true } },
        },
      });
      if (!found) {
        throw new NotFoundException("Case code not found");
      }
      await tx.$queryRaw`
        SELECT id FROM cases WHERE id = ${found.id}::uuid FOR UPDATE
      `;
      const current = await tx.case.findUniqueOrThrow({
        where: { id: found.id },
        include: {
          batch: true,
          _count: { select: { packs: true } },
        },
      });
      const intendedRecipient =
        current.shippedAt !== null &&
        current.expectedRecipientOrgId === user.id;
      const alreadyReceivedByAnother =
        current.status === CaseStatus.RECEIVED &&
        current.receivedBy !== user.id;

      if (!intendedRecipient || alreadyReceivedByAnother) {
        const reasons = ["outside intended chain"];
        await this.recordCaseReceipt(tx, {
          caseCode,
          userId: user.id,
          result: ScanResult.SUSPICIOUS,
          reasons,
          createdAt: receivedAt,
          deviceId: dto.deviceId?.trim() || null,
          sourceIpHash,
          lat: dto.lat ?? null,
          lng: dto.lng ?? null,
        });
        await this.ledger.append(
          tx,
          "FLAGGED",
          {
            targetType: "CASE",
            caseCode,
            attemptedRecipientOrgId: user.id,
            expectedRecipientOrgId: current.expectedRecipientOrgId,
            reasons,
          },
          receivedAt,
        );
        return {
          result: ScanResult.SUSPICIOUS,
          reasons,
          reason: reasons[0],
          packsReceived: 0,
          batch: {
            drugName: current.batch.drugName,
            batchNumber: current.batch.batchNumber,
          },
          expiry: current.batch.expiryDate,
        };
      }

      const alreadyReceived = current.status === CaseStatus.RECEIVED;
      if (!alreadyReceived) {
        await tx.case.update({
          where: { id: current.id },
          data: {
            status: CaseStatus.RECEIVED,
            receivedBy: user.id,
            receivedAt,
          },
        });
        await tx.pack.updateMany({
          where: { caseId: current.id, status: PackStatus.ACTIVE },
          data: { status: PackStatus.RECEIVED },
        });
      }
      const reasons: string[] = [];
      await this.recordCaseReceipt(tx, {
        caseCode,
        userId: user.id,
        result: ScanResult.GENUINE,
        reasons,
        createdAt: receivedAt,
        deviceId: dto.deviceId?.trim() || null,
        sourceIpHash,
        lat: dto.lat ?? null,
        lng: dto.lng ?? null,
      });
      if (!alreadyReceived) {
        await this.ledger.append(
          tx,
          "CASE_RECEIVED",
          {
            caseId: current.id,
            caseCode,
            receivedBy: user.id,
            packsReceived: current._count.packs,
          },
          receivedAt,
        );
      }
      return {
        result: ScanResult.GENUINE,
        reasons,
        reason: null,
        message: alreadyReceived ? "case already received by this pharmacy" : null,
        packsReceived: current._count.packs,
        batch: {
          drugName: current.batch.drugName,
          batchNumber: current.batch.batchNumber,
        },
        expiry: current.batch.expiryDate,
      };
    });
  }

  async reconcileStock() {
    const pharmacies = await this.prisma.user.findMany({
      where: { role: UserRole.PHARMACY },
      orderBy: { name: "asc" },
      select: { id: true, name: true, email: true },
    });
    return Promise.all(
      pharmacies.map(async (pharmacy) => {
        const [receivedCases, soldPacks, outsideShipmentPacks] =
          await Promise.all([
            this.prisma.case.findMany({
              where: {
                status: CaseStatus.RECEIVED,
                receivedBy: pharmacy.id,
              },
              select: { _count: { select: { packs: true } } },
            }),
            this.prisma.pack.count({ where: { soldByOrgId: pharmacy.id } }),
            this.prisma.pack.count({
              where: {
                soldByOrgId: pharmacy.id,
                parentCase: {
                  OR: [
                    { expectedRecipientOrgId: null },
                    { expectedRecipientOrgId: { not: pharmacy.id } },
                    { shippedAt: null },
                  ],
                },
              },
            }),
          ]);
        const packsReceived = receivedCases.reduce(
          (sum, item) => sum + item._count.packs,
          0,
        );
        const reasons: string[] = [];
        if (soldPacks > packsReceived) {
          reasons.push("sold more packs than received");
        }
        if (outsideShipmentPacks > 0) {
          reasons.push("sold packs whose cases were not shipped to this pharmacy");
        }
        return {
          pharmacy: { id: pharmacy.id, name: pharmacy.name, email: pharmacy.email },
          packsReceived,
          packsSold: soldPacks,
          outsideShipmentPacks,
          flagged: reasons.length > 0,
          reasons,
        };
      }),
    );
  }

  async createConsumerReport(
    dto: ConsumerReportDto,
    metadata: RequestMetadata,
  ) {
    const message = dto.message.trim();
    if (!message) {
      throw new BadRequestException("message must not be empty");
    }
    const sourceIpHash = hashIp(metadata.ip);
    if (sourceIpHash) {
      const recentReports = await this.prisma.consumerReport.count({
        where: {
          sourceIpHash,
          createdAt: { gte: new Date(Date.now() - 60_000) },
        },
      });
      if (recentReports >= 10) {
        throw new HttpException(
          "Too many reports; try again shortly",
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }
    const parsed = this.parseAndVerify(dto.payload, "P");
    if (!parsed) {
      throw new BadRequestException("A valid signed pack QR payload is required");
    }
    const pack = await this.prisma.pack.findUnique({
      where: { serial: parsed.serial },
      select: { serial: true },
    });
    if (!pack) {
      throw new NotFoundException("Pack serial not found");
    }

    const reportedAt = new Date();
    return this.prisma.$transaction(async (tx) => {
      const report = await tx.consumerReport.create({
        data: {
          serial: pack.serial,
          message,
          sourceIpHash,
          createdAt: reportedAt,
        },
      });
      await this.ledger.append(
        tx,
        "BUYER_REPORT",
        {
          reportId: report.id,
          serial: pack.serial,
          message: report.message,
        },
        reportedAt,
      );
      return { accepted: true, reportId: report.id, serial: report.serial };
    });
  }

  private checkConflictReasons(
    events: Array<{
      action: ScanAction;
      deviceId: string | null;
      lat: number | null;
      lng: number | null;
      createdAt: Date;
    }>,
    current: {
      deviceId: string | null;
      lat: number | null;
      lng: number | null;
      createdAt: Date;
    },
    soldAt: Date | null,
  ): string[] {
    const reasons = new Set<string>();
    const previousLocations = events.filter(
      (event) => event.lat !== null && event.lng !== null,
    );
    if (current.lat !== null && current.lng !== null) {
      const previous = previousLocations[0];
      if (previous) {
        const elapsedHours =
          (current.createdAt.getTime() - previous.createdAt.getTime()) /
          3_600_000;
        const distance = distanceKm(
          { lat: previous.lat!, lng: previous.lng! },
          { lat: current.lat, lng: current.lng },
        );
        if (
          (elapsedHours <= 0 && distance > 1) ||
          (elapsedHours > 0 && distance / elapsedHours > MAX_TRAVEL_SPEED_KMH)
        ) {
          reasons.add("impossible travel");
        }
      }
    }

    const checksBeforeSale = events.filter(
      (event) =>
        event.action === ScanAction.CHECK &&
        (!soldAt || event.createdAt < soldAt),
    );
    const currentIsPreSale = !soldAt;
    const deviceIds = new Set(
      checksBeforeSale
        .map((event) => event.deviceId)
        .filter((deviceId): deviceId is string => Boolean(deviceId)),
    );
    if (currentIsPreSale && current.deviceId) {
      deviceIds.add(current.deviceId);
    }
    if (deviceIds.size >= DEVICE_ANOMALY_THRESHOLD) {
      reasons.add("many distinct devices before sale");
    }

    const places: Array<{ lat: number; lng: number }> = [];
    for (const event of checksBeforeSale) {
      if (event.lat === null || event.lng === null) continue;
      const point = { lat: event.lat, lng: event.lng };
      if (
        places.every(
          (existing) =>
            distanceKm(existing, point) >= DISTINCT_PLACE_DISTANCE_KM,
        )
      ) {
        places.push(point);
      }
    }
    if (
      currentIsPreSale &&
      current.lat !== null &&
      current.lng !== null &&
      places.every(
        (existing) =>
          distanceKm(existing, { lat: current.lat!, lng: current.lng! }) >=
          DISTINCT_PLACE_DISTANCE_KM,
      )
    ) {
      places.push({ lat: current.lat, lng: current.lng });
    }
    if (places.length >= PLACE_ANOMALY_THRESHOLD) {
      reasons.add("many distinct places before sale");
    }
    return [...reasons];
  }

  private async enforceIpRateLimit(sourceIpHash: string | null): Promise<void> {
    if (!sourceIpHash) return;
    const count = await this.prisma.scan.count({
      where: {
        sourceIpHash,
        action: ScanAction.CHECK,
        createdAt: { gte: new Date(Date.now() - 60_000) },
      },
    });
    if (count >= IP_CHECKS_PER_MINUTE) {
      throw new HttpException(
        "Too many checks; try again shortly",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async enforcePackRateLimit(
    serial: string,
    checkedAt: Date,
  ): Promise<void> {
    const count = await this.prisma.scan.count({
      where: {
        serialOrCode: serial,
        action: ScanAction.CHECK,
        createdAt: { gte: new Date(checkedAt.getTime() - 60_000) },
      },
    });
    if (count >= PACK_CHECKS_PER_MINUTE) {
      throw new HttpException(
        "Too many checks for this pack",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async recordCheck(input: {
    serial: string;
    result: ScanResult;
    reasons: string[];
    checkedAt: Date;
    sourceIpHash: string | null;
    deviceId: string | null;
    lat: number | null;
    lng: number | null;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const scan = await tx.scan.create({
        data: {
          scannedBy: null,
          targetType: ScanTargetType.PACK,
          action: ScanAction.CHECK,
          serialOrCode: input.serial,
          result: input.result,
          reason: input.reasons.join("; ") || null,
          sourceIpHash: input.sourceIpHash,
          deviceId: input.deviceId,
          lat: input.lat,
          lng: input.lng,
          createdAt: input.checkedAt,
        },
      });
      await this.ledger.append(
        tx,
        "PACK_CHECKED",
        {
          scanId: scan.id,
          serial: input.serial,
          result: input.result,
          reasons: input.reasons,
          deviceId: input.deviceId,
        },
        input.checkedAt,
      );
      if (input.result === ScanResult.SUSPICIOUS) {
        await this.ledger.append(
          tx,
          "FLAGGED",
          {
            targetType: "PACK",
            serial: input.serial,
            scanId: scan.id,
            reasons: input.reasons,
          },
          input.checkedAt,
        );
      }
    });
  }

  private async recordPackAction(
    tx: Prisma.TransactionClient,
    input: {
      serial: string;
      action: ScanAction;
      result: ScanResult;
      reasons: string[];
      createdAt: Date;
      userId: string;
      deviceId: string | null;
      lat: number | null;
      lng: number | null;
    },
  ): Promise<void> {
    await tx.scan.create({
      data: {
        scannedBy: input.userId,
        targetType: ScanTargetType.PACK,
        action: input.action,
        serialOrCode: input.serial,
        result: input.result,
        reason: input.reasons.join("; ") || null,
        deviceId: input.deviceId,
        lat: input.lat,
        lng: input.lng,
        createdAt: input.createdAt,
      },
    });
  }

  private async recordCaseReceipt(
    tx: Prisma.TransactionClient,
    input: {
      caseCode: string;
      userId: string;
      result: ScanResult;
      reasons: string[];
      createdAt: Date;
      deviceId: string | null;
      sourceIpHash: string | null;
      lat: number | null;
      lng: number | null;
    },
  ): Promise<void> {
    await tx.scan.create({
      data: {
        scannedBy: input.userId,
        targetType: ScanTargetType.CASE,
        action: ScanAction.CASE_RECEIPT,
        serialOrCode: input.caseCode,
        result: input.result,
        reason: input.reasons.join("; ") || null,
        deviceId: input.deviceId,
        sourceIpHash: input.sourceIpHash,
        lat: input.lat,
        lng: input.lng,
        createdAt: input.createdAt,
      },
    });
  }

  private parseAndVerify(
    content: string,
    expectedType: "P" | "C",
  ): ParsedPayload | null {
    let secret: string;
    try {
      secret = getAppSecret("QR_HMAC_SECRET");
    } catch {
      throw new ServiceUnavailableException(
        "Set QR_HMAC_SECRET to a private value of at least 32 characters",
      );
    }
    const parts = content.split(".");
    if (parts.length !== 2 || !/^[a-f0-9]{64}$/i.test(parts[1])) return null;
    let value: unknown;
    try {
      const decoded = Buffer.from(parts[0], "base64url");
      if (decoded.toString("base64url") !== parts[0]) return null;
      value = JSON.parse(decoded.toString("utf8"));
    } catch {
      return null;
    }
    if (
      value === null ||
      typeof value !== "object" ||
      !("t" in value) ||
      !("s" in value) ||
      !("v" in value)
    ) {
      return null;
    }
    const payload = value as { t: unknown; s: unknown; v: unknown };
    if (
      payload.t !== expectedType ||
      payload.v !== 1 ||
      typeof payload.s !== "string" ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(payload.s)
    ) {
      return null;
    }
    const expected = createHmac("sha256", secret)
      .update(`${expectedType}.${payload.s}`)
      .digest();
    const provided = Buffer.from(parts[1], "hex");
    if (
      provided.length !== expected.length ||
      !timingSafeEqual(provided, expected)
    ) {
      return null;
    }
    return { type: expectedType, serial: payload.s };
  }

  private checkResponse(
    result: ScanResult,
    reasons: string[],
  ): CheckResult {
    return {
      result,
      reasons,
      reason: reasons.join("; ") || null,
      message: null,
    };
  }

  private assertCoordinates(dto: { lat?: number; lng?: number }): void {
    if ((dto.lat === undefined) !== (dto.lng === undefined)) {
      throw new BadRequestException(
        "Provide both lat and lng, or omit both coordinates",
      );
    }
  }

  private assertPharmacy(user: AuthUser): void {
    this.assertRole(user, UserRole.PHARMACY);
  }

  private assertRole(user: AuthUser, role: UserRole): void {
    if (user.role !== role) {
      throw new ForbiddenException(`Only ${role.toLowerCase()} accounts can perform this action`);
    }
  }
}
