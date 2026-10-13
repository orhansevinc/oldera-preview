# WS19 Integration Patch

## Files to integrate

Merge/copy only the WS19-owned paths:

- `services/ko1298-combat/**`
- `tests/ko1298-combat/**`
- `workstreams/ws19/**`
- `.github/workflows/ws19-combat.yml`

No existing product file outside those paths is modified by WS19.

## Runtime entry point

```js
const {
  CombatService,
  OpenKo1298NormalAttackDamagePolicy,
  SkillService,
} = require('./services/ko1298-combat');
```

## Required integration adapters

### 1. Character snapshot / coefficient adapter

World/session character state should provide:

- stable character id
- real KO class id
- level
- current/max HP
- current/max MP/SP resource
- base primary stats
- current combat snapshot (`ap`, `ac`, `hitRate`, `evasionRate`, percentage/flat modifiers)
- skill-point slots

The class coefficient table must be adapted to the fields documented in `COMBAT_MODEL.md`; do not hardcode guessed class coefficients in WS19.

### 2. WS15 range adapter

Provide a function shaped like:

```js
({ attacker, target, kind, context }) => ({ ok: true })
```

or:

```js
({ caster, target, skill, kind, context }) => ({ ok: false, reason: 'OUT_OF_RANGE' })
```

It must own coordinate/zone/distance rules. WS19 intentionally does not read or update position.

### 3. WS17 equipment adapter

Provide read-only combat projections from equipped items:

- item hit / bow damage
- item AC
- item HP/MP
- item STR/STA/DEX/INT/MP-stat bonuses
- item hit/evasion multipliers
- elemental/status resistance totals
- weapon armor totals
- attacker weapon kind
- item magical damage properties if/when integrated

WS19 must not move/equip/consume items.

For exact normal-attack post-processing, wire:

- `magicItemDamageAdapter`
- `weaponArmorAdapter` (one value or ordered right/left values)

### 4. Real skill-table adapter

Replace `InMemorySkillTableAdapter` with a read-only adapter over the real 1298 magic tables. Normalize confirmed fields to WS19's Stage-2 contract.

Do not map unknown Type1..8 semantics to the fixture `FLAT_DAMAGE`/`FLAT_HEAL` effects. Those effects are test-only framework fixtures.

## Normal attack integration

Recommended orchestration:

1. session/world resolves attacker + selected target
2. build WS19 combat views (live domain objects or mutable copies) from authoritative read-only world/item projections
3. `CombatService.normalAttack(attacker, target, context)` mutates only combat HP/life-state on the supplied target view
4. if a copy was used, sync the returned HP/life-state atomically to the owning world/session entity
5. world/session broadcasts protocol packets/events
6. if `hp.died`, owning world/session triggers its death/broadcast/reward hooks

WS19 itself must not send packets or update movement/world/NPC state.

## Skill request integration

Recommended orchestration:

1. protocol/session parses the 1298 skill request
2. resolve caster/target
3. call `SkillService.request(...)`
4. convert WS19 reason codes to the packet/protocol response in the owning session/protocol layer
5. only supported Stage-2 framework effects are applied here
6. later Type1..8 implementation should be added behind effect executors/adapters, not as packet code inside WS19

## Event/reason codes currently exposed

Normal attack may return:

- `ATTACKER_DEAD`
- `TARGET_DEAD`
- `RANGE_VALIDATION_UNAVAILABLE`
- range-adapter reason (normally `OUT_OF_RANGE`)
- `INVALID_HIT_EVASION`

Skill request may return:

- `UNKNOWN_SKILL`
- `CASTER_DEAD`
- `TARGET_DEAD`
- `CLASS_MISMATCH`
- `LEVEL_TOO_LOW`
- `SKILL_POINTS_TOO_LOW`
- `COOLDOWN`
- `INSUFFICIENT_MP`
- `RANGE_VALIDATION_UNAVAILABLE`
- `OUT_OF_RANGE`
- `UNSUPPORTED_EFFECT`

## Integration order / dependency note

WS19 is independently testable, but production integration is **conditional** on read-only adapters from:

- WS15 for authoritative range/position validation
- WS17 for item/equipment projections
- real 1298 coefficient + magic-table data source

NPC combat can be added after WS16 provides stable NPC entity snapshots.

No DB migration is required by WS19.
