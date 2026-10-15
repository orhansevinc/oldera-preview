# WS19 Verified 1298 Skill Evidence

## Provenance pins

Server behavior source:

- `Open-KO/KnightOnline@7d6cf81093e142c928c2ac9510512b2b182178b5`
- `src/Server/Ebenezer/MagicProcess.cpp`
- `src/Server/Ebenezer/User.cpp`
- client structures/parsers under `src/Client/WarFare`

1298 table rows:

- `Open-KO/ko-client-assets@b4636332c7cd818b0ce171eccc973dd3d6b2e56d`
- `Data/Skill_Magic_Main_us.tbl.csv`
- `Data/Skill_Magic_1.tbl.csv`
- `Data/Skill_Magic_2.tbl.csv`
- `Data/skill_magic_3.tbl.csv`
- `Data/skill_magic_4.tbl.csv`

The project WS31 skill catalog was reviewed as corroboration. Production behavior is only marked verified where table data and parser/server behavior agree.

## Verified table shapes

| Table | Columns | WS19 status |
| --- | ---: | --- |
| Main | 30 | strict parser |
| Type1 | 12 | strict parser |
| Type2 | 6 | strict parser |
| Type3 | 7 | strict parser |
| Type4 | 26 | strict parser |

No Type5..Type10 table behavior is claimed by this workstream revision.

## Golden representative skills

| Skill | ID | Main type | Verified behavior exercised |
| --- | ---: | ---: | --- |
| Slash | 101003 | Type1 | source Type1 row; PvP relative hit + physical damage core |
| Archery | 102003 | Type2 | source Type2 row; relative hit + physical damage core + one arrow |
| Flash | 103001 | Type3 | DirectType 1, -24 initial HP damage; magic damage port required |
| Tiny Healing | 104001 | Type3 | DirectType 1, +15 HP heal |
| Strength | 104004 | Type4 | BuffType 7, 300 sec, +15 STR; friendly same-BuffType non-stack |
| Tiny Restore | 104008 | Type3 | +50 HP over 20 sec, two-second source tick interval |

These rows live in `GOLDEN_VERIFIED_1298`. Synthetic test skills live behind `InMemorySkillTableAdapter` and are explicitly tagged `SYNTHETIC_TEST_ONLY`.

## Verified main-table semantics used by WS19

- moral / target category
- required level and required skill code
- MP/SP cost and HP cost boundary
- required item class
- exhausted item id
- cast time field
- recast time field
- Type1 and Type2 selector columns
- range

Client recast conversion is 100 ms per table unit. WS19 does **not** reinterpret this client field as proof of server cooldown enforcement.

## Verified Type1 semantics used

Type1 row fields used by the production adapter:

- Type
- HitRateMod
- DamageMod

PvP source behavior used:

- Type != 0 → non-relative `HitRateMod > random(0..100)`
- Type == 0 → relative `(Attack/Avoid) * HitRateMod%`
- AC-based temp hit
- Type1 successful damage envelope
- item/magic stage adapter
- armor stage adapter
- final PvP `/3`

Other Type1 row fields are preserved in raw source data but are not generalized into production behavior without further source proof.

## Verified Type2 semantics used

Type2 row fields used:

- HitType
- HitRateMod
- AddDamage
- DamageMod
- NeedArrow

PvP source behavior used:

- HitType 1/2 non-relative hit
- otherwise relative hit
- HitType 1 direct attack-power branch
- otherwise AC-based branch
- Type2 successful damage envelope
- AddDamage forwarded to verified magic/item adapter
- final PvP `/3`
- NeedArrow controls exhausted-item count

## Verified Type3 semantics used

Current production execution is deliberately limited to `DirectType == 1` HP behavior.

Verified:

- positive first damage heals HP
- negative first damage is damage
- duration interval is exactly 2 seconds
- total TimeDamage is divided across `Duration / 2` ticks
- effect is removed on duration expiration/death/cancel

For negative damage, WS19 requires an injected magic/resistance adapter. It does not guess the elemental resistance formula.

DirectType 2/3/4 are visible in source but remain UNKNOWN for full production integration in this revision.

## Verified Type4 semantics used

For friendly Type4 paths (`moral < 5` in the reviewed server branch):

- same active BuffType is rejected rather than stacked
- duration is authoritative table data
- modifiers are retained exactly
- expiration/cancel/death cleanup is deterministic

Hostile debuff replacement/stack rules are not generalized and fail closed.

## Verified magic-process protocol

After WIZ_MAGIC_PROCESS opcode:

- byte command
- uint32 skill id
- int16 source id
- int16 target id
- six int16 data fields

Total payload: 21 bytes.

Commands verified in source:

1. MAGIC_CASTING
2. MAGIC_FLYING
3. MAGIC_EFFECTING
4. MAGIC_FAIL
5. MAGIC_DURATION_EXPIRED
6. MAGIC_CANCEL

## UNKNOWN ledger

- Type5, Type6, Type7, Type8, Type9, Type10 full table + execution semantics
- Type3 DirectType 2/3/4 full ownership/integration semantics
- complete elemental/resistance and drain behavior in `GetMagicDamage`
- hostile Type4 stacking/replacement policy across all BuffTypes
- area target enumeration and corpse/undead target semantics
- authoritative server cooldown derived from skill data
- server-side cast-time gating matching the client field
- NPC/mob skill-damage equivalence to PvP policy
- cooldown persistence across reconnect/restart
