# WS19 Status

## Identity

- Workstream: WS19
- Branch: `ws19-combat-core`
- Base: `main` at `a1c1d6b3e9aeb07fd066cee8a41714685557dddf`
- Scope: real KO 1298 combat/stat/skill domain

## Completed

### Stage 1

- primary stat model (STR/STA/DEX/INT/MP-stat aliasing)
- source-based HP calculation
- source-based MP/SP-resource calculation
- source-based AP calculation with bow/non-bow split
- source-based AC calculation
- source-based hit/evasion calculations
- complete source hit-outcome threshold table
- damage policy interface
- source normal-attack physical damage path
- optional item-magic / weapon-armor post-processing adapters
- fail-closed range validation hook
- HP clamp/update
- ALIVE/DEAD state
- sticky death; explicit revive path only

### Stage 2

- skill-table adapter interface
- skill request framework
- caster/target alive checks
- class validation
- level validation
- skill-point validation
- MP validation
- cooldown validation/storage
- range validation hook
- test-only fixture damage/heal/no-op effects
- synthetic fixture skills (not production KO skill claims)

## Tests

Command:

`node --test tests/ko1298-combat/*.test.js`

Current local result before commit:

- 17 tests
- 17 pass
- 0 fail

Coverage includes formula arithmetic, hit-band boundaries, normal attack, range fail-closed behavior, HP/death state, explicit revive behavior, class/level/skill/MP validation, cooldown, range rejection, and mutation ordering.

## Source confidence

Primary reference is Open-KO/KnightOnline commit `7d6cf81093e142c928c2ac9510512b2b182178b5`, explicitly focused on 1298/9 with version constant 1298.

## Deliberate UNKNOWN/TODO

See `COMBAT_MODEL.md`. Most importantly: the full Type1..8 skill engine and exact production server cooldown policy are not guessed.

## Boundary audit

Not modified:

- client
- inventory implementation
- movement implementation
- NPC implementation
- DB migrations
- admin/site
- main branch

No force push and no main merge.

## Integration status

Conditional-ready. Core domain is complete and tested; production accuracy for distance/item-dependent stages requires the WS15/WS17 adapters and the real 1298 data tables described in `INTEGRATION_PATCH.md`.
