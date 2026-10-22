# CounterFeit

Layered verification against counterfeit drugs (and, later, adulterated food).

> **Status:** Round 1 submission. This repository holds the project design and skeleton. Implementation is in progress.

## Problem
Counterfeit medicines enter the supply chain, pharmacies cannot verify authenticity at the point of dispense, and records are too fragmented to trace suspicious batches. A QR code alone can be copied onto fake packs.

## Solution: five layers
1. **Unit-level QR:** one unique, signed serial per pack
2. **Bulk scanning:** case and pallet codes to check a delivery in one scan
3. **Scan-anomaly engine:** repeat scans and impossible travel between locations
4. **AI packaging check:** image similarity and OCR, reported as a suspicion score
5. **Tamper-evident ledger:** hash-chained custody events

Hierarchy: `API lot -> Batch -> Pallet -> Case -> Pack`

## Planned stack
| Part | Choice |
|---|---|
| Frontend | Next.js (TypeScript), Tailwind, PWA, ZXing scanner |
| Backend | Node.js (NestJS) REST API, JWT roles |
| Database | PostgreSQL |
| AI service | Python FastAPI (image embeddings + OCR) |
| Ledger | Hash-chained event log, Merkle root anchoring (Hyperledger Fabric for production) |

## Structure
```
frontend/     Next.js PWA: scan, dashboard, manufacturer pages
backend/      REST API, modules per feature, db/schema.sql
ai-service/   FastAPI service for packaging check
ledger/       Hash-chain design notes and utilities
docs/         Architecture notes
```

## Run the database (draft)
```
cp .env.example .env
docker compose up -d
```

## Team
See [TEAM_ROLES.md](TEAM_ROLES.md).
