# CounterFeit

Medicine supply-chain verification using signed QR codes, custody records, and
a tamper-evident event ledger.

## Run the demo on Windows (no Docker)

### Requirements

- 64-bit Windows
- Node.js `20.19+`, `22.12+`, or `24+`
- Internet access the first time you run the demo

### Start

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
| TestDebug | `a@b`| pass: 123|
The initial backend exposes `GET http://localhost:3001/health` and Swagger UI
at `http://localhost:3001/docs`.
1. Download and extract the repository ZIP from GitHub.
2. Open the extracted project folder.
3. Double-click **`start-demo.cmd`**.

The launcher installs the project dependencies and a portable PostgreSQL
runtime, starts the database, applies migrations, loads demo data, and opens
the app. You do not need to install Docker or PostgreSQL, create a `.env` file,
or configure secrets.

The first run downloads about 100 MB of PostgreSQL files and may take a few
minutes. Later starts reuse the download and database files, but reset the demo
application data.

### Sign in

All demo accounts use this password: `DemoPass123!`

| Role | Email |
|---|---|
| Manufacturer | `manufacturer@xuino.demo` |
| Pharmacy — Guwahati | `pharmacy.guwahati@xuino.demo` |
| Pharmacy — Mumbai | `pharmacy.mumbai@xuino.demo` |
| Regulator | `regulator@xuino.demo` |

Open the app at [http://localhost:3000](http://localhost:3000). The API and
interactive API documentation are at [http://localhost:3001/docs](http://localhost:3001/docs).

### Stop

Run **`stop-demo.cmd`** to stop the local database. Close the backend and
frontend terminal windows to stop the app.

## Demo workflow

1. Sign in as the manufacturer, register a batch, and print its signed QR codes.
2. Record a shipment to a pharmacy.
3. Sign in as that pharmacy, receive the case, check a pack, and record its sale.
4. Sign in as the regulator to review scans, suspicious activity, stock
   reconciliation, and ledger integrity.

Checking a pack is public and read-only. Repeated checks alone do not flag it;
sales are recorded separately by a pharmacy.

## What is included

- Manufacturer batch registration and signed pack/case QR codes
- Public pack checks, shipments, pharmacy receipts, and sales
- Buyer reports and suspicious-activity rules
- Regulator dashboard, pharmacy stock reconciliation, and hash-chained ledger
- Browser-based QR scanning and printable QR sheets

AI packaging checks and public testnet anchoring are not implemented; they are
stretch goals.

## Optional developer setup with Docker

The Windows launcher is the recommended evaluator path. Developers may use
Docker Compose for PostgreSQL instead:

1. Copy `.env.example` to `.env` in the project root.
2. Start the database with `docker compose up -d db`.
3. In `backend/`, run `npm ci`, `npm run db:deploy`,
   `npm run seed:reset`, and `npm run start:dev`.
4. In another terminal, enter `frontend/` and run `npm ci` and `npm run dev`.

The seed command replaces application data. Use it only with a local demo
database.

## Tests

The backend integration tests require a dedicated local PostgreSQL database
named `backend_integration_test`. The test runner clears its tables, so do not
point it at a database containing data you need.

## Production warning

The built-in JWT and QR signing secrets are public demo values. Never deploy
with them; configure private production secrets and use a production database.
