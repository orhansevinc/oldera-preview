# WS26 STATUS — Drop / Ground Loot / Pickup

State: **IMPLEMENTED / PRODUCTION-DATA-GATED**
Branch: `ws26-drop-loot`
Scope owner: WS26 only. WS17 inventory, WS22 coin, WS25 mob lifecycle, WS15 movement and WS07 persistence business logic are consumed through ports and are not duplicated here.

## Delivered

- Production path is `ProductionLootService`; the legacy weighted `LootService` remains for fixture/back-compat coverage.
- Verified 1298 adapter for `K_MONSTER.sItem -> K_MONSTER_ITEM.sIndex` plus `MAKE_ITEM_GROUP`.
- Exact 1..10000 probability representation with independent per-slot rolls.
- Deterministic RNG injection and explicit test/replay seeds.
- Verified coin roll contract: 70..100 percent of monster money with legacy cap behavior.
- Verified direct-arrow quantity behavior (20) and normal direct-item quantity (1).
- Fail-closed `ItemProdution` hook for first-slot codes `< 100`; no guessed production algorithm.
- Duplicate monster mapping, drop-table and item-group validation.
- Invalid generated item rejection through WS31/WS17-facing `itemTemplates.exists`.
- Ground loot with unique ID, authoritative zone/position, creation/expiry, ownership, provenance and claimed flag.
- Public-after-time rejected unless an ownership adapter explicitly marks that rule as verified.
- Expiry/despawn persisted through WS07 transaction boundary before in-memory removal.
- Pickup gates: alive, world-ready, connected, same authoritative zone, WS15 distance, ownership and WS17 capacity.
- Client-supplied zone/position are not authoritative pickup inputs.
- Player state is rechecked inside the durable claim transaction to catch disconnect/zone-transition races.
- Item/coin grant, claim persistence, replay commit and audit share stable transaction ID `loot-claim:<lootId>`.
- WS17 remains owner of stack merge/capacity/serial semantics; WS22 remains owner of coin semantics.
- Anti-dupe: synchronous claiming state, durable claim uniqueness hook, serial invariant, replay guard and audit event.
- Two-player claim race, replay/double-click behavior and disconnect-during-pickup coverage.
- Death-event persistence records no-drop too, preventing restart/redelivery rerolls.
- Persisted rehydration excludes already claimed/despawned loot, preventing consumed loot from resurrecting after service restart.
- Party distribution remains an adapter only; no unverified round-robin/random implementation.

## Verification

New production suite: **20/20 PASS**.
Existing legacy suite: **12/12 PASS**.
GitHub Actions `WS26 Loot Domain`: **32/32 PASS**.

Stress coverage:
- **5,000** deterministic death -> drop -> pickup simulations.
- Conservation invariant: every spawned reward is claimed exactly once and zero live loot remains.
- **2,000** deterministic malformed-probability fuzz cases; all fail closed.
- Dedicated service-restart regression proving claimed loot is not rehydrated.

## Production data gate / blockers

The runtime domain is ready for a complete WS31-backed catalog, but this branch intentionally does **not** present one regression sample as the full game dataset.

Remaining integration blockers:
1. WS31 must expose the full verified `K_MONSTER`, `K_MONSTER_ITEM`, `MAKE_ITEM_GROUP` and item-template catalog to the production adapter.
2. 1298 `ItemProdution` behavior for first-slot codes `< 100` needs a separately verified resolver before those rows can be enabled.
3. Party round-robin/random and public-after-time behavior remain disabled until exact 1298 rules are source-backed.

See `DROP_PROVENANCE.md` and `INTEGRATION_PATCH.md`.
