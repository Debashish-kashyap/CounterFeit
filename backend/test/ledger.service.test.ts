import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { computeMerkleRoot } from "../src/ledger/ledger.service";

function hash(value: string | Uint8Array): Buffer {
  return createHash("sha256").update(value).digest();
}

test("Merkle root hashes one event leaf", () => {
  const eventHash = "a".repeat(64);

  assert.equal(computeMerkleRoot([eventHash]), hash(eventHash).toString("hex"));
});

test("Merkle root duplicates the last leaf for an odd-sized level", () => {
  const eventHashes = ["a", "b", "c"];
  const firstPair = hash(Buffer.concat([hash("a"), hash("b")]));
  const duplicatedLastPair = hash(Buffer.concat([hash("c"), hash("c")]));
  const expectedRoot = hash(
    Buffer.concat([firstPair, duplicatedLastPair]),
  ).toString("hex");

  assert.equal(computeMerkleRoot(eventHashes), expectedRoot);
});

test("Merkle root rejects an empty event range", () => {
  assert.throws(() => computeMerkleRoot([]), /without events/);
});