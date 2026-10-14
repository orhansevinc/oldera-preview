# WS27 Integration Patch

## Construct

```js
const {
  ProgressionService,
  Verified1298PveDeathLossPolicy,
} = require('../../services/ko1298-progression');

const progression = new ProgressionService({
  levelTable,            // exact verified LEVEL_UP.RequiredExp rows; getMaxLevel() must be 80
  levelRewardPort,       // applies point/state mutation in the character/stat owner
  vitalsPort,            // HP/MP/ability recalculation after level change
  killRewardPort,        // verified mob death -> XP lookup
  partyXpPort,           // verified party allocation owner
  respawnPointPort,      // WS14/world spawn selection
  respawnVitalsPort,     // normal respawn HP rule / representation adapter
  movementBaselinePort,  // WS15/world baseline reset
  nationPointPort,       // optional nation/loyalty owner handoff
  deathLossPolicy: new Verified1298PveDeathLossPolicy(),
});
```

## WS25/WS26 death event -> XP

WS26 already establishes a stable mob-death `eventId` for loot idempotency. Reuse that death identity for progression, but do **not** read XP from the loot table.

```js
const result = progression.awardMonsterKill(state, {
  eventId,
  mobInstanceId,
  mobTemplateId,
  killerCharacterId,
  zoneId,
  diedAt,
}, {
  expectedVersion: state.version,
  pointSnapshot: {
    unspentStatPoints,
    baseStatTotal,
    skillPointTotal,
  },
});
```

`KillRewardPort.resolveXp(killEvent)` resolves XP from a verified reward source. Negative/invalid rewards fail closed. Re-delivery of the same kill event returns `progression.replay_ignored` and no second XP grant.

## One level per reward event

Do not wrap WS27 in a caller-side loop to consume all carried XP. Pinned 1298 `ExpChange()` performs one level transition and returns. Carried XP is evaluated again only on a later XP event.

## Level rewards / HP-MP

`compute1298LevelPointRewards()` encodes the verified conditional +3 stat / +2 skill eligibility logic from caller-supplied totals. `LevelRewardPort` owns the actual stat/skill representation.

`VitalsPort.recalculateOnLevelChange()` must bind the character/equipment/class coefficient data required by the source HP/MP formulas. WS27 emits `progression.client_sync_required` after a level change; the packet/session owner should translate that to the 1298 client sync.

## Death

```js
const deathResult = progression.markDead(state, {
  eventId,
  kind: 'monster',
  killerId,
  zoneId,
  occurredAt,
  xpLossDivisor, // 100 or 20 ONLY after combat/zone source mapping identifies the verified branch
}, {
  allowXpLoss: zoneRules.allowXpLossOnDeath,
  expectedVersion: state.version,
});
```

The pinned source has both 1% and 5% NPC-death paths. If the integration layer cannot prove which applies, omit `xpLossDivisor`; default WS27 loss is zero rather than guessed.

Duplicate death delivery while dead is idempotently ignored. PvP nation/loyalty behavior remains `NationPointPort`; no item-loss behavior is implemented.

## Respawn

Two-stage production flow:

```js
const requested = progression.requestRespawn(deadState, {
  requestId,
  requestedPointId,
  zoneId,
}, { expectedVersion: deadState.version });

// Persist requested.persistence with CAS before world relocation if orchestration requires durability.

const completed = progression.completeRespawn(requested.state, {
  expectedVersion: requested.state.version,
  nowMs: Date.now(),
});
```

`RespawnPointPort` supplies the WS14/world-authoritative point. Normal respawn restores HP-to-max, preserves MP unless another verified resurrection mode says otherwise, resets movement baseline via `MovementBaselinePort`, and starts verified 10-second blinking/immunity.

While dead, `assertGameplayAllowed(state, 'movement'|'combat')` rejects both actions. During blinking, combat is rejected while movement remains allowed.

## Disconnect / reconnect

Persist `deathState`, `death`, pending `respawnRequest`, level/XP, `version`, and replay ledger using `toPersistenceSnapshot()`. Rehydrate with `restorePersistenceSnapshot()`. A character disconnecting dead therefore reconnects dead until an authoritative respawn completes.

## Persistence / WS07 contract

For every mutation, use the returned CAS envelope:

```js
await progressionRepository.compareAndSwap({
  characterId: result.state.characterId,
  expectedVersion: result.persistence.expectedVersion,
  nextVersion: result.persistence.nextVersion,
  snapshot: result.persistence.snapshot,
});
```

Only publish events/client sync after persistence commit. If CAS fails, reload and re-evaluate the event; stable event IDs make replay safe.

WS27 does not add a database migration because the concrete WS07 schema/transaction owner remains external to this branch.

## Still required before full production data enablement

- verified exact 1298 `LEVEL_UP.RequiredExp` dataset;
- verified mob-template/death -> XP reward dataset;
- verified party XP formula;
- exact combat/zone mapping for the source 1% vs 5% NPC-death branches;
- WS14 authoritative respawn-point adapter;
- WS07 CAS/idempotency persistence adapter.
