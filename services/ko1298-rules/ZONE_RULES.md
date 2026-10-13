# OldKO 1298 Nation / PvP / Zone Rules

## Scope

This service is an isolated decision domain for OldKO's 1298-era nation and PvP rules. It does not own combat, movement, world sessions, map geometry, event scheduling, persistence, or client behavior. Those services provide runtime facts and consume the decisions exposed by `IZoneRules`.

## Historical baseline

The rule set is intentionally conservative and follows the project's 1298/9 compatibility target.

Verified 1298-era facts used by the implementation:

- Nation values are Karus `1` and El Morad `2`.
- Core zone IDs used here: Karus `1`, El Morad `2`, Karus Eslant `11`, El Morad Eslant `12`, Moradon `21`, Arena `48`, battle zones `101/102/103`, Snow Battle `111`.
- Moradon is neutral: both nations can coexist there; normal nation hostility does not make players attackable there.
- The historic zone-ability model distinguishes neutral zones from PvP zones.
- Arena behavior is an explicit exception where same-nation players can be PvP targets.
- Coordinate/region safety is separate from zone identity. A caller supplies `in_safe_area`; WS24 does not duplicate map geometry.
- The verified invasion scope is limited to nation home maps `1/2`; Eslant `11/12` remains nation-locked. No custom/common-Eslant behavior is inferred.

Primary references reviewed:

1. OpenKO / old-school-openko project README: project goal explicitly targets 1298/9 and rejects later-version behavior while compatibility work is in progress.
2. Open-KO `src/shared/globals.h`: nation/zone constants and neutral/PvP zone ability semantics.
3. Historical server behavior in `GameServerDlg.cpp`: Moradon is explicitly treated as the neutral zone where nation does not restrict party discovery.
4. Historical magic targeting logic: hostility is not nation-only; arena/PvP/safety context changes target legality.

## Rule table

| Zone | ID | Entry | Player hostility | Zone-wide safe | NP eligibility |
|---|---:|---|---|---|---|
| Karus home | 1 | Karus; enemy only during invasion | Opposite nations only during invasion | No (safety is runtime state) | Eligible during legal invasion |
| El Morad home | 2 | El Morad; enemy only during invasion | Opposite nations only during invasion | No (safety is runtime state) | Eligible during legal invasion |
| Karus Eslant | 11 | Karus only | No player-vs-player nation hostility | No (entry is nation-locked, not a safety flag) | No |
| El Morad Eslant | 12 | El Morad only | No player-vs-player nation hostility | No (entry is nation-locked, not a safety flag) | No |
| Moradon | 21 | Both nations | Neutral | Yes | No |
| Arena | 48 | Both nations | All valid players, including same nation | No | No |
| Battle 1/2/3 | 101/102/103 | Only while battle is open | Opposite nations | No; local safe-area bit still applies | Yes, eligibility only |
| Snow Battle | 111 | Only while battle is open | Opposite nations | No; local safe-area bit still applies | Yes, eligibility only |

## Deliberately not inferred

The 1298-family source tree also contains constants for Delos, Bifrost, Abyss and other maps. WS24 does **not** invent event state, siege ownership, minimum-level requirements, warp destinations, NP amounts, or map-coordinate safe areas for those systems. Unsupported zones return `UnsupportedZone` until their 1298 rule contract is separately verified and integrated.

Later KO-only zones and systems (for example Ronark Land, Ardream, Border Defense War, Chaos/Juraid-era rules) are intentionally absent.

## Public decision API

`IZoneRules` exposes:

- `CanAttack(context, state)`
- `CanEnterZone(nation, zone, state)`
- `IsSafeZone(zone)`
- `AreHostile(lhs, rhs, zone, state)`
- `GetDeathRule(nation, zone, state)`
- `GetNPContributionRule(context, state)`

### Integration contract

Combat supplies attacker/target nation, zone and local safe-area state. World supplies current battle/invasion flags and asks entry eligibility before committing a transition. WS24 returns decisions only; it never mutates either service.

`GetNPContributionRule()` returns **eligibility**, not an NP amount. NP formulas/rewards remain outside this domain. `GetDeathRule()` returns a respawn policy hint, not coordinates; world owns bind/start-position resolution.
