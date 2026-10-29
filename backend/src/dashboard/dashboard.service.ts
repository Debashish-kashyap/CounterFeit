import {
  BadRequestException,
  Inject,
  Injectable,
} from "@nestjs/common";
import {
  ScanResult,
  ScanTargetType,
  Prisma,
} from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

interface ScanFilters {
  page: number;
  limit: number;
  result?: ScanResult;
  targetType?: ScanTargetType;
  from?: Date;
  to?: Date;
}

function parsePositiveInteger(
  value: string | undefined,
  fallback: number,
  field: string,
  maximum: number,
): number {
  if (value === undefined) {
    return fallback;
  }
  if (!/^[1-9]\d*$/.test(value)) {
    throw new BadRequestException(`${field} must be a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) {
    throw new BadRequestException(`${field} must be between 1 and ${maximum}`);
  }
  return parsed;
}

function parseDate(value: string | undefined, field: string): Date | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`${field} must be a valid ISO date`);
  }
  return parsed;
}

function parseEnumFilter<T extends string>(
  value: string | undefined,
  values: readonly T[],
  field: string,
): T | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!values.includes(value as T)) {
    throw new BadRequestException(
      `${field} must be one of: ${values.join(", ")}`,
    );
  }
  return value as T;
}

@Injectable()
export class DashboardService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async summary() {
    const [totalScans, grouped] = await Promise.all([
      this.prisma.scan.count(),
      this.prisma.scan.groupBy({
        by: ["result"],
        _count: { _all: true },
      }),
    ]);

    const counts: Record<ScanResult, number> = {
      [ScanResult.GENUINE]: 0,
      [ScanResult.SUSPICIOUS]: 0,
      [ScanResult.EXPIRED]: 0,
      [ScanResult.UNKNOWN]: 0,
    };
    for (const item of grouped) {
      counts[item.result] = item._count._all;
    }

    return {
      totalScans,
      genuine: counts[ScanResult.GENUINE],
      suspicious: counts[ScanResult.SUSPICIOUS],
      expired: counts[ScanResult.EXPIRED],
      unknown: counts[ScanResult.UNKNOWN],
    };
  }

  async scans(query: Record<string, string | undefined>) {
    const filters = this.parseFilters(query);
    const where = this.buildWhere(filters);
    const [items, total] = await Promise.all([
      this.prisma.scan.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
        include: {
          scanner: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
              locationName: true,
            },
          },
        },
      }),
      this.prisma.scan.count({ where }),
    ]);

    return {
      data: items,
      pagination: this.pagination(filters.page, filters.limit, total),
    };
  }

  async flagged(query: Record<string, string | undefined>) {
    const filters = this.parseFilters(query);
    const where: Prisma.ScanWhereInput = {
      ...this.buildWhere(filters),
      result: ScanResult.SUSPICIOUS,
    };
    const [items, total] = await Promise.all([
      this.prisma.scan.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
        include: {
          scanner: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
              locationName: true,
            },
          },
        },
      }),
      this.prisma.scan.count({ where }),
    ]);

    return {
      data: items,
      pagination: this.pagination(filters.page, filters.limit, total),
    };
  }

  async hotspots() {
    const groups = await this.prisma.scan.groupBy({
      by: ["lat", "lng"],
      where: {
        result: ScanResult.SUSPICIOUS,
        lat: { not: null },
        lng: { not: null },
      },
      _count: { _all: true },
    });

    return groups
      .map((group) => ({
        lat: group.lat,
        lng: group.lng,
        count: group._count._all,
      }))
      .sort((left, right) => right.count - left.count);
  }

  private parseFilters(query: Record<string, string | undefined>): ScanFilters {
    const page = parsePositiveInteger(query.page, 1, "page", 1_000_000);
    const limit = parsePositiveInteger(query.limit, 50, "limit", 100);
    const result = parseEnumFilter(
      query.result,
      Object.values(ScanResult),
      "result",
    );
    const targetType = parseEnumFilter(
      query.targetType,
      Object.values(ScanTargetType),
      "targetType",
    );
    const from = parseDate(query.from, "from");
    const to = parseDate(query.to, "to");
    if (from && to && from > to) {
      throw new BadRequestException("from must be earlier than or equal to to");
    }
    return { page, limit, result, targetType, from, to };
  }

  private buildWhere(filters: ScanFilters): Prisma.ScanWhereInput {
    return {
      ...(filters.result ? { result: filters.result } : {}),
      ...(filters.targetType ? { targetType: filters.targetType } : {}),
      ...(filters.from || filters.to
        ? {
            createdAt: {
              ...(filters.from ? { gte: filters.from } : {}),
              ...(filters.to ? { lte: filters.to } : {}),
            },
          }
        : {}),
    };
  }

  private pagination(page: number, limit: number, total: number) {
    return {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    };
  }
}
