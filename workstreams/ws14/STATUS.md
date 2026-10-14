WS14

# STATUS — Generic KO 1298 Multi-Zone World Session

DURUM: **MULTI-ZONE READY + MORADON HEIGHT AUTHORITY READY**

Branch: `ws14-world-session`
Multi-zone implementation commit: `40c748d72b3f5ccf13bbb5aace7abcae05fd25be`
Multi-zone implementation CI: Actions run `38521440351`, job `115711809894` — **SUCCESS**
Moradon height authority implementation/test commit: `810a58f1bd71037597b896eac32d0139a463d227`
Moradon height authority CI: Actions run `38576683261`, job `115895542974` — **SUCCESS (46/46)**

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
- server-side authoritative 1298 SMD terrain/shape height provider added without changing WS16 or WS25.

## Moradon height authority

### Source and asset identity

WS31 zone 21 binds Moradon to server map `moradon_0826.smd` and client `Moradon_xmas.*` assets.

The production authority is pinned to:

- repository: `Open-KO/KnightOnline`
- commit: `7d6cf81093e142c928c2ac9510512b2b182178b5`
- asset: `assets/Server/MAP/moradon_0826.smd`
- Git blob SHA-1: `cf47772b8e42a8bad71032419f47978c8bbd6142`
- byte length: `786000`

`createMoradonHeightResolver()` validates the real SMD byte length and Git blob identity before accepting it. A missing, changed or unparsable asset returns `unresolved`; no fake height is emitted.

### Parser and exact source behavior

`services/ko1298-world/src/smd-height-resolver.js` parses the same leading sections that the 1.298 server map loader consumes:

1. terrain `mapSize` + `unitDist`;
2. `mapSize * mapSize` float height matrix;
3. shape map width/length;
4. collision face vertices;
5. 16m main-cell / 4m sub-cell collision index data.

Terrain interpolation follows `C3DMap::GetHeight()` parity/triangle math.

Shape intersection follows the pinned `CN3ShapeMgr` vertical ray behavior (`Y=5000`, direction down, source back-face rule). Two source-faithful modes are exposed:

- `resolveHeight(zoneId, x, z)` uses the exact X/Z-only client policy proven by the 1.298 `WIZ_WARP` handler: terrain height vs highest shape height, return the higher surface.
- `resolveHeight(zoneId, x, z, { yHint })` preserves the server `C3DMap::GetHeight(x,y,z)` nearest-shape-to-Y behavior, then uses shape only when it is above terrain.

The no-Y path does **not** invent a Y seed.

### Public API and result contract

```js
const {
  HEIGHT_STATUS,
  createMoradonHeightResolver,
} = require('../../services/ko1298-world');

const heights = createMoradonHeightResolver({ smdPath });
const result = heights.resolveHeight(21, x, z);
```

Result states are explicit:

- `{ status: 'authoritative', height, surface, terrainHeight, shapeHeight, policy, zoneId }`
- `{ status: 'unresolved', reason, zoneId, ... }`
- `{ status: 'invalid', reason, zoneId, ... }`

Unknown zone / invalid coordinate / outside-map are not coerced to zero. Known zones without a configured verified map asset remain `unresolved`. The generic `SmdHeightResolver` accepts per-zone assets and keeps a deterministic read-only parsed-map cache; no gameplay state is stored in it.

### Moradon acceptance coverage

Pinned provider composition used by CI:

- WS16 NPC provider: `234657c1264ead6b8828425ae9e7fcdca0cca5c8`
- WS25 mob provider: `a42b489e1a17d7c2889cfd92909ddd45c65e825e`
- OpenKO SMD authority: `7d6cf81093e142c928c2ac9510512b2b182178b5`

Coverage on the real `moradon_0826.smd`:

- WS16 source-anchored Moradon NPC groups: **37 / 37 authoritative**, `0 unresolved`, `0 invalid`.
- WS25 verified Moradon spawn rows: **20 rows**; 4 rectangle corners + center sampled for every row = **100 / 100 authoritative**, `0 unresolved`, `0 invalid`.
- deterministic repeat query: PASS.
- invalid zone: PASS / fail closed.
- out-of-bounds: PASS / fail closed.
- changed SMD identity: PASS / fail closed, no height fallback.

### WS16 handoff

WS16 keeps NPC identity/data/runtime ownership. It must obtain Y from the WS14 authority before materializing its verified X/Z anchor:

```js
const resolved = heights.resolveHeight(spawn.zoneId, spawn.anchor.x, spawn.anchor.z);
if (resolved.status !== HEIGHT_STATUS.AUTHORITATIVE) {
  // fail closed: do not spawn with y=0 or another substitute
}
const y = resolved.height;
```

WS14 does not modify WS16 and does not own NPC lifecycle or packets.

### WS25 handoff

WS25 keeps monster spawn/AI ownership. Any selected X/Z point inside a verified spawn rectangle must be passed to the same WS14 authority before the mob is materialized. A non-authoritative result must reject/defer that spawn; there is no constant or guessed Y fallback.

WS14 does not modify WS25 and does not own mob lifecycle/AI.

### WS11 wire alignment

WS14 returns world-unit float coordinates. WS11 1.298 evidence establishes packet position representation as:

- X: `uint16`, world coordinate multiplied by 10 on write / divided by 10 on client read;
- Z: `uint16`, same `0.1` unit scale;
- Y where carried by the packet: `int16`, same `0.1` unit scale.

The real NPC and mob acceptance batches assert that resolved Moradon X/Z/Y values remain representable by those wire widths. Packet serialization remains outside this resolver.

## Moradon regression

Preserved exact bytes include:

- select `040115300cb40f000000`
- same-zone teleport `27031500300cb40f000000`
- empty-target loading response `150000`, `1c0000`, `2702`

The pre-existing tests were not replaced or relaxed. Canonical genuine browser proof remains WS10 run #26 (`38505039290`) with `MORADON E2E: PASS`.

## Verified zones

WS31 identities in catalog: `1, 2, 11, 12, 21, 30, 31, 32, 33, 48, 55, 101, 102, 103, 111, 201`.

Built-in production entry currently enabled only for **21 Moradon**, because it has aligned spawn/map/protocol ability evidence required by WS14. `SmdHeightResolver` remains generic, but only Moradon's server SMD is pinned/configured by this task; other zones remain fail-closed until their map assets are similarly pinned.

## Explicit unknown / blocked data

- No WS06 branch / independent server-height authority was found; Moradon authority is instead grounded in WS31's server-map binding plus the pinned OpenKO server/client parser behavior and exact SMD asset.
- zone 1 Karus: map/spawn source-backed, but final production entry/ability/rule composition not pinned in WS14;
- zone 2 El Morad: pinned DB `InitX` converts to `16300.0`, outside 1298 `u16` tenths coordinate representation; marked `DATA_CONFLICT`, not corrected by guess;
- zones 11/12 and other mapped zones: identity/map/spawn can be source-backed but runtime entry/ability rules remain pending;
- zone 31 Bifrost: no matching pinned OpenKO-db row in the WS14 source snapshot;
- zone 55: WS31 identity says Caitharos Arena while pinned OpenKO-db row says Forgotten Temple; marked `DATA_CONFLICT`;
- battle/invasion zones require WS24 runtime state and therefore remain fail-closed in the built-in registry.

## Test evidence

Workflow: `.github/workflows/ws14-world.yml`

Height authority run: `38576683261`
Job: `115895542974`
Conclusion: **SUCCESS**

Final test composition at height-authority commit:

- total: **46 tests**;
- pass: **46**;
- fail: **0**;
- includes real pinned SMD parse and identity check;
- includes all WS16 source-anchored Moradon NPC positions;
- includes 100 WS25 rectangle sample positions;
- includes bounds, invalid zone, deterministic cache/query and no-guessed-fallback cases;
- preserves the previous multi-zone/world-session suite, including 120-session transition load coverage.

## Boundary

No combat implementation, movement algorithm, NPC lifecycle/packet implementation, mob AI, inventory logic, DB migration, or client change was added. WS14 owns only the world/session boundary plus the new authoritative read-only map-height provider.
