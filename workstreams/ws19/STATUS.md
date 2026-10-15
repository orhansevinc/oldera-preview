# WS19 — Combat / Stat / Skill Core Status

## State

Production-oriented combat core with a source-backed OldKO/Open-KO 1298 playable PvE slice.

Deterministic evidence at this revision:

- `node --test tests/ko1298-combat/*.test.js`
- 66 tests / 66 pass / 0 fail
- 5,000-attack deterministic PvE regression included
- verified golden skill fixtures remain isolated from synthetic test fixtures

Task-start provider locks for the playable PvE delta:

- WS11 `4e86f75c55e66bef3da5cb8aa037d69b9f5c4852`
- WS25 `18c9e9b8439fef88fc93d74bfec7981b0cb41958`
- WS31 `56ada741532c8f6cabfc83b129a8e87e645db055`

Canonical playable fixture:

- Karus Warrior, level 3
- Short Sword `120010000`
- Slash `101003`
- Bandicoot SID `850`

Machine-readable authority: `workstreams/ws19/PLAYABLE_PVE_AUTHORITY.json`.

## Normal attack

The existing PvP normal-attack policy remains intact. Playable PvE uses a dedicated source-backed path in `pve-combat.js`.

Player → mob follows pinned AIServer `CUser::GetDamage()` semantics:

1. `HitB = trunc((playerAP * 200) / (mobAC + 240))`
2. hit bucket from `playerHitRate / mobEvadeRate`
3. FAIL = 0 damage
4. successful normal hit = `trunc(0.85 * HitB + 0.3 * myrand(0, HitB))`
5. no PvP `/3` final divisor
6. no invented minimum damage

The target snapshot must supply exact WS25 HP/maxHP, AC, evade, hit, damage, attack delay/range, alive/targetable/attackable fields. Missing authority fails closed; source-valid zero values such as Bandicoot `sAtk=0` remain valid and are not replaced.

Short Sword combat input is normalized-only: `weaponRange=1.0`, `attackDelayMs=1140`, `damage=4`, plus weapon identity/type. WS19 does not convert raw item units.

Mob HP is never shadow-owned by WS19. Successful player damage is committed as absolute HP through WS25 `applyCombatResult()`, including WS25's idempotency and exactly-once death transition.

## Slash 101003 PvE

Verified/implemented production slice:

- Type1 only
- EFFECTING only
- ENEMY moral
- level >= 3
- weapon required
- MP/SP cost 4
- Type1 hit-rate modifier 100%
- Type1 power 120%

Pinned AIServer Type1 PvE damage:

1. compute the same AP-vs-mob-AC `HitB`
2. `skillHit = trunc(HitB * 120 / 100)`
3. Type1 `type=0` hit bucket uses `(playerHitRate / mobEvadeRate) * 100/100`
4. FAIL = 0
5. success = `trunc(skillHit + 0.3 * myrand(0, skillHit) + 0.99)`
6. apply absolute target HP through WS25

Resource mutation is exposed only through the public player combat port. For the canonical Warrior fixture the source-backed resource mode is SP, so Slash changes SP by `-4`; the shared skill-table field remains the 1298 MP/SP cost field.

### Slash range authority

`Skill_Magic_Main` has `iValidDist=0`, but that is not an unknown or unlimited-range semantic.

Pinned 1298 client `CMagicSkillMng::CheckValidDistance()` resolves Type1 fallback range as:

`rightHand.siAttackRange / 10.0 + targetRadius + 1.0`

For Short Sword the weapon component is `1.0`; WS19 does not invent a target radius to turn this into a guessed fixed distance.

The pinned Ebenezer `CMagicProcess::IsAvailable()` + AIServer Type1 execution path does not repeat this Type1 target-distance check as a server security gate. WS19 therefore records the exact client range rule but does not invent server enforcement.

The client recast value `3.1s` is metadata, not silently promoted to server-authoritative cooldown. A server cooldown can only be applied through an explicit injected policy.

## Mob → player

WS25 remains aggro/chase/attack-intent/lifecycle owner. WS19 consumes the enriched WS25 attack intent and verifies it against the current WS25 combat snapshot and authoritative position before resolving damage.

Pinned `CNpc::GetFinalDamage()` semantics:

- Attack = mob `sHitRate`
- Avoid = player authoritative evasion
- Hit = mob `sDamage` (not `sAtk`)
- AC = player authoritative total AC
- `HitB = trunc((Hit * 200) / (AC + 240))`
- hit bucket = `sHitRate / playerEvasion`
- NORMAL/SUCCESS = `trunc(0.3 * myrand(0, HitB)) + trunc(0.85 * HitB)`
- GREAT_SUCCESS applies source `*3/2`
- damage is clamped to `trunc(2.6 * sDamage)`
- FAIL = 0

Player HP mutation is delegated to the public `playerCombatPort.applyHealthResult()` boundary.

## Combat events

The playable PvE semantic layer emits no packet bytes. It produces:

- `NORMAL_ATTACK_RESULT`
- `TARGET_HP_CHANGED`
- `MAGIC_PROCESS_RESULT`
- `PLAYER_HP_CHANGED`
- `TARGET_DIED`

`TARGET_DIED` is emitted only on the authoritative death transition.

## Existing generic combat / skills

The earlier generic/PvP combat and verified table adapters remain available:

- `Skill_Magic_Main_us.tbl.csv`
- `Skill_Magic_1.tbl.csv`
- `Skill_Magic_2.tbl.csv`
- `skill_magic_3.tbl.csv`
- `skill_magic_4.tbl.csv`

Golden representative skills remain Slash, Archery, Flash, Tiny Healing, Strength and Tiny Restore.

## Integration ports

- WS15-shaped authoritative world/position port, now also capable of mob attack-range validation
- WS17-shaped normalized equipment combat snapshot port; old return shape remains backward compatible when newer fields are absent
- WS25 `MobCombatService.getCombatSnapshot()` + `applyCombatResult()` consumed directly by playable PvE
- public authoritative player combat port for HP/resource mutation
- generic player combat port retained
- WS27 remains owner of progression/XP/respawn consequences after WS19 death semantics

## Fail-closed / UNKNOWN outside this milestone

Not presented as production-verified behavior outside the playable slice:

- Type5..Type10 execution semantics
- Type3 DirectType 2/3/4 full production execution
- Type3 elemental/resistance formula without magic damage adapter
- hostile Type4 debuff replacement/stacking rules
- area/corpse/undead target selection semantics
- persistence of optional injected cooldown policy across reconnect/restart
- exact item elemental / drain / armor absorption formulas until a verified equipment adapter supplies them

There is no remaining WS19 formula/range/cooldown blocker for the requested Karus Warrior → Bandicoot normal attack + Slash + Bandicoot retaliation domain slice. Packet encoding remains WS11 ownership and mob lifecycle remains WS25 ownership.
