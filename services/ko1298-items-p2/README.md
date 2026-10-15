# P2-08 item/economy authority

This provider composes the WS17 item/inventory domain, WS22 economy/trade domain, WS26 loot domain and WS33 Inn domain without taking ownership of the Phase-2 dispatcher, UI, NPC router or shared migration set.

## Authority rules

`ItemEconomyAuthority` is the only command-side entry point proposed for Phase-2 item/coin mutations. Every mutation carries a stable `operationId` and executes through `transactionManager.runOnce()`. Client-supplied prices, gold totals, drop outcomes, repair costs and upgrade chances/results are rejected. Price, repair and upgrade behavior must come from source-backed resolvers carrying `verified: true` and a provenance `source`; unresolved rules fail closed rather than inventing values.

The PostgreSQL adapter uses the schema already present at the WS50 baseline: `oldko.item_instances`, `oldko.character_items`, `oldko.inventory`, `oldko.inn_storage`, `oldko.character_stats` and `oldko.server_state`. It uses SERIALIZABLE transactions, deterministic advisory-lock ordering and a durable `server_state` operation journal. The existing database UNIQUE constraints/triggers remain the final duplicate-placement/serial defense.

## Integration ports

- P2-05: `npc.assertInteraction(tx,{characterId,npcId,action})` owns NPC identity/range/dialog routing.
- P2-07: `equipmentRules.resolveEquip(...)` and `effects.apply(...)` consume/produce combat projections; P2-08 owns item placement, not combat formulas.
- P2-09: `lootOwnership.assertClaim(...)` resolves party/ownership policy; WS26/P2-08 keep durable one-time claims.
- P2-10: consumes results/projections only; the client never supplies authoritative price/drop/upgrade state.
- P2-11: may replace the compatibility `server_state` operation journal with a dedicated shared transaction/journal schema. P2-08 does not add shared migrations.
- P2-00: wires dispatcher/production composition and rebuilds the real C++/WASM client.

## Tests

`tests/phase2/p2-08-items/authority.test.cjs` is a deterministic provider test. `postgres.integration.test.cjs` is opt-in (`P2_08_REAL_POSTGRES=1`, `DATABASE_URL=...`) and verifies rollback plus replay after constructing a fresh transaction-manager instance. Real two-client trade/NPC shopping/relog acceptance remains an integration gate and must not be inferred from service tests.
