WS14

# STATUS — Generic KO 1298 Multi-Zone World Session

DURUM: **MULTI-ZONE READY (infrastructure); per-zone entry remains fail-closed until verified data/rules are complete**

Branch: `ws14-world-session`
Implementation commit: `40c748d72b3f5ccf13bbb5aace7abcae05fd25be`
Implementation CI: Actions run `38521440351`, job `115711809894` — **SUCCESS**

## Completed

- Moradon-specific assumptions catalogued.
- Immutable `ZoneDefinition` + deterministic `ZoneRuntime` + `ZoneRegistry` added.
- 16 WS31-verified zone IDs are data-driven in `services/ko1298-world/data/zones.1298.json`.
- Unknown and incomplete zones fail closed; no guessed Karus/El Morad coordinates/rules were introduced.
- Moradon zone 21 spawn/packet behavior remains exact regression behavior.
- Transition audit state machine now records:
  `REQUESTED -> AUTHORIZED -> LEAVING_SOURCE -> TELEPORT -> LOADING -> LOADED -> WORLD_READY`.
- Concurrent transition request is deterministically rejected.
- Source membership removal and target membership insertion are ordered and transactional.
- Disconnect mid-transition cleans all touched runtime memberships.
- Target loading failure restores source membership, region subscription, position, and WS15 movement baseline.
- WS15 `registerSession/teleport/disconnect` adapter boundary added.
- Region subscribe/unsubscribe lifecycle added.
- Nearby bootstrap ordering fixed as USERS -> NPCS -> MOBS with WS25 packet/bootstrap port.
- Stale old-zone entity cleanup descriptor + source-zone USER_OUT broadcast contract added.
- movement/combat capability remains disabled until WORLD_READY.
- repository-authoritative reconnect restore added; no Moradon fallback.
- WS27-facing `planWorldReposition` added and preserves WARP/GATE/TELEPORT/RESPAWN intent.
- per-session ordered transition audit trail added.

## Moradon regression

Preserved exact bytes include:

- select `040115300cb40f000000`
- same-zone teleport `27031500300cb40f000000`
- empty-target loading response `150000`, `1c0000`, `2702`

The pre-existing 14 tests were not replaced or relaxed. Canonical genuine browser proof remains WS10 run #26 (`38505039290`) with `MORADON E2E: PASS`.

## Verified zones

WS31 identities in catalog: `1, 2, 11, 12, 21, 30, 31, 32, 33, 48, 55, 101, 102, 103, 111, 201`.

Built-in production entry currently enabled only for **21 Moradon**, because it has aligned spawn/map/protocol ability evidence required by WS14.

## Explicit unknown / blocked data

- zone 1 Karus: map/spawn source-backed, but final production entry/ability/rule composition not pinned in WS14;
- zone 2 El Morad: pinned DB `InitX` converts to `16300.0`, outside 1298 `u16` tenths coordinate representation; marked `DATA_CONFLICT`, not corrected by guess;
- zones 11/12 and other mapped zones: identity/map/spawn can be source-backed but runtime entry/ability rules remain pending;
- zone 31 Bifrost: no matching pinned OpenKO-db row in the WS14 source snapshot;
- zone 55: WS31 identity says Caitharos Arena while pinned OpenKO-db row says Forgotten Temple; marked `DATA_CONFLICT`;
- battle/invasion zones require WS24 runtime state and therefore remain fail-closed in the built-in registry.

## Test evidence

Workflow: `.github/workflows/ws14-world.yml`

Implementation run: `38521440351`
Job: `115711809894`
Conclusion: **SUCCESS**

Test composition:

- previous canonical WS14 suite: 14 tests;
- added multi-zone suite: 18 tests;
- total: 32 tests;
- synthetic load: 120 sessions, deterministic Moradon -> synthetic B -> Moradon, no runtime membership leak.

## Boundary

No combat implementation, movement algorithm, NPC AI, mob AI, inventory logic, DB migration, or client change was added.
