# OldKO 1298 Progression Model (WS27)

## Scope

WS27 owns experience accounting, level transitions, progression-related death state, respawn state, and interfaces to mob rewards, party allocation, level rewards, respawn points, and nation-point rules.

It does not implement WS19 combat, WS24 zone/nation rules, WS25 mob AI, database migrations, client code, or admin/site behavior.

## Fidelity rule

Production behavior must come from verified patch data. WS27 therefore does not invent a formula or level table.

### Verified behavior implemented

Historical Knight Online server source in Open-KO shows:

- negative XP is ignored below level 6;
- a negative XP delta can reduce level when the character is above level 5;
- NPC/monster death paths call `ExpChange(-m_iMaxExp / 100)`, i.e. one percent of the current-level XP requirement;
- level requirements are read from a level-up table (`RequiredExp`) rather than inferred from a formula.

The default `Verified1298PveDeathLossPolicy` therefore implements only the conservative portion that can be defended from the checked source:

- monster death only;
- no XP loss below level 6;
- one percent of the configured current-level XP cap;
- no guessed PvP XP loss.

Zone/battle exemptions are provided by the composition layer via `allowXpLoss`; WS27 does not duplicate WS24 zone constants.

### Deliberately not hard-coded

The following remain adapters/TODO until verified against the exact target patch:

- exact 1298 level XP thresholds;
- exact target-patch maximum level;
- stat-point awards;
- skill-point awards;
- party XP split formula;
- PvP XP-loss semantics;
- respawn coordinates and point-selection rules;
- nation-point gain/loss.

Private-server pages frequently advertise version 1298 with a 70 cap, but that is server configuration evidence rather than sufficient proof of the original patch maximum. Modern Open-KO source also exposes a different `MAX_LEVEL`, which is another reason not to turn an era assumption into a WS27 constant.

## State contract

```js
{
  characterId: string | number,
  level: integer,
  experience: bigint | safe integer | nonNegativeIntegerString,
  deathState: "alive" | "dead",
  death: null | {
    kind: "monster" | "player" | "unknown",
    killerId: string | number | null,
    zoneId: string | number | null,
    occurredAt: string | number | null
  }
}
```

XP is normalized to `bigint`. Unsafe JavaScript numbers are rejected instead of silently rounding.

## Required ports

### LevelTablePort

```js
{
  getMaxLevel(): number,
  getLevelXpCap(level): bigint | number | string
}
```

The production implementation must provide verified 1298 data. `getLevelXpCap(level)` is the current level's XP progress cap.

### LevelRewardPort

```js
{
  onLevelUp({ characterId, fromLevel, toLevel, source, metadata }): any
}
```

WS27 emits each level transition. The owning stat/skill domain applies verified rewards.

### PartyXpPort

```js
{
  allocate({ baseXp, members, kill }): Array<{ characterId, xp }>
}
```

Every supplied party member must receive exactly one allocation. Missing or duplicate allocations fail closed.

### RespawnPointPort

```js
{
  resolve({ characterId, level, death, requestedPointId, zoneId }): RespawnPoint
}
```

WS27 changes dead -> alive and emits the returned point. World/movement code performs the actual relocation.

### NationPointPort (optional)

```js
{
  onDeath({ characterId, death }): any
}
```

This is only an integration seam. WS27 does not calculate NP.

## XP gain and overflow protection

1. Validate level and current XP against the configured table.
2. Normalize XP to `bigint`.
3. Consume configured level caps one at a time.
4. Invoke `LevelRewardPort.onLevelUp()` for every crossed level.
5. At configured max level, saturate at that level's configured cap and emit `progression.xp_saturated` for discarded overflow.

## XP loss

Negative XP is accepted only on an explicit authorized path. Loss can cross a level boundary. The default 1298-style death behavior cannot remove progression below level 5 because death XP loss is disabled below level 6.

## Death and respawn

`markDead()` records death state, obtains any XP loss from the configured policy, applies it, and optionally hands death information to the nation-point port. It does not perform combat calculations.

`respawn()` requires a dead character, resolves a destination through `RespawnPointPort`, transitions back to alive, and emits `progression.respawn`. It does not mutate WS14/WS15 world or movement implementations.

## Events

- `progression.xp_changed`
- `progression.xp_saturated`
- `progression.level_up`
- `progression.level_down`
- `progression.death`
- `progression.respawn`
- `progression.nation_point_handoff`

## Production TODOs

1. Supply the verified 1298 level table and exact target max level.
2. Bind WS25/WS26 mob reward XP to `awardMonsterKill()`.
3. Supply exact party XP eligibility/split behavior through `PartyXpPort`.
4. Supply verified stat/skill reward behavior through `LevelRewardPort`.
5. Let WS24 decide zone-specific XP-loss allowance and nation-point rules.
6. Supply world-owned respawn point data through `RespawnPointPort`.
7. Persist returned state atomically in the owning persistence layer; WS27 adds no DB migration.
