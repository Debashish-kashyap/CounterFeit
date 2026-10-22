# Architecture (draft)

Users -> Next.js PWA -> REST API (NestJS) -> PostgreSQL
The REST API also calls: anomaly rules, the AI service (FastAPI), and the ledger log.

## Verification flow
1. A user scans a pack or case code.
2. The API checks the HMAC signature in the payload, then looks up the serial.
3. The anomaly engine checks scan count and location history.
4. The result (valid, suspicious, expired, unknown) is returned and logged as an event.
5. Each event is appended to the hash chain.

## Build order
Registry API, QR scan, bulk and single check, anomaly rules, dashboard, AI check, ledger anchoring.
