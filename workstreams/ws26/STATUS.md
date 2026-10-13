# WS26 Status

## State

COMPLETE on branch `ws26-drop-loot`.

## Delivered

- Mob death -> reward generation service with event-id idempotency.
- Validated weighted drop-table model with `item`, `coin`, and explicit `none` entries.
- Deterministic seeded RNG and tests.
- Quantity range rules and rejection of negative/impossible configurations.
- Ground-loot lifecycle with ownership metadata, timeout, despawn sweep, and pickup state.
- Pickup validation ports for ownership, zone, distance, and inventory capacity.
- WS17-facing item grant, unique-serial factory, duplicate-serial reservation/commit/release hooks.
- Coin grant interface.
- WS18-compatible party ownership interface without implementation dependency.
- Concurrent pickup guard and rollback of transient claim state on failed grants.
- Synthetic fixture drop data explicitly marked non-authoritative.
- CI workflow scoped to WS26 paths.

## Historical-data position

WS26 found no authoritative KO 1298 drop dataset in its `main` starting point. It therefore commits no claimed real drop rates/items/coins. The only world-data file is `fixture.synthetic.json`, which is explicitly synthetic and must not be promoted to production.

## Integration dependencies

- WS25: map authoritative mob-death transition to `createFromMobDeath()`.
- WS17: implement inventory capacity, item grant, serial factory, and duplicate-serial transaction adapter.
- WS18: optionally implement party-aware ownership/loot mode adapter.
- World/movement integration: provide authoritative distance check and verified pickup radius.
- Economy integration: provide coin grant adapter if production tables contain coin drops.

See `INTEGRATION_PATCH.md` for exact adapter shapes.
