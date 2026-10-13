# WS25 Integration Patch

## Purpose

WS25 is intentionally adapter-driven so WS14/WS15/WS19 can be connected after their contracts stabilize without editing those workstreams from this branch.

## Proposed composition root

The main integration branch should construct `MobService` with thin adapters. Names below are illustrative; map them to the final public APIs exposed by each workstream.

```js
const { MobService } = require('../../services/ko1298-mobs');

const mobs = new MobService(mobDefinition, {
  world: {
    listAggroCandidates: ({ zoneId, origin, range }) =>
      world.queryActorsInRange(zoneId, origin, range),
    getTargetSnapshot: (targetId) => world.getActorSnapshot(targetId),
    onMobSpawn: (mob, event) => world.publishMobSpawn(mob, event),
    onMobStateChange: (mob, event) => world.publishMobState(mob, event),
    onMobDespawn: (mob, event) => world.publishMobDespawn(mob, event),
  },
  movement: {
    chase: (intent) => movement.requestMobChase(intent),
    returnHome: (intent) => movement.requestMobReturn(intent),
    stop: (intent) => movement.stopEntity(intent),
  },
  combat: {
    isTargetAlive: (target) => combat.isAlive(target.id),
    canAggro: (mob, target) => combat.canMobTarget(mob, target),
  },
});
```

## Event direction

1. Host loads verified mob data, constructs `MobService`, then calls `initialize(monotonicNow)`.
2. Host calls `tick(monotonicNow)` on its deterministic server tick.
3. WS14 provides target snapshots and consumes spawn/state/despawn lifecycle events.
4. WS15 consumes chase/return/stop intents and feeds authoritative coordinates into `mobs.syncPosition(...)`.
5. WS19 remains authoritative for damage/HP and feeds HP into `mobs.applyHealth(...)`.

## Merge-time checks

- Do not make WS25 import WS14/15/19 implementation modules directly; keep adapters in the composition root.
- Confirm coordinate axes/units before replacing fixture data.
- Confirm whether WS19 exposes HP as absolute HP or deltas. WS25 expects **absolute authoritative HP**.
- Confirm WS14 target snapshots contain zone and position; adapt fields if needed.
- Confirm WS15 chase can enforce home/leash or at least send position updates frequently enough for WS25 to enforce it on tick.
- Replace fixture data only with sourced 1298 data and record provenance in each real template `sourceRef`.
- Keep packet serialization outside WS25.

## No patch to other workstreams in this branch

WS14 and WS15 branches were not present when WS25 was authored, and WS19 had no domain implementation beyond `main` yet. Therefore this branch contains only the integration contract/documentation and does not modify another workstream's code.
