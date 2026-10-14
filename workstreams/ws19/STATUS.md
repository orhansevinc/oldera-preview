# WS19 — Combat / Stat / Skill Core Status

## State

Production-oriented combat core expanded from the previous 17-test synthetic-skill framework into a source-bounded OldKO/Open-KO 1298 combat engine.

Local deterministic evidence at this revision:

- `node --test tests/ko1298-combat/*.test.js`
- 56 tests / 56 pass / 0 fail
- 5,000-attack deterministic normal-attack simulation included
- verified golden skill fixtures are isolated from synthetic test fixtures

## Normal attack

Implemented authoritative request lifecycle:

1. validate source/target identities
2. reject self/dead source/dead target
3. deduplicate ingress request key
4. enforce same-zone through world snapshot port
5. require WS17-style equipment combat snapshot
6. resolve authoritative attack delay from injected policy or equipment snapshot
7. enforce attack timer
8. validate authoritative distance against weapon range through world port
9. resolve Open-KO hit bucket
10. resolve physical/AP-vs-AC damage core
11. run optional item magic / weapon armor adapters
12. apply authoritative HP delta
13. emit one sticky death transition/event

Client supplied attack interval/distance are not trusted as server authority. `attackDelayMs` conversion and weapon range must be supplied by a verified equipment/world adapter; missing authority fails closed.

## Combat state

Authoritative transient state now includes:

- HP / max HP
- MP or SP resource state
- ALIVE / DEAD life state
- attack ready time
- server-injected skill cooldown map
- deterministic effect collection for Type3 duration and Type4 states
- death sequence and single death-event transition

Cooldowns are transient by default. Persistence only occurs when an integration explicitly asks for cooldowns in the snapshot.

## Real 1298 skill data

Verified table adapters exist for:

- `Skill_Magic_Main_us.tbl.csv` — exactly 30 columns
- `Skill_Magic_1.tbl.csv` — exactly 12 columns
- `Skill_Magic_2.tbl.csv` — exactly 6 columns
- `skill_magic_3.tbl.csv` — exactly 7 columns
- `skill_magic_4.tbl.csv` — exactly 26 columns

Golden representative skills: **6**

- 101003 Slash — Type1
- 102003 Archery — Type2
- 103001 Flash — Type3 direct HP damage
- 104001 Tiny Healing — Type3 direct HP heal
- 104004 Strength — Type4 friendly buff
- 104008 Tiny Restore — Type3 positive duration HP effect

Primary provenance:

- `Open-KO/KnightOnline@7d6cf81093e142c928c2ac9510512b2b182178b5`
- `Open-KO/ko-client-assets@b4636332c7cd818b0ce171eccc973dd3d6b2e56d`
- WS31 skill catalog is corroborating project data, not a substitute for the source table/parser evidence.

## Skill lifecycle

Verified/implemented:

- main-table loader + typed Type1..4 adapters
- base-level vs class/skill-point requirement derived from `Skill % 10`
- MP/SP abstraction and HP-cost boundary
- required weapon/item-class gate (Open-KO `dwNeedItem` semantics; 0/9 unrestricted)
- consumable item validation / Type2 arrow count
- simple verified moral target classes
- authoritative range port
- client cast/recast metadata parsing
- duplicate skill request rejection
- optional server-authoritative cooldown policy
- Type1/Type2 verified PvP physical damage core
- Type3 direct HP heal
- Type3 direct HP damage only through resistance-aware magic damage port
- Type3 two-second duration scheduling
- Type4 friendly same-BuffType non-stacking state
- duration expiration and cancel/death cleanup
- deterministic multi-effect ordering
- client-facing 1298 magic-process result adapter

## Protocol

`WIZ_MAGIC_PROCESS` payload after the opcode is modeled as 21 bytes:

- command: byte
- skill id: uint32
- source id: int16
- target id: int16
- six int16 data fields

Verified commands modeled:

1. CASTING
2. FLYING
3. EFFECTING
4. FAIL
5. DURATION_EXPIRED
6. CANCEL

## Integration ports

- WS15-shaped authoritative world/position port
- WS17-shaped equipment combat snapshot port
- WS25-shaped mob combat port returning absolute authoritative target HP + death event
- generic player combat port
- WS27 remains owner of progression/XP/respawn consequences after WS19 death event

## Fail-closed / UNKNOWN

Not presented as production-verified behavior:

- Type5..Type10 execution semantics
- Type3 DirectType 2/3/4 full production execution
- Type3 elemental/resistance formula without magic damage adapter
- hostile Type4 debuff replacement/stacking rules
- area/corpse/undead target selection semantics
- exact server-authoritative skill cooldown policy
- server enforcement of client cast-time field
- persistence of cooldowns across reconnect/restart
- exact item elemental / drain / armor absorption formulas until WS17 provides verified adapters
- NPC/mob physical skill damage equivalence to PvP Type1/Type2; current verified policy is explicitly PvP

## Blockers

No blocker for merging the combat core itself. Full production behavior for the UNKNOWN items depends on verified source/data or upstream adapters from WS15/WS17/WS25/WS27/WS31 rather than guessed constants.
