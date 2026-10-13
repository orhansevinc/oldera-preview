# WS19 — KO 1298 Combat / Stat / Skill Model

## Scope

This module is the server-side combat domain for the real Knight Online 1298 target. It does **not** implement movement, inventory, NPCs, persistence, packet transport, client logic, or the complete magic/skill engine.

The implementation is intentionally split into pure formula functions plus adapters so that WS15 (movement/range), WS17 (item/equipment), WS16 (NPCs), the world/session layer, and the real 1298 skill tables can integrate without duplicating their domains.

## Source baseline

Primary source: `Open-KO/KnightOnline`, commit `7d6cf81093e142c928c2ac9510512b2b182178b5`.

Source confidence is high for this workstream because that repository explicitly targets 1298/9 and its shared/client version constants are 1298.

Relevant source files:

- `README.md` — project focus on 1298/9.
- `src/shared/version.h` — `__VERSION = 1298`.
- `src/Server/Ebenezer/User.cpp` — `SetUserAbility`, `SetMaxHp`, `SetMaxMp`, `GetHitRate`, `GetDamage`, `GetACDamage`, HP/death handling, level-up point grants.
- `src/Server/Ebenezer/User.h` — combat/stat fields and method contracts.
- `src/Server/Ebenezer/GameDefine.h` — life states, hit outcomes, weapon kinds, stat/skill slot identifiers.
- `src/Server/Ebenezer/MagicProcess.cpp` — skill availability, class/level/skill-point/MP checks.
- `src/Client/WarFare/GameDef.h` and `MagicSkillMng*` — 1298 cast/recast table fields and client cooldown behavior.

## Primary stats

WS19 exposes five project-facing primary stats:

- `str`
- `sta`
- `dex`
- `int`
- `mpStat` (project-facing Magic Power name)

The historical Open-KO server structure names the fifth stored field `m_bCha` / `STAT_TYPE_CHA`. WS19 accepts `cha` as an input alias but exposes `mpStat` so integration can keep the OldKO vocabulary without rewriting the historical persistence shape.

Effective STR/STA/DEX/INT are additive:

`base + item bonus + temporary/buff amount`

The source has old 255 clamps commented out in these calculations; WS19 therefore does **not** invent an active 255 effective-stat clamp.

## Level and point budgets

Source-confirmed level-up behavior:

- Primary stat budget baseline: `300 + 3 * (level - 1)`.
- Skill points: no earned skill points through level 9.
- From level 10 onward: total earned skill points are `2 * (level - 9)`.
- Skill storage is 9 bytes / slots `0..8`.
- Slot `0` is free/unspent.
- Historical categories `1..4` exist.
- Professional class skill trees are slots `5..8`.

WS19 exposes the budget helpers but does not implement the complete respec/class-change system.

## Class coefficient adapter

Stat formulas require a coefficient row keyed by the real KO class ID. WS19 does not hardcode a guessed class table. The integration layer must provide the row.

Normalized fields used by WS19:

- `hitPoint`
- `manaPoint`
- `sp`
- `armor`
- `hitRate`
- `evasionRate`
- weapon coefficient selected externally for `dagger/sword/axe/mace/spear/bow/staff`

## HP

With `STAe = base STA + item STA + buff STA`:

`maxHP = trunc(hitPointCoeff * level² * STAe + 0.1 * level * STAe + STAe / 5 + flatMaxHpAmount + itemMaxHp)`

Snow-war special cases from the source are intentionally outside WS19 core because zone/event rules belong to world/event integration.

## MP / SP resource maximum

For classes using the `ManaPoint` coefficient, the source adds 30 to effective INT before calculating resource maximum:

`INTsource = effectiveINT + 30`

`maxMP = trunc(manaPointCoeff * level² * INTsource + 0.1 * level * 2 * INTsource + INTsource / 5) + itemMaxMp + 20`

For classes using the `Sp` coefficient:

`maxMP = trunc(spCoeff * level² * effectiveSTA + 0.1 * level * effectiveSTA + effectiveSTA / 5) + itemMaxMp`

If both coefficient paths are zero, WS19 returns `{ mode: "UNKNOWN", value: null }` rather than inventing a formula.

## AP

### Non-bow

`AP = trunc(0.005 * itemHit * (effectiveSTR + 40) + weaponCoeff * itemHit * level * effectiveSTR + 3)`

### Bow / longbow / launcher

`AP = trunc(0.005 * bowDamage * (effectiveDEX + 40) + bowCoeff * bowDamage * level * effectiveDEX + 3)`

The source treats bow separately and uses DEX plus the bow item's damage. WS19 preserves that distinction.

## AC

`AC = trunc(armorCoeff * (bodyAC + itemAC))`

Temporary flat AC amount is kept separate because the source adds it at damage/packet use sites rather than folding it into the base `m_sTotalAc` calculation.

## Hit rate / evasion

`hitRate = ((1 + hitRateCoeff * level * effectiveDEX) * itemHitRate / 100) * (hitRateAmount / 100)`

`evasion = ((1 + evasionCoeff * level * effectiveDEX) * itemEvasionRate / 100) * (avoidRateAmount / 100)`

Neutral item/buff multipliers default to 100.

### Hit outcome bands

The source rolls an integer from 1 through 10,000 and maps the attacker-hit-rate / defender-evasion ratio to `GREAT_SUCCESS`, `SUCCESS`, `NORMAL`, or `FAIL`. WS19 preserves all source thresholds. For normal attacks, the three non-fail outcomes share the same physical damage path; `FAIL` yields zero damage.

## Normal attack damage

For user-vs-user normal hit:

1. `targetAC = target.baseAC + target.flatAcAmount`
2. `tempHitB = trunc((attackerAP * attackAmount * 200 / 100) / (targetAC + 240))`
3. roll hit outcome from `attacker.hitRate / target.evasionRate`
4. on success, choose integer `r` in `[0, tempHitB]`
5. `physical = trunc(0.85 * tempHitB + 0.3 * r)`
6. apply magical-item damage stage (adapter; WS17-owned item data)
7. apply weapon-specific armor stage (adapter; WS17-owned item data)
8. `finalDamage = trunc(damage / 3)`
9. clamp HP to `[0, maxHP]`; reaching zero transitions ALIVE -> DEAD

`attackAmount` is a separate percentage multiplier, default 100.

### Item-dependent damage stages

The 1298 source performs elemental/item damage and weapon-type armor reductions after the physical roll. WS19 does not implement inventory/equipment ownership. Instead:

- `magicItemDamageAdapter` can apply fire/cold/lightning/poison/drain-related item effects.
- `weaponArmorAdapter` can return either one matching armor value or an ordered array for the attacker’s right/left weapon projections. WS19 applies array entries sequentially, matching the source’s per-hand weapon-armor reduction order without owning equipment.

The helper `applyWeaponArmor()` implements the source reduction arithmetic once WS17 supplies the correct value(s).

## Resistance model

WS19 recognizes the source fields:

Elemental/status:

- fire
- cold
- lightning
- magic
- disease
- poison

Weapon armor:

- dagger
- sword
- axe
- mace
- spear
- bow

The source builds these from equipment. WS19 stores/normalizes them but does not read inventory itself.

## Range validation

WS19 deliberately contains **no movement or coordinate implementation**. Both normal attacks and range-sensitive skills call an injected range validator.

Default behavior is fail-closed:

`RANGE_VALIDATION_UNAVAILABLE`

WS15 should provide the real distance/zone-aware implementation. This avoids silently accepting remote attacks while respecting the workstream boundary.

## Life / death state

Core states in WS19:

- `ALIVE`
- `DEAD`

The source has additional standing/sitting/blinking status values, but they are not combat life states needed in Stage 1.

Generic HP healing cannot automatically revive a DEAD entity. Resurrection must use an explicit future resurrection path (`allowRevive`) because the source has dedicated regeneration/resurrection flows.

## Skill request framework (Stage 2 only)

The skill service performs validation in this order:

1. skill exists in adapter
2. caster alive
3. target alive unless skill explicitly permits a dead target
4. class requirement
5. level requirement
6. professional skill-point requirement
7. cooldown
8. MP resource
9. range hook when required
10. supported Stage-2 effect type
11. resource deduction + cooldown start + effect application

No resource/cooldown mutation occurs before all validation succeeds.

### Skill table normalized row

The adapter may return:

```text
id
classId?
requiredLevel?
skillPointSlot?
requiredSkillPoints?
manaCost?
cooldownMs?
requiresRange?
allowDeadTarget?
effect
```

`InMemorySkillTableAdapter` exists for tests/fixtures only. Production integration must adapt the real 1298 magic tables.

### Fixture skills

Tests use synthetic IDs `900001..900004`. They are **not claimed to be real KO skills**. They only prove the framework for damage/heal/no-op/unsupported paths without inventing live-server skill formulas.

## UNKNOWN / TODO (deliberately not guessed)

- Exact production server-side cooldown policy for every 1298 skill. The 1298 client exposes `iReCastTime`, but the examined Ebenezer availability path does not provide enough evidence to claim a complete authoritative server cooldown implementation. Production adapter must normalize confirmed cooldown data to `cooldownMs`.
- Complete Type 1/2/3/4/5/7/8 magic execution formulas.
- Exact skill-specific damage, buffs, debuffs, DOT/HOT, resurrection, item consumption, arrows, cast interruption, combo semantics.
- Item elemental damage/resistance and weapon-armor lookup wiring until WS17 supplies equipment data.
- Position/range math until WS15 supplies movement/position state.
- NPC combat until WS16 supplies NPC entities/stats.
- Packet encoding/transport/world broadcasts; these belong to session/world/protocol workstreams.

No unsupported formula is filled with a guess.
