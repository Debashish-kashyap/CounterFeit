# XUINO — MVP Build Requirements (10-Hour Hackathon)

**PS ID:** ECCLISIA26-004 — Layered Verification Against Counterfeit Drugs
**Goal:** a working end-to-end demo of the Phase 1 MVP from the PPT: *QR scan → registry → bulk and single check → anomaly rules → dashboard*, plus a thin version of the ledger. AI packaging check is a stretch goal.

---

## 0. Scope Rules (read first)

**Must build (demo-critical)**
1. Manufacturer registers a batch → system generates case, pack serials and signed QR codes
2. Anyone can check a pack without changing its state; pharmacies record sales separately
3. Manufacturer ships a case to an expected pharmacy; that pharmacy records receipt
4. Anomaly rules use conflicting custody facts, impossible travel, and pre-sale device/place signals, not repeat count alone
5. Dashboard with scan log and suspicious-event list
6. Hash-chained event log with a "verify chain integrity" button

**Should build if time allows**
- Merkle root computed over event batches (local, shown in UI)
- Role-based login (Manufacturer / Pharmacy / Regulator)
- Hotspot map on the regulator dashboard

**Stretch (only if everything above is done)**
- FastAPI packaging check (OCR on photo, compare batch/expiry text with the QR record), returned as a suspicion score
- Anchor the Merkle root on a public testnet
- Offline scan queue (the PPT lists this under Phase 3, so fake it in the demo only if needed)

**Cut without guilt:** food extension, spectroscopy, billing-software integration, regulator API integration. Mention them as roadmap.

---

## 1. Tech Stack (as per PPT)

| Layer | Choice |
|---|---|
| Frontend | Next.js (React + TypeScript), Tailwind, PWA |
| QR scan / generate | ZXing (in-browser camera), `qrcode` library |
| Backend | Node.js + NestJS, REST, OpenAPI (Swagger), JWT roles |
| Database | PostgreSQL |
| Anomaly engine | Rule engine inside NestJS (service class) |
| AI (stretch) | Python FastAPI + OCR (Tesseract / EasyOCR) |
| Ledger | Hash-chained event log in Postgres + Merkle roots, testnet anchor (stretch) |

**Shortcuts for a 10-hour build**
- Use **Docker Compose** for Postgres so setup is one command.
- Use **Prisma** or **TypeORM** with auto-migrations. Do not hand-write SQL migrations.
- Use a single monorepo: `/frontend`, `/backend`, `/ai-service`.
- Deploy only if time remains. A local demo on a laptop plus phone on the same Wi-Fi is enough. Camera access on phones needs HTTPS, so use `ngrok` or Vercel for the frontend if testing on a phone.

---

## 2. Database Requirements (PostgreSQL)

### 2.1 Tables

**users**
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name | text | |
| email | text unique | |
| password_hash | text | bcrypt |
| role | enum | `MANUFACTURER`, `PHARMACY`, `REGULATOR` |
| location_name | text | e.g. "Guwahati Pharmacy 1" |
| lat, lng | float | used for impossible-travel rule |

**api_lots** (Phase 2 in PPT; keep minimal, one row per lot, optional)
| Column | Type |
|---|---|
| id | uuid PK |
| lot_number | text |
| supplier | text |

**batches**
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| manufacturer_id | FK users | |
| api_lot_id | FK api_lots, nullable | |
| drug_name | text | |
| batch_number | text | |
| mfg_date, expiry_date | date | |
| created_at | timestamptz | |

**pallets** (optional; can skip and go Batch → Case → Pack for MVP)
| id, batch_id, pallet_code |

**cases**
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| batch_id | FK batches | |
| pallet_id | FK, nullable | |
| case_code | text unique | printed in case QR |
| status | enum | `CREATED`, `DISPATCHED`, `RECEIVED` |
| received_by | FK users, nullable | |
| received_at | timestamptz | |
| expected_recipient_org_id | FK users, nullable | set when manufacturer ships the case |
| shipped_at | timestamptz, nullable | |

**packs**
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| case_id | FK cases | |
| serial | text unique | random 128-bit, hex |
| signature | text | HMAC of payload |
| status | enum | `ACTIVE`, `RECEIVED`, `SOLD` |
| sold_by_org_id | FK users, nullable | |
| sold_at | timestamptz, nullable | |
| scan_count | int default 0 | legacy/analytics only; never flags from count |
| first_scanned_at | timestamptz | |

**scans** (every verification attempt, genuine or not)
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| scanned_by | FK users, nullable | public checks have no signed-in scanner |
| target_type | enum | `PACK`, `CASE` |
| action | enum | `CHECK`, `SALE`, `CASE_RECEIPT` |
| serial_or_code | text | stored even if not found |
| result | enum | `GENUINE`, `SUSPICIOUS`, `EXPIRED`, `UNKNOWN` |
| reason | text | conflict reason; repeated checks alone are not suspicious |
| lat, lng | float | |
| device_id, source_ip_hash | text, nullable | client device signal and hashed source IP |
| created_at | timestamptz | |

**consumer_reports**
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| serial | text | referenced pack serial |
| message | text | buyer-submitted report |
| source_ip_hash | text, nullable | SHA-256 hash; never persist raw IP |
| created_at | timestamptz | |

**ledger_events** (hash-chained)
| Column | Type | Notes |
|---|---|---|
| id | bigserial PK | order matters |
| event_type | text | includes `SHIPPED`, `PACK_CHECKED`, `PACK_SOLD`, `CASE_RECEIVED`, `BUYER_REPORT`, `FLAGGED` |
| payload | jsonb | |
| prev_hash | text | |
| hash | text | SHA-256(prev_hash + event_type + payload + timestamp) |
| created_at | timestamptz | |

**merkle_anchors** (optional)
| id, from_event_id, to_event_id, merkle_root, tx_hash nullable, created_at |

### 2.2 Indexes and constraints
- Unique index on `packs.serial` and `cases.case_code`
- Index on `scans(serial_or_code, created_at)` for the anomaly rules
- `ledger_events` is **append-only**: never UPDATE or DELETE. Optionally revoke those permissions in a Postgres trigger.

### 2.3 Seed data (build this early, the demo depends on it)
- 1 manufacturer, 2 pharmacies in far-apart cities (for the impossible-travel demo), 1 regulator
- 2 batches, 3 cases each, 10 packs per case
- 1 already-expired batch (to show the Expired result)
- A seed script that resets the DB in one command

---

## 3. Backend Requirements (NestJS)

### 3.1 Modules
`auth`, `batches`, `cases`, `packs`, `verify`, `anomaly`, `ledger`, `dashboard`

### 3.2 Endpoints

**Auth**
| Method | Path | Description |
|---|---|---|
| POST | `/auth/login` | returns JWT with role |
| GET | `/auth/me` | current user |

**Manufacturer**
| Method | Path | Description |
|---|---|---|
| POST | `/batches` | create batch, with `numCases` and `packsPerCase`; generates cases, packs, serials, signatures; writes `BATCH_REGISTERED` to ledger |
| GET | `/batches` | list own batches |
| GET | `/batches/:id/qr` | returns all case and pack QR payloads (for download / print sheet) |

**Check, custody, and sale**
| Method | Path | Description |
|---|---|---|
| POST | `/verify/check` | Public `{ payload, lat?, lng?, deviceId? }`; logs a read-only check |
| POST | `/shipments` | Manufacturer ships `{ caseCode, toOrgId }`; stores expected recipient and logs `SHIPPED` |
| POST | `/cases/:code/receive` | Pharmacy-only receipt; transfers custody only to the shipped-to pharmacy |
| POST | `/packs/:serial/sell` | Pharmacy-only billing action; records sold org/time and rejects re-sale |
| POST | `/reports` | Public consumer report for a signed pack QR |

**Regulator / dashboard**
| Method | Path | Description |
|---|---|---|
| GET | `/dashboard/summary` | counts: total scans, genuine, suspicious, expired, unknown |
| GET | `/dashboard/scans` | paginated scan log with filters |
| GET | `/dashboard/flagged` | suspicious events with reasons |
| GET | `/dashboard/hotspots` | flagged scans grouped by location (lat/lng, count) |
| GET | `/reports/reconciliation` | received vs sold packs per pharmacy; flags over-sales and out-of-chain sales |

**Ledger**
| Method | Path | Description |
|---|---|---|
| GET | `/ledger/events` | recent events |
| GET | `/ledger/verify` | recomputes the whole chain, returns `{ valid: true/false, brokenAtId }` |
| POST | `/ledger/anchor` | computes Merkle root of un-anchored events (and posts to testnet if stretch) |

Expose Swagger at `/docs`. The PPT promises OpenAPI.

### 3.3 QR payload and signature
```
payload = base64url(JSON{ t: "P" | "C", s: serial_or_case_code, v: 1 })
signature = HMAC_SHA256(SECRET, t + "." + s)
QR content = payload + "." + signature
```
- Serial = `crypto.randomBytes(16).toString('hex')` (128-bit, per the PPT)
- On every scan, **verify the HMAC first**. A bad signature returns `UNKNOWN` immediately, with reason "signature invalid".
- Keep `HMAC_SECRET` in `.env`.

### 3.4 Public check and pharmacy sale
```
1. Parse payload, verify HMAC            -> fail: UNKNOWN
2. Look up pack by serial                -> not found: UNKNOWN
3. Check batch expiry_date < today       -> EXPIRED
4. Run conflict rules (section 3.6)      -> any hit: SUSPICIOUS
5. Otherwise                             -> GENUINE
6. Insert a CHECK event and append PACK_CHECKED; do not mutate pack state
```
`POST /verify/check` is public and repeatable. It never increments `scan_count`
or flags a pack only because of scan count. A sold pack with no conflict is
GENUINE and names its dispensing pharmacy and time. `POST /packs/:serial/sell`
is a separate pharmacy-authenticated billing action. It stores `SOLD`,
`sold_by_org_id`, and `sold_at`; a second attempt is SUSPICIOUS (`already sold`),
and another pharmacy's attempt also reports
`sold by a different org than the one claiming it`.

### 3.5 Shipment and case receipt
```
1. Manufacturer sends POST /shipments { caseCode, toOrgId }
2. Store expected_recipient_org_id and shipped_at; append SHIPPED
3. Pharmacy sends POST /cases/:code/receive
4. If not shipped to this pharmacy, return SUSPICIOUS ("outside intended chain")
   and flag the attempting pharmacy without transferring custody
5. Otherwise mark case and child packs received
6. Append one CASE_RECEIVED custody event
```

### 3.6 Conflict and rate-limit rules

| Rule | Logic |
|---|---|
| Repeat checks | Never a flag by themselves; checks are rate-limited per source IP and per pack |
| Impossible travel | Consecutive located pack events above 800 km/h -> `impossible travel` |
| Pre-sale devices/places | Three or more distinct device IDs or places at least 10 km apart before sale -> suspicious |
| Sale conflict | Re-sale -> `already sold`; another org also gets `sold by a different org than the one claiming it` |
| Shipment/receipt conflict | Missing shipment or receipt by another org -> `outside intended chain` |
| Stock reconciliation | Flag sold > received or packs sold by an org whose case was not shipped to it |

### 3.7 Ledger service
```
append(event_type, payload):
  prev = last ledger_events row (or "GENESIS")
  hash = sha256(prev.hash + event_type + JSON(payload) + created_at)
  insert row

verifyChain():
  iterate all events in id order, recompute each hash, compare to stored hash and next.prev_hash
  return first broken id if any

merkleRoot(events):
  hash leaves, pair up, repeat until one root (duplicate last leaf if odd)
```
Run `append` inside the **same DB transaction** as the scan/case update.

### 3.8 Non-functional
- Global validation pipe (class-validator), CORS enabled for the frontend origin
- JWT guard + `@Roles()` decorator: Manufacturer-only batch creation, Regulator-only dashboard
- Clear error JSON; log every request in dev

---

## 4. Frontend Requirements (Next.js PWA)

### 4.1 Pages

| Route | Role | Content |
|---|---|---|
| `/login` | all | email + password, redirects by role |
| `/manufacturer` | Manufacturer | list batches, "Create batch" form |
| `/manufacturer/batches/[id]` | Manufacturer | cases and packs, printable QR grid, download all |
| `/scan` | Pharmacy | camera scanner, auto-detects pack vs case from payload type, shows result card |
| `/scan/history` | Pharmacy | own scan history |
| `/dashboard` | Regulator | summary cards, scan log table, flagged list, hotspot map |
| `/ledger` | Regulator | event list, "Verify chain" button, last Merkle root |

### 4.2 Key components
- **QRScanner**: ZXing camera view (`@zxing/browser`), with a **file-upload fallback** and a **paste payload text box** for demo safety if the camera fails
- **ResultCard**: big colour-coded status (green Genuine, amber Suspicious, blue Expired, red Unknown), with the reason line and batch/expiry details
- **BulkResult**: "42 packs received, 1 custody event recorded", with case info
- **BatchForm**: drug name, batch number, mfg/expiry, number of cases, packs per case
- **QRGrid**: renders QR images with `qrcode`, with a "Download printable sheet" option
- **StatCards**, **ScanTable**, **FlaggedList**
- **HotspotMap**: Leaflet + OpenStreetMap markers, or a simple table if short on time
- **LedgerView**: list of events with hash snippet, a red/green "chain valid" banner

### 4.3 PWA requirements
- `manifest.json` + service worker (`next-pwa`) so it is installable
- Mobile-first layout, big tap targets
- Grab geolocation (`navigator.geolocation`) on scan and send lat/lng with the request. Fall back to the user's registered location if permission is denied.

### 4.4 Frontend plumbing
- API client with typed responses (you can generate types from the Swagger JSON)
- Store JWT in memory or localStorage (hackathon-acceptable) and attach it in an Axios/fetch wrapper
- Route guards by role
- Loading and error states on every call

---

## 5. Blockchain / Ledger Requirements

**Honest framing for judges (from the PPT):** the ledger protects *records*, not the physical item, so it is paired with the anomaly engine and AI check.

### 5.1 MVP level (must build)
- Hash-chained `ledger_events` table in Postgres (section 2 and 3.7)
- Events logged: `BATCH_REGISTERED`, `CASE_RECEIVED`, `PACK_SCANNED`, `FLAGGED`
- `/ledger/verify` endpoint and the UI button
- **Demo moment:** manually edit one row in the DB, click "Verify chain", show the red "tampered at event #N" result

### 5.2 Merkle level (should build)
- Periodic job (or manual button) that takes the last N un-anchored events, computes a Merkle root and stores it in `merkle_anchors`
- Show the root in the UI

### 5.3 Testnet anchoring (stretch)
- Tiny Solidity contract `Anchor.sol` with `function anchor(bytes32 root)` that emits an event, deployed on **Sepolia** (or Polygon Amoy)
- Backend uses `ethers` with a funded test wallet to call it, then stores `tx_hash` in `merkle_anchors`
- UI shows a link to the testnet explorer
- **Prepare before the hackathon:** wallet, faucet funds, RPC URL (Alchemy/Infura free tier). Do not spend hackathon hours on faucets.
- Fallback if the testnet is flaky: store the root and show "anchor pending", and explain it verbally.

---

## 6. AI Packaging Check (Stretch)

Only start this after sections 3 to 5 work end to end.

- `ai-service/` FastAPI app with one endpoint: `POST /check-packaging` (image file + expected batch number + expiry date)
- Steps: OCR the image, extract batch/expiry text, fuzzy-compare with the expected values. Optionally compare the image with a stored reference using a simple image similarity (SSIM / histogram / CLIP embedding).
- Return `{ suspicion_score: 0-100, findings: [...] }`. **Never output "100% genuine"** (as stated in the PPT).
- NestJS `verify` module calls it when a photo is attached, and merges the score into the result card.
- Fallback for the demo: if OCR is slow or poor, use a pre-recorded sample pair (good pack vs fake pack photo).

---

## 7. Workflow

### 7.1 System workflow
```
Manufacturer registers batch
        |
        v
Backend creates: Batch -> Cases -> Packs (128-bit serials + HMAC)
        |  (ledger: BATCH_REGISTERED)
        v
QR codes generated and printed on packs / cases
        |
        v
Pharmacy receives delivery
   |-- manufacturer ships case -> /shipments -> SHIPPED event + expected recipient
   |-- pharmacy receives case -> /cases/:code/receive -> receipt + child packs received
   |-- anyone checks pack -> /verify/check -> HMAC -> expiry/conflict rules
   |-- pharmacy sells pack -> /packs/:serial/sell -> SOLD state + sale event
        |
        v
Result: GENUINE / SUSPICIOUS / EXPIRED / UNKNOWN
        |
        v
Scan stored + ledger event appended (hash-chained)
        |
        v
Regulator dashboard: summary, flagged events, hotspots, ledger integrity
```

### 7.2 Request flow (single check)
```
Browser (ZXing) -> POST /verify/check {payload, lat, lng, deviceId}
  NestJS: verify HMAC -> query packs/batches (Postgres)
        -> evaluate conflicting facts, not repeated check count
        -> insert CHECK row without changing pack state
        -> LedgerService.append(PACK_CHECKED)   [same transaction]
  <- { result, reasons, batch, expiry, sold }
```
---

## 8. 10-Hour Timeline

Suggested split for the 3 members (Backend/AI lead, Frontend/UI, Research/Docs). Adjust as needed.

| Hour | Backend + DB (lead) | Frontend | Docs / Demo prep |
|---|---|---|---|
| 0 to 1 | Repo, Docker Postgres, NestJS scaffold, DB schema, seed script | Next.js + Tailwind scaffold, PWA config, layout | Finalize demo script, test data list |
| 1 to 3 | Auth + roles, batch creation, serial/HMAC/QR payload generation | Login, manufacturer pages, batch form, QR grid | README, architecture diagram from PPT |
| 3 to 5 | `/verify/check`, `/shipments`, case receipt, sale, scans table | Scanner page + result cards (with paste/upload fallback) | Record screenshots as backup |
| 5 to 7 | Anomaly rules, ledger service, `/ledger/verify`, dashboard endpoints | Dashboard, flagged list, ledger page, geolocation | Prepare pitch slides and talking points |
| 7 to 8.5 | Merkle roots; start AI service or testnet anchor (stretch) | Hotspot map, polish, error states | Rehearse demo end to end |
| 8.5 to 10 | **Feature freeze.** Bug fixes, deploy / ngrok, reset seed data | UI polish, test on a real phone | Final rehearsal, backup screen recording |

**Rules for the day**
- Get a **vertical slice working by hour 4**: create batch, scan pack, see result. Everything else builds on it.
- Commit often, merge small PRs, and agree on the API contract (Swagger) in hour 1 so frontend can mock while backend builds.
- Freeze features at hour 8.5. Do not start anything new after that.

---

## 9. Pre-Hackathon Checklist

- [ ] Node 20+, Docker, Postgres image pulled, Python 3.11 (if doing AI)
- [ ] Repo cloned, `/frontend`, `/backend`, `/ai-service` folders and `.env.example` ready
- [ ] Packages pre-installed once (so the hackathon Wi-Fi is not the bottleneck): `@nestjs/*`, `prisma`/`typeorm`, `bcrypt`, `@zxing/browser`, `qrcode`, `next-pwa`, `leaflet`, `ethers`
- [ ] Testnet wallet funded, RPC key saved (only if attempting anchoring)
- [ ] Phone charged, ngrok account set up for HTTPS camera testing
- [ ] Sample images: a real-looking pack photo and an altered one (for the AI demo)
- [ ] Laptop fully charged, offline copy of the demo video as a fallback

---

## 10. Definition of Done (MVP)

- [ ] A manufacturer can register a batch and download QR codes
- [ ] A pharmacy can scan a single pack and get one of four results with a reason
- [ ] A pharmacy can scan a case and mark all its packs received with one custody event
- [ ] Repeat-scan, impossible-travel and double-received-case rules each trigger on demand
- [ ] The dashboard shows summary, scan log and flagged events
- [ ] The ledger verify button detects a manually tampered row
- [ ] The whole flow runs from a phone browser as an installable PWA
