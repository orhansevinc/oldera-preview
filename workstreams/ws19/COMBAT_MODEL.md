# WS19 Combat Model — OldKO 1298 Source-Bounded Core

## Authority rule

WS19 owns combat resolution and combat state transitions. It does **not** own movement, inventory, mob AI, persistence, progression or respawn.

The core accepts narrow ports from those domains and fails closed when authority is missing. Client-reported range/timing values are transport hints, not authoritative combat facts.

## Entity combat snapshot

A combatant carries:

- identity and zone-facing identifiers
- HP/max HP
- MP/max MP and SP/max SP with a selected resource kind
- ALIVE/DEAD state
- class, level and skill-point buckets
- combat snapshot (`ap`, `ac`, hit rate, evasion rate, optional attack amount)
- transient combat state:
  - `attackReadyAt`
  - skill cooldown map
  - effect map
  - death sequence

Equipment remains owned by WS17. Position remains owned by WS15/world. WS19 only consumes projections.

## Normal attack pipeline

`CombatService.normalAttack()` is server-authoritative:

1. source/target validity
2. dead/self rejection
3. request dedupe
4. same-zone validation
5. equipment combat snapshot
6. attack timer / attack delay
7. authoritative distance + weapon range
8. hit outcome
9. physical/AP-vs-AC damage
10. optional verified item adapters
11. HP application
12. single death transition

### Hit model

The Open-KO hit-rate buckets are preserved by exact roll-boundary tests. A FAIL produces zero physical damage; successful buckets continue into the source damage formula.

### Physical normal-attack model

The source physical base is retained:

- defense denominator uses `AC + 240`
- successful pre-item damage uses the Open-KO `0.85 * HitB + 0.3 * random(0..HitB)` envelope
- item/magic and armor stages are adapter seams
- PvP path applies the source final `/3`

WS19 does not invent WS17 item bonus values.

## Type1 / Type2 PvP physical skills

`OpenKo1298PvpPhysicalSkillDamagePolicy` mirrors the verified `Ebenezer/User.cpp::GetDamage()` Type1/Type2 core while deliberately stopping at item-domain seams.

### Type1

- `Type != 0`: non-relative hit; source uses random 0..100 and succeeds only when `HitRateMod > random`
- otherwise relative hit uses `(Attack / Avoid) * (HitRateMod / 100)` and the normal hit bucket function
- temp physical damage = AC-based base * `DamageMod / 100`
- successful Type1 envelope = `tempHit + 0.3 * random(0..tempHit) + 0.99`

### Type2

- HitType 1/2 use the non-relative `HitRateMod > random` rule
- other HitTypes use the relative hit rule
- HitType 1 uses attack power directly before `DamageMod`; other Type2 forms use the AC-based base
- successful Type2 envelope = `0.6 * tempHit + random(0..tempHit) + 0.99`
- Type2 `AddDamage` is passed to the magic/item adapter rather than guessed in core

Both policies then expose source `GetMagicDamage`/item and armor stages as adapters before the final PvP `/3`.

This policy is explicitly PvP. NPC/mob skill-damage parity is not assumed.

## HP / death model

`applyHpDelta()` clamps HP to `[0,maxHp]` and makes death sticky unless an explicit revive call is used.

The first live→dead transition:

- sets DEAD
- increments death sequence
- clears active effects
- emits one `DEATH` event with killer/cause and removed-effect keys

Repeated lethal packets against an already dead target cannot create duplicate death transitions.

WS27 consumes this boundary for XP/progression/respawn consequences.

## Skills and requirements

### Main table

The 1298 main table adapter preserves source fields including:

- target moral
- required level / skill code
- MP/SP cost
- HP cost
- required item class
- exhausted item id
- cast time
- recast time
- success rate
- Type1 / Type2 selectors
- range

Open-KO requirement behavior is preserved:

- `requiredSkillCode % 10 == 0`: level gate; do not invent a class restriction
- otherwise class is `requiredSkillCode / 10`, skill bucket is `% 10`, and required points come from the main-table level field

### Cast / recast

Client table cast/recast values are converted at 100 ms per unit. Client code explicitly treats recast as tenths of a second.

These values are metadata in WS19. Open-KO server code does not provide sufficient evidence to claim that the client recast field is the authoritative server cooldown, and casting-state enforcement in the reviewed path is not treated as proven. A server cooldown may only be enforced through an injected verified policy.

## Type3

Verified `DirectType == 1` HP behavior:

- positive FirstDamage heals
- negative FirstDamage damages only through a resistance-aware magic-damage port
- duration effects tick every exactly 2 seconds
- `tickAmount = totalTimeDamage / (Duration / 2)` using source-style integer truncation
- positive repeating friendly duration effects reject a conflicting active positive duration effect in the verified path

DirectType 2/3/4 are known to exist in source but are not executed as production behavior here until their complete resource/durability ownership is integrated.

## Type4

Verified friendly Type4 behavior:

- duration state is stored
- same active `BuffType` does not stack
- exact table modifier columns are retained
- apply/expire callbacks let the stat owner project modifiers
- cancel, expiration and death remove the effect deterministically

Hostile debuff replacement/stacking semantics remain fail-closed because the reviewed source does not justify a generic production rule for every Type4 debuff.

## Effect ordering

Effects are processed deterministically by:

1. `appliedAt`
2. stable effect key

This avoids nondeterministic multi-effect resolution when multiple effects tick at the same timestamp.

## Cooldown persistence boundary

Combat cooldowns are transient by default. `snapshotCombatState()` excludes cooldowns unless explicitly requested. No reconnect/restart persistence policy is invented by WS19.

## 1298 skill packet boundary

After the `WIZ_MAGIC_PROCESS` opcode the modeled payload is 21 bytes:

`byte command + uint32 skillId + int16 sourceId + int16 targetId + 6 * int16 data`

Commands 1..6 are modeled from the Open-KO client/server enum and lifecycle. Malformed length fails closed.

## Domain ports

### World / WS15

Provides authoritative zone and distance snapshots. WS19 compares distance to weapon/skill range.

### Equipment / WS17

Provides weapon range, attack delay, weapon/item class and optional item-domain combat projections. Required-item-class matching follows the client `HasRequiredWeaponEquipped` group check.

### Mob / WS25

WS25 selects a target; WS19 resolves damage. The mob adapter returns **absolute target HP** and the WS19 death event so WS25 never derives HP independently.

### Progression / WS27

WS19 emits death; WS27 owns XP, progression and respawn state transitions.
