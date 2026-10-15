# P2-08 dependency proposal

At task start `coordination/phase2/OWNERS.json` and `coordination/phase2/CONTRACTS.md` were not yet published. They were re-read before final handoff and now govern this provider. P2-05, P2-07 and P2-11 branches exist but had no provider handoff when rechecked; P2-09 also exists but had no provider handoff. This proposal stays in the P2-08-owned workstream area and does not modify coordinator-owned global contracts.

Requested contracts:

1. **P2-05 NPC gate** — authoritative NPC id, zone and distance check; returns no price/item result.
2. **P2-07 equipment/effect port** — accepts immutable server item/equipment snapshot and returns combat projection/effect application; no item ownership mutation.
3. **P2-09 loot ownership port** — decides party owner/eligibility only; P2-08/WS26 performs durable claim/grant.
4. **P2-11 transaction contract** — one PostgreSQL transaction spanning item placements, item instances, `character_stats.gold`, loot/trade/merchant state and operation journal. P2-08 provides a baseline-compatible SERIALIZABLE adapter using `oldko.server_state` for durable idempotency; P2-11 may supersede it with a dedicated journal/migrations.
5. **P2-00 composition** — dispatch packets into P2-08 only after P2-05 routing and rebuild the real C++/WASM client. No provider-side edits to shared dispatcher/composition are made here.
