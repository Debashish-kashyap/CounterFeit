# CounterFeit

Layered verification against counterfeit drugs (and, later, adulterated food).

> **Status:** Round 1 submission. This repository holds the project design and skeleton. Implementation is in progress.

## Problem
Counterfeit medicines enter the supply chain, pharmacies cannot verify authenticity at the point of dispense, and records are too fragmented to trace suspicious batches. A QR code alone can be copied onto fake packs.

## Solution: five layers
1. **Unit-level QR:** one unique, signed serial per pack
2. **Bulk scanning:** case and pallet codes to check a delivery in one scan
3. **Scan-anomaly engine:** conflicting custody facts, impossible travel, and pre-sale device/place signals
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

### Check, shipment, receipt, and sale API

The public, read-only pack check is separate from billing:

- `POST /verify/check` with `{ "payload": "<pack QR content>", "lat": 26.14,
  "lng": 91.73, "deviceId": "<stable browser ID>" }` requires no login. It
  records a check and a `PACK_CHECKED` ledger event, but does not change pack
  state or flag a pack merely because it was checked repeatedly.
- `POST /reports` with the same signed pack `payload` and a `message` such as
  `"I bought this elsewhere"` records a public buyer report.

Manufacturer accounts can record the custody destination:

- `GET /shipments/recipients` lists pharmacy accounts available as recipients.
- `POST /shipments` with `{ "caseCode": "<case code>", "toOrgId": "<pharmacy user ID>" }`
  records the expected recipient and a `SHIPPED` ledger event. Only the
  manufacturer that owns the batch can ship its cases.

Pharmacy accounts use these billing and receiving actions:

- `POST /cases/:code/receive` with optional `{ "lat": 26.14, "lng": 91.73,
  "deviceId": "<stable browser ID>" }` records receipt only when the pharmacy
  matches the shipment's expected recipient. An unshipped case or a receipt at
  another pharmacy returns `SUSPICIOUS` with reason `"outside intended chain"`
  and records the attempted pharmacy, without transferring custody.
- `POST /packs/:serial/sell` with optional coordinates/device ID records the
  pharmacy sale and sets the pack to `SOLD`. A second sale returns
  `SUSPICIOUS` with `"already sold"`; an attempt by another pharmacy also
  includes `"sold by a different org than the one claiming it"`.

Checks return `GENUINE`, `SUSPICIOUS`, `EXPIRED`, or `UNKNOWN`, with a `reasons`
array. An already-sold pack without a conflict is still `GENUINE` and includes
the dispensing pharmacy and time. Conflicts include impossible travel above
800 km/h between consecutive located events, three or more distinct devices
or places (places separated by at least 10 km) checking a pack before sale,
and sale/receipt outside the expected chain. Public checks are rate-limited to
60 per source IP per minute and 30 per pack per minute. IPs are stored only as
SHA-256 hashes. Device IDs are client-generated signals, not authenticated
device identities.

### Regulator dashboard and ledger API

Sign in as `regulator@xuino.demo` and authorize Swagger with the returned JWT.
Regulator-only endpoints:

- `GET /dashboard/summary` returns counts for all scans and each result.
- `GET /dashboard/scans?page=1&limit=50` returns a paginated scan log.
  Optional filters: `result`, `targetType`, `from`, and `to` (ISO dates).
- `GET /dashboard/flagged?page=1&limit=50` returns suspicious scans and reasons.
- `GET /dashboard/hotspots` groups suspicious scans with coordinates.
- `GET /reports/reconciliation` compares received and sold packs per pharmacy,
  flagging over-sales and sales from cases not shipped to that pharmacy.
- `GET /ledger/events?limit=50` returns recent events and their hashes.
- `GET /ledger/verify` recomputes the chain and reports the first broken event
  id, if any.

## Team
See [TEAM_ROLES.md](TEAM_ROLES.md).
