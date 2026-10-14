# OldKO 1298 Progression Model (WS27)

## Scope

WS27 owns XP accounting, source-faithful level transitions, progression death state, respawn request/completion state, replay/idempotency metadata and persistence snapshots.

It does not own combat damage (WS19), mob lifecycle (WS25), loot generation (WS26), world spawn selection (WS14), movement implementation (WS15), nation/loyalty rules, item loss, or database schema/migrations (WS07).

## Fidelity rule

No XP curve is invented. The production `LevelTablePort` must provide the exact verified `LEVEL_UP.RequiredExp` rows. Tests use an explicitly synthetic level table only.

Pinned source provenance is recorded in `workstreams/ws27/SOURCE_PROVENANCE.md`.

## Verified source behavior represented by the runtime

- `MAX_LEVEL` is 80 in the pinned server source used by this project.
- `ExpChange()` performs at most one level-up or one level-down per call and then returns. A very large reward can therefore leave carried XP above the next threshold; WS27 deliberately does not loop across multiple levels in one reward event.
- Negative XP is suppressed below level 6 by `ExpChange()`.
- Level-up conditionally grants +3 stat points and, above level 9, +2 skill points. `compute1298LevelPointRewards()` implements the source condition from caller-supplied totals instead of guessing character storage.
- Level changes recalculate abilities/vitals and trigger a client level-change synchronization. WS27 exposes `VitalsPort` plus `progression.client_sync_required` rather than duplicating combat/stat packet ownership.
- NPC death paths in the source contain both 1% (`maxExp / 100`) and 5% (`maxExp / 20`) XP-loss branches. WS27 never guesses which branch applies: `Verified1298PveDeathLossPolicy` requires the combat/zone adapter to supply `xpLossDivisor: 100` or `20`; otherwise the policy applies zero loss.
- Normal respawn restores HP, leaves normal-regene MP refill unproven, resets world placement/baseline through a port, and uses verified 10-second blinking/immunity. Combat is rejected during blinking; movement is allowed after respawn.

## Deliberately UNKNOWN / adapter-owned

- Exact 1298 XP thresholds (`LEVEL_UP.RequiredExp` rows): **UNKNOWN in current WS31 catalog** -> `LevelTablePort`.
- Exact mob -> XP reward dataset/mapping: `KillRewardPort`.
- Exact party XP eligibility/split formula: `PartyXpPort`.
- Combat/zone mapping to the verified 1% versus 5% death-loss branch: death context adapter.
- Exact world respawn point selection: `RespawnPointPort` -> WS14/world.
- HP/MP formula storage/class coefficient integration: `VitalsPort` / `RespawnVitalsPort`.
- Loyalty/nation-point mutations: `NationPointPort` handoff.
- Item loss: no behavior implemented; no verified rule is guessed.

## State contract

```js
{
  characterId,
  level,                         // 1..80
  experience,                    // bigint in memory; signed carry is tolerated below max level
  deathState,                    // alive | dead | respawn_requested
  death: null | { eventId, kind, killerId, zoneId, occurredAt, xpLossDivisor },
  respawnRequest: null | { requestId, requestedPointId, requestedAt, point },
  immunityUntilMs: null | integer,
  version: nonNegativeInteger,   // optimistic concurrency token
  appliedEventIds: string[]      // replay ledger contract
}
```

`experience` is serialized to decimal string in persistence snapshots. Unsafe JavaScript numeric XP input is rejected.

## Required ports

### LevelTablePort

```js
{
  getMaxLevel(): 80,
  getLevelXpCap(level): bigint | safeInteger | decimalString
}
```

The service rejects a max level other than the verified 80. The threshold rows themselves remain external until a verified dataset is supplied.

### KillRewardPort

```js
{
  resolveXp(killEvent): bigint | safeInteger | decimalString
}
```

`killEvent.eventId` is mandatory and becomes the idempotency boundary. This is designed to consume the stable mob-death event identity exposed by WS25/WS26 without treating WS26 loot data as an XP table.

### LevelRewardPort

```js
{
  onLevelUp({ characterId, fromLevel, toLevel, source, metadata, pointAward }): any
}
```

`pointAward` is populated when the caller supplies `metadata.pointSnapshot` / `awardMonsterKill(..., { pointSnapshot })`:

```js
{
  unspentStatPoints,
  baseStatTotal,
  skillPointTotal
}
```

### VitalsPort

```js
{
  recalculateOnLevelChange({ characterId, fromLevel, toLevel, levelUp, state, source, metadata }): any
}
```

The pinned source recalculates max HP/MP using class coefficients, stats, item/buff modifiers and then synchronizes the client. Those formulas belong behind this port because WS27 does not own those inputs.

### PartyXpPort

```js
{
  allocate({ baseXp, members, kill }): Array<{ characterId, xp }>
}
```

Exactly one allocation per supplied member is required; duplicates/missing rows fail closed.

### RespawnPointPort

```js
{
  resolve({ characterId, level, death, requestedPointId, zoneId }): RespawnPoint
}
```

WS14/world owns authoritative spawn selection.

### RespawnVitalsPort

```js
{
  restoreOnRespawn({ characterId, state, point, rule }): any
}
```

For normal respawn, WS27 publishes `rule: { hp: 'restore_to_max', mp: 'preserve_for_normal_regene' }`. If `maxHp` is present directly in the progression snapshot, WS27 also sets `hp = maxHp`; MP is not fabricated.

### MovementBaselinePort

```js
{
  resetOnRespawn({ characterId, point }): any
}
```

WS15/world performs actual position/baseline mutation.

### NationPointPort (optional)

```js
{
  onDeath({ characterId, death }): any
}
```

WS27 never calculates loyalty/nation points itself.

## XP gain semantics

1. Validate source XP and state.
2. Reject negative reward input.
3. Add XP.
4. If below level 80 and threshold is reached, subtract only the current threshold, level once, run reward/vitals ports, emit level/client-sync events, then stop processing further levels for that event.
5. At level 80, clamp XP at the level-80 threshold and emit `progression.xp_saturated` for discarded overflow.

This intentionally differs from the previous WS27 loop that could grant multiple levels from one kill; the loop was not source-faithful.

## Death lifecycle

`alive -> dead` is a single mutation. Re-delivery of the same `death.eventId` is replayed as a no-op. Any additional death delivery while already dead is also ignored so XP loss cannot be charged twice.

Death records are persistence-visible. Nation/loyalty effects are only handed off. Item-loss behavior is absent by design.

## Respawn lifecycle

```text
dead -> respawn_requested -> alive(blinking/immunity 10s)
```

`requestRespawn()` requires a stable `requestId`, resolves an authoritative world point and persists the pending request. Repeated requests while pending are no-ops.

`completeRespawn()` applies the verified normal HP rule, calls respawn-vitals and movement-reset ports, clears death state, and starts 10-second blinking/immunity. `assertGameplayAllowed()` rejects movement/combat while dead and rejects combat (but not movement) while blinking.

The convenience `respawn()` method performs request + completion sequentially.

## Persistence / replay / concurrency

Every mutation returns:

```js
{
  state,
  events,
  persistence: {
    expectedVersion,
    nextVersion,
    snapshot
  }
}
```

The owning WS07 adapter must persist with compare-and-swap / optimistic concurrency semantics (`WHERE version = expectedVersion` or equivalent). Two concurrent mutations computed from the same old state may both be calculated in process; only one may commit. A stale `expectedVersion` is rejected by WS27 when operating on an already advanced snapshot.

Stable event IDs are recorded in `appliedEventIds` and serialized, providing replay/idempotency semantics across reconnect/restart. A production persistence implementation may move this ledger to a dedicated idempotency store without changing the WS27 event-key contract.

## Events

- `progression.xp_changed`
- `progression.xp_saturated`
- `progression.xp_loss_suppressed`
- `progression.level_up`
- `progression.level_down`
- `progression.level_mutated`
- `progression.death`
- `progression.death_ignored`
- `progression.respawn_requested`
- `progression.respawn_request_ignored`
- `progression.respawn`
- `progression.respawn_immunity_started`
- `progression.movement_baseline_reset`
- `progression.client_sync_required`
- `progression.nation_point_handoff`
- `progression.replay_ignored`
