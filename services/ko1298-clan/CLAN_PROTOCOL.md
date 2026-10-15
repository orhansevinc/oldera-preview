# OldKO 1298 Clan / Knights protocol notes

Status: **verified reference notes, not a packet implementation**.

Primary reference inspected: `ko4life-net/ko` commit `e2028240c7cfc011264cdecbd91baee4e3cdeb29`, especially `src/game/PacketDef.h`, `src/game/GameDef.h`, `src/server/Ebenezer/Knights.h`, `GameDefine.h`, `KnightsManager.cpp`, and `EbenezerDlg.cpp`.

## Verified packet family

The 1298 client defines `N3_KNIGHTS = 0x3C`. Verified sub-operations are:

| Operation | Value |
| --- | ---: |
| create | `0x01` |
| join/invite flow | `0x02` |
| withdraw | `0x03` |
| remove member | `0x04` |
| destroy | `0x05` |
| member join admit | `0x06` |
| member join reject | `0x07` |
| punish | `0x08` |
| appoint chief | `0x09` |
| appoint vice-chief | `0x0A` |
| appoint officer | `0x0B` |
| grade/rank change | `0x0C` |
| all member info | `0x0D` |
| online member info | `0x0E` |
| clan stash | `0x0F` |
| duty change | `0x10` |
| join request | `0x11` |

`N3_KNIGHTS_LIST_BASIC = 0x3E` is a separate basic clan-list packet family.

WS21 does not serialize these packets. They are documented so the protocol/session workstream can bind the domain without guessing.

## Duties / roles

The 1298 client duty enum is:

| Duty | Client value |
| --- | ---: |
| unknown | 0 |
| chief | 1 |
| vice-chief | 2 |
| punish | 3 |
| trainee | 4 |
| knight/member | 5 |
| officer | 6 |

The server also uses an authority/fame ordering where officer and above have stronger rights. The verified behavior used by WS21 is narrower and operation-based:

- invite target: client command path allows **chief or vice-chief**;
- kick/remove: **chief only** in the server manager path;
- punish: **vice-chief or chief**;
- appoint chief / vice-chief / officer: **chief only**.

The source data model has three vice-chief name slots for the base clan layout. No alliance/modern clan hierarchy is added here.

## Nation and clan ID ranges

Verified nation values:

- Karus = `1`
- El Morad = `2`

The 1298 server allocates clan IDs by nation:

- Karus: `1..14999`
- El Morad: `15001..30000`

The server starts the El Morad scan from 15000 and increments before use, therefore 15001 is the first normal allocation.

## Creation constraints

Verified in `CKnightsManager::CreateKnights`:

- creator must not already be in a clan;
- minimum level: **20**;
- code checks at least **500,000 Noah** (the nearby Korean comment says 5,000,000, but the executable comparison is 500,000; WS21 follows the code, not the stale comment);
- duplicate clan names are compared case-insensitively;
- server character/name buffer is `MAX_ID_SIZE = 30`.

WS21 additionally rejects embedded control/NUL characters as a C-string safety invariant. This is hardening, not claimed as a historical gameplay rule.

## Membership capacity

`MAX_CLAN = 24` and the clan object contains a fixed 24-entry member array. A join-time `>= 24` guard is present in the reference manager but commented out. WS21 enforces **24 members** to respect the underlying 1298 storage model and avoid overflow/inconsistent state.

## Invite / accept / reject

The reference server's join path targets an online socket, checks target alive state, nation equality, and existing clan membership, then sends a join request. The target reply either rejects or continues the persistent join operation.

WS21 models invitations as **runtime-only state** (not DB-persistent), because the historical flow is session-oriented. No arbitrary TTL is invented. Disconnect/session integration should call `clearInvitesForCharacter()`.

## Leave / disband

The reference withdraw path turns a chief's withdrawal into clan destruction. WS21 mirrors this: `leave()` by a chief delegates to `disband()`.

## Grade and ranking

New clans initialize at grade **5** and ranking **0**.

The verified grade calculation is:

```text
clanPoints = floor(totalNationalPoints / 24)
0..1999      => grade 5
2000..4999   => grade 4
5000..9999   => grade 3
10000..19999 => grade 2
20000+       => grade 1
```

Ranking is stored separately and is populated by another server ranking path. WS21 exposes `applyRanking()` but intentionally does **not** invent a ranking formula.

## Battle-zone restriction

The historical manager rejects several clan operations when its internal `m_bZone > 2`. That numeric assumption is not copied into WS21 because the browser project uses the 1298 world/session workstreams and Moradon/zone normalization must be verified there first. See `workstreams/ws21/INTEGRATION_PATCH.md`.
