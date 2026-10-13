# WS25 Mob Model

## Scope

`ko1298-mobs` owns a small, deterministic monster lifecycle domain. It does **not** implement KO combat, pathfinding, player movement, world sessions, persistence, drops, skills, or packet encoding.

The state machine is deliberately small:

`idle -> chasing -> returning -> idle`

and the death lifecycle is:

`idle|chasing|returning -> dead -> despawned -> idle (respawn)`

## Data model

A **monster template** describes lifecycle parameters shared by instances: `maxHp`, `aggroRange`, `leashRange`, return tolerance, corpse despawn delay, and respawn delay. `modelRef` is opaque to this service. WS25 does not invent or interpret real KO model/stat identifiers.

A **spawn group** references one template and contains stable spawn points. Instance IDs are deterministic: `<groupId>/<spawnId>`. There is no random spawn selection in this first version.

A **monster instance** stores zone, current/home position, HP, lifecycle state, target ID, death/despawn/respawn timestamps, and a monotonic local revision.

## Fixture vs real data

Every world definition and template is labeled `dataClass: fixture|real`.

- Fixture definitions must use `fixture:` identifiers. The committed fixture file is synthetic lifecycle test data only.
- Real definitions require `sourceRef` provenance. No real 1298 mob/model/stat IDs are committed by WS25 because no verified source table is available in this branch.
- Numeric fixture HP/range/position values are tests, not reconstructed Knight Online data.

## Deterministic targeting

Idle mobs ask the World port for candidates inside the configured aggro range. Candidates are filtered by zone, position validity, WS19 combat policy (`isTargetAlive`, `canAggro`), and range. The nearest eligible target wins; equal distance is resolved by lexical target ID. This removes dependence on array/hash iteration order.

## Leash and return home

WS25 never moves an entity itself. It emits a WS15 movement intent:

- `chase({ mobId, targetId, home, leashRange, atMs })`
- `returnHome({ mobId, home, atMs, reason })`
- `stop({ mobId, atMs, reason })`

WS15 (or an adapter) reports authoritative mob coordinates back through `syncPosition`. A mob returns home when either its own position or its target exceeds the leash from the spawn home. `returning` becomes `idle` only when authoritative position is within `returnTolerance` of home.

## HP, death and respawn

WS25 does not calculate damage. WS19 (or an integration adapter) reports authoritative HP with `applyHealth(mobId, hp, atMs, meta)`. HP zero transitions to `dead`, stops movement and schedules two absolute timestamps:

- `corpseDespawnAt = diedAt + corpseDespawnMs`
- `respawnAt = diedAt + respawnDelayMs`

Validation requires respawn delay to be at least corpse despawn delay. At corpse despawn, WS14 World is notified. At respawn, HP is restored to max, position is reset to home, target/timers are cleared, and World receives a spawn event.

## Integration ports

WS25 imports no implementation from WS14, WS15 or WS19.

### WS14 World port

- `listAggroCandidates(query) -> targetSnapshot[]`
- `getTargetSnapshot(targetId) -> targetSnapshot|null`
- `onMobSpawn(mobSnapshot, event)`
- `onMobStateChange(mobSnapshot, event)`
- `onMobDespawn(mobSnapshot, event)`

Target snapshots need `id`, `zoneId` and `{x,y,z}` position only.

### WS15 Movement port

- `chase(intent)`
- `returnHome(intent)`
- `stop(intent)`
- authoritative position comes back by calling WS25 `syncPosition`.

### WS19 Combat port

- `isTargetAlive(targetSnapshot) -> boolean`
- `canAggro(mobSnapshot, targetSnapshot) -> boolean`
- authoritative mob HP comes back by calling WS25 `applyHealth`.

No WS25 port method applies damage or computes movement.

## Tick contract

`tick(nowMs)` uses caller-supplied monotonic time. There are no `setTimeout`, wall-clock reads or randomness in the domain. This makes lifecycle tests reproducible and lets the host server control scheduling.
