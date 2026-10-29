import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import {
  CaseStatus,
  Prisma,
  UserRole,
} from "@prisma/client";
import { randomBytes } from "node:crypto";
import { AuthUser } from "../auth/auth-user";
import { CreateBatchDto } from "./dto/create-batch.dto";
import { LedgerService } from "../ledger/ledger.service";
import { PrismaService } from "../prisma/prisma.service";
import { QrPayloadService } from "../qr/qr-payload.service";

function asDatabaseDate(value: string): Date {
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
}

@Injectable()
export class BatchesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(QrPayloadService) private readonly qrPayload: QrPayloadService,
    @Inject(LedgerService) private readonly ledger: LedgerService,
  ) {}

  async create(dto: CreateBatchDto, user: AuthUser) {
    if (user.role !== UserRole.MANUFACTURER) {
      throw new ForbiddenException("Only manufacturers can register batches");
    }

    const mfgDate = asDatabaseDate(dto.mfgDate);
    const expiryDate = asDatabaseDate(dto.expiryDate);
    if (
      Number.isNaN(mfgDate.getTime()) ||
      Number.isNaN(expiryDate.getTime()) ||
      mfgDate >= expiryDate
    ) {
      throw new BadRequestException("mfgDate must be earlier than expiryDate");
    }

    const createdAt = new Date();
    try {
      return await this.prisma.$transaction(async (tx) => {
        const batch = await tx.batch.create({
          data: {
            manufacturerId: user.id,
            drugName: dto.drugName.trim(),
            batchNumber: dto.batchNumber.trim(),
            mfgDate,
            expiryDate,
          },
        });

        for (let caseIndex = 0; caseIndex < dto.numCases; caseIndex += 1) {
          const caseCode = `CASE-${randomBytes(16).toString("hex")}`;
          const caseQr = this.qrPayload.create("C", caseCode);
          const createdCase = await tx.case.create({
            data: {
              batchId: batch.id,
              caseCode,
              signature: caseQr.signature,
              status: CaseStatus.CREATED,
            },
          });

          const packs = Array.from({ length: dto.packsPerCase }, () => {
            const serial = randomBytes(16).toString("hex");
            const qr = this.qrPayload.create("P", serial);
            return {
              caseId: createdCase.id,
              serial,
              signature: qr.signature,
            };
          });
          await tx.pack.createMany({ data: packs });
        }

        await this.ledger.append(
          tx,
          "BATCH_REGISTERED",
          {
            batchId: batch.id,
            manufacturerId: user.id,
            batchNumber: batch.batchNumber,
            drugName: batch.drugName,
            numCases: dto.numCases,
            packsPerCase: dto.packsPerCase,
          },
          createdAt,
        );

        return {
          ...batch,
          numCases: dto.numCases,
          packsPerCase: dto.packsPerCase,
          totalPacks: dto.numCases * dto.packsPerCase,
        };
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictException(
          "A batch with this batch number is already registered",
        );
      }
      throw error;
    }
  }

  async list(user: AuthUser) {
    const batches = await this.prisma.batch.findMany({
      where: { manufacturerId: user.id },
      orderBy: { createdAt: "desc" },
      include: {
        _count: {
          select: { cases: true },
        },
        cases: {
          select: {
            _count: {
              select: { packs: true },
            },
          },
        },
      },
    });

    return batches.map(({ cases, _count, ...batch }) => ({
      ...batch,
      numCases: _count.cases,
      totalPacks: cases.reduce((total, item) => total + item._count.packs, 0),
    }));
  }

  async getQrSheet(batchId: string, user: AuthUser) {
    const batch = await this.prisma.batch.findFirst({
      where: { id: batchId, manufacturerId: user.id },
      include: {
        cases: {
          orderBy: { caseCode: "asc" },
          include: { packs: { orderBy: { serial: "asc" } } },
        },
      },
    });
    if (!batch) {
      throw new NotFoundException("Batch not found");
    }

    return {
      batch: {
        id: batch.id,
        drugName: batch.drugName,
        batchNumber: batch.batchNumber,
        mfgDate: batch.mfgDate,
        expiryDate: batch.expiryDate,
      },
      cases: batch.cases.map((item) => {
        const caseQr = this.qrPayload.create("C", item.caseCode);
        return {
          caseCode: item.caseCode,
          payload: caseQr.payload,
          signature: item.signature ?? caseQr.signature,
          content: `${caseQr.payload}.${item.signature ?? caseQr.signature}`,
          packs: item.packs.map((pack) => {
            const packQr = this.qrPayload.create("P", pack.serial);
            return {
              serial: pack.serial,
              payload: packQr.payload,
              signature: pack.signature,
              content: `${packQr.payload}.${pack.signature}`,
            };
          }),
        };
      }),
    };
  }
}
