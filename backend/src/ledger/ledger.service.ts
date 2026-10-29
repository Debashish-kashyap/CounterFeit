import { Inject, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

type TransactionClient = Prisma.TransactionClient;

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

export function computeMerkleRoot(eventHashes: readonly string[]): string {
  if (eventHashes.length === 0) {
    throw new Error("Cannot compute a Merkle root without events");
  }

  let level: Uint8Array[] = eventHashes.map((eventHash) =>
    createHash("sha256").update(eventHash).digest(),
  );

  while (level.length > 1) {
    const nextLevel: Uint8Array[] = [];
    for (let index = 0; index < level.length; index += 2) {
      const left = level[index];
      const right = level[index + 1] ?? left;
      nextLevel.push(
        createHash("sha256").update(Buffer.concat([left, right])).digest(),
      );
    }
    level = nextLevel;
  }

  return Buffer.from(level[0]).toString("hex");
}

@Injectable()
export class LedgerService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async append(
    tx: TransactionClient,
    eventType: string,
    payload: Prisma.InputJsonValue,
    createdAt = new Date(),
  ): Promise<void> {
    await tx.$queryRaw<{ locked: boolean }>`
      SELECT pg_advisory_xact_lock(81025001) IS NULL AS locked
    `;
    const previous = await tx.ledgerEvent.findFirst({
      orderBy: { id: "desc" },
      select: { hash: true },
    });
    const prevHash = previous?.hash ?? "GENESIS";
    const hash = createHash("sha256")
      .update(`${prevHash}${eventType}${canonicalJson(payload)}${createdAt.toISOString()}`)
      .digest("hex");

    await tx.ledgerEvent.create({
      data: { eventType, payload, prevHash, hash, createdAt },
    });
  }

  async recentEvents(limit: number) {
    const events = await this.prisma.ledgerEvent.findMany({
      orderBy: { id: "desc" },
      take: limit,
    });
    return events.map((event) => ({ ...event, id: event.id.toString() }));
  }

  async recentAnchors(limit: number) {
    const anchors = await this.prisma.merkleAnchor.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return anchors.map((anchor) => ({
      ...anchor,
      fromEventId: anchor.fromEventId.toString(),
      toEventId: anchor.toEventId.toString(),
    }));
  }

  async createMerkleAnchor(limit: number) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw<{ locked: boolean }>`
        SELECT pg_advisory_xact_lock(81025001) IS NULL AS locked
      `;
      const previousAnchor = await tx.merkleAnchor.findFirst({
        orderBy: { toEventId: "desc" },
        select: { toEventId: true },
      });
      const events = await tx.ledgerEvent.findMany({
        where: previousAnchor
          ? { id: { gt: previousAnchor.toEventId } }
          : undefined,
        orderBy: { id: "asc" },
        take: limit,
        select: { id: true, hash: true },
      });

      if (events.length === 0) {
        return null;
      }

      const anchor = await tx.merkleAnchor.create({
        data: {
          fromEventId: events[0].id,
          toEventId: events[events.length - 1].id,
          merkleRoot: computeMerkleRoot(events.map((event) => event.hash)),
        },
      });

      return {
        ...anchor,
        fromEventId: anchor.fromEventId.toString(),
        toEventId: anchor.toEventId.toString(),
        eventCount: events.length,
      };
    });
  }

  async verifyChain(): Promise<{
    valid: boolean;
    brokenAtId: string | null;
    checkedEvents: number;
  }> {
    const events = await this.prisma.ledgerEvent.findMany({
      orderBy: { id: "asc" },
    });
    let expectedPreviousHash = "GENESIS";

    for (const event of events) {
      const expectedHash = createHash("sha256")
        .update(
          `${expectedPreviousHash}${event.eventType}${canonicalJson(event.payload)}${event.createdAt.toISOString()}`,
        )
        .digest("hex");

      if (
        event.prevHash !== expectedPreviousHash ||
        event.hash !== expectedHash
      ) {
        return {
          valid: false,
          brokenAtId: event.id.toString(),
          checkedEvents: events.length,
        };
      }

      expectedPreviousHash = event.hash;
    }

    return {
      valid: true,
      brokenAtId: null,
      checkedEvents: events.length,
    };
  }
}
