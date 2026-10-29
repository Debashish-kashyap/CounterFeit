import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";

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

@Injectable()
export class LedgerService {
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
}
