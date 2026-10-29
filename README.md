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
backend/      NestJS REST API, Prisma schema and feature modules
ai-service/   FastAPI service for packaging check
ledger/       Hash-chain design notes and utilities
docs/         Architecture notes
```

## Run the database

Copy `.env.example` to `.env` in the repository root, then start PostgreSQL:

```powershell
Copy-Item .env.example .env
docker compose up -d db
```

From `backend/`, install dependencies and apply the initial schema migration:

```powershell
npm install
npm run db:deploy
npm run seed:reset
npm run start:dev
```

Prisma reads the schema from `backend/prisma/schema.prisma`; later schema changes
should be applied through Prisma migrations. Use `npm run db:migrate -- --name
<migration-name>` while developing schema changes. The seed command **deletes
and recreates all application data** and refuses non-local database hosts, so
use it only with a local demo database.
Replace the placeholder `QR_HMAC_SECRET` in `.env` before seeding.

The seed creates a manufacturer, two pharmacies (Guwahati and Mumbai), a
regulator, two batches (including an expired batch), six cases, 60 signed packs,
and sample scan/ledger events. All demo accounts use `DemoPass123!`:

| Role | Email |
|---|---|
| Manufacturer | `manufacturer@xuino.demo` |
| Pharmacy (Guwahati) | `pharmacy.guwahati@xuino.demo` |
| Pharmacy (Mumbai) | `pharmacy.mumbai@xuino.demo` |
| Regulator | `regulator@xuino.demo` |

The initial backend exposes `GET http://localhost:3001/health` and Swagger UI
at `http://localhost:3001/docs`.

### Frontend

The Next.js app uses the seeded demo accounts above and the backend API at
`http://localhost:3001` by default. To run it in a second terminal:

```powershell
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000`. To use another API host, set
`NEXT_PUBLIC_API_BASE_URL` in `frontend/.env.local` (copy from
`frontend/.env.example`). The first UI pass
includes role-based sign-in, a regulator overview and ledger, manufacturer
batch registration with signed QR payloads, and pharmacy pack/case checks.
Pharmacy scan history is stored in the current browser because the backend
does not yet expose a pharmacy-scoped history endpoint.

### Backend integration tests

The backend integration suite starts the real NestJS app and tests auth, role
checks, batch/QR creation, pack and case verification, anomaly outcomes,
dashboard filters, and ledger tamper detection. It **truncates all application
tables** before each run, so it only accepts a dedicated local database named
`backend_integration_test`.

Create that database once (change the Postgres user if you customized it):

```powershell
docker compose exec -T db psql -U veripack -d postgres -c "CREATE DATABASE backend_integration_test;"
```

Then from `backend/`, point both migration and test commands at that database:

```powershell
$env:DATABASE_URL = "postgresql://veripack:veripack@localhost:5432/backend_integration_test?schema=public"
npm run db:deploy
$env:TEST_DATABASE_URL = $env:DATABASE_URL
npm test
```

Use your local Postgres credentials in the connection URL. The test runner
refuses any remote host or database name other than `backend_integration_test`.

### Auth and manufacturer API

Set both `JWT_SECRET` and `QR_HMAC_SECRET` in `.env` to different private,
random values of at least 32 characters. Generate a value in PowerShell with
the command below, and run it twice so each secret is different:

```powershell
node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Sign in at `POST /auth/login` with a seeded email and `DemoPass123!`; send the
returned `access_token` as `Authorization: Bearer <token>`. `GET /auth/me`
returns the current user's safe profile.

Manufacturer-only endpoints:

- `POST /batches` with `drugName`, `batchNumber`, `mfgDate`, `expiryDate`,
  `numCases` (1-50), and `packsPerCase` (1-100).
- `GET /batches` to list the signed-in manufacturer's batches.
- `GET /batches/:id/qr` to retrieve signed QR content for every case and pack.

Creating a batch writes the batch, cases, packs, and `BATCH_REGISTERED` ledger
event atomically. QR values use the documented base64url JSON payload plus an
HMAC signature.

### Pharmacy verification API

Sign in as a pharmacy and pass its bearer token to:

- `POST /verify/case` with `{ "payload": "<case QR content>", "lat": 26.14,
  "lng": 91.73 }` to record receipt of a case. Repeating receipt at the same
  pharmacy is idempotent; another pharmacy scanning that received case gets a
  `SUSPICIOUS` result.
- `POST /verify/pack` with `{ "payload": "<pack QR content>", "lat": 26.14,
  "lng": 91.73 }` to verify one pack.

Both coordinates are optional, but must be provided together. QR scans are
recorded, including unknown or invalid QR attempts. Pack verification checks
expiry, repeat scans, scans at other pharmacies, impossible travel (900 km/h
threshold), and whether the parent case was received by the scanning pharmacy.
Suspicious pack scans flag the pack and append ledger events in the same
transaction as the scan record.

Verification results include `GENUINE`, `SUSPICIOUS`, `EXPIRED`, or `UNKNOWN`.
If GPS coordinates are omitted, the API uses the pharmacy's registered
coordinates when available. Receiving a case also updates its active child
packs to `RECEIVED` in the same transaction.

### Regulator dashboard and ledger API

Sign in as `regulator@xuino.demo` and authorize Swagger with the returned JWT.
Regulator-only endpoints:

- `GET /dashboard/summary` returns counts for all scans and each result.
- `GET /dashboard/scans?page=1&limit=50` returns a paginated scan log.
  Optional filters: `result`, `targetType`, `from`, and `to` (ISO dates).
- `GET /dashboard/flagged?page=1&limit=50` returns suspicious scans and reasons.
- `GET /dashboard/hotspots` groups suspicious scans with coordinates.
- `GET /ledger/events?limit=50` returns recent events and their hashes.
- `GET /ledger/verify` recomputes the chain and reports the first broken event
  id, if any.

## Team
See [TEAM_ROLES.md](TEAM_ROLES.md).
