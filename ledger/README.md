# Ledger

Each event stores `hash = SHA256(event_data + prev_hash)`. Editing an old event breaks every later hash.
Planned: periodically publish a Merkle root of recent events to a public testnet.
Production option: Hyperledger Fabric (permissioned).
