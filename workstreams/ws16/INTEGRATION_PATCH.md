# WS16

## Production integration contract

WS16 owns NPC identity, verified Moradon NPC population semantics, runtime NPC lifecycle/visibility gating and NPC interaction validation. It does **not** copy WS14 terrain/world logic, write new packet layouts, own WS11 protocol authority, or absorb economy/quest/inn/movement/combat logic.

## Required providers

Composition must pin and provide all three dependencies:

- `terrain.height-authority` — WS14 public `resolveHeight(zoneId, x, z)` provider.
- `protocol NPC visibility profile` — WS11 authority for `WIZ_NPC_REGION`, `WIZ_REQ_NPCIN` and `WIZ_NPC_INOUT`.
- `data WS31 NPC catalog` — verified KO 1298 NPC identity/data authority.

Current verified dependency snapshot used by WS16 CI:

- WS14: `9b82adefb05a3cca32f430e25f8a1d9109db93b2`
- WS11: `944b6ff9b6329af29f1048a74aa6e14fca141639`
- WS31: `546d2ab62cd46a97f3385ebcddbe0c775a02c2eb`

WS50-C3 is immutable and must not be edited. Its historical `WORLD_TERRAIN_HEIGHT_AUTHORITY` / `NPC_REGION_BODY_AUTHORITY` blockers refer to older provider SHAs; a successor candidate should replace the WS16 provider SHA and pin the resolved authorities above.

## Verified Moradon dataset

`world-data/npc/moradon.json` preserves the existing source-backed population contract:

- 31 unique `K_NPC` templates;
- 39 verified static spawn groups;
- source-declared population 43;
- 37 groups with source-verifiable X/Z path anchors;
- two catalog-only groups (`16082`, `16083`) with no source path point.

No Y value is stored in or accepted from the seed. No extra `NumNPC` member is cloned onto a guessed coordinate.

## Terrain height port

WS16 now consumes WS14 instead of reproducing its terrain/shape policy:

```js
const { createMoradonHeightResolver } = require('services/ko1298-world'); // WS14 provider
const { materializeNpcPopulation, NpcWorld } = require('services/ko1298-npc');

const heightAuthority = createMoradonHeightResolver({ smdPath });
const population = materializeNpcPopulation(moradonNpcCatalog, { heightAuthority });

const npcWorld = new NpcWorld();
npcWorld.reloadZone(21, [...population.records]);
```

The only accepted provider contract is:

```text
resolveHeight(zoneId, x, z) -> { status: "authoritative", height: finiteNumber, ... }
```

Any missing/invalid/unresolved result fails closed before materialization is returned. `NpcWorld` checks the authority metadata again before publishing spawn visibility.

## Identity and packet-ready semantic records

Runtime records keep identities separate:

```text
templateSid                 source NPC template ID
sourceInstanceKey           source K_NPCPOS spawn-group key
instanceId / runtimeId      runtime/network NPC ID
```

The record and snapshot APIs carry authoritative `position { zoneId, x, y, z }` plus `positionAuthority`.

Use:

```text
detailSnapshot(instanceId)
nearbySnapshot(zoneId, x, z)
regionDeltaSnapshot(zoneId, x, z, previousIds)
```

These are semantic structures, not a new packet encoder. Existing encoder code is left unchanged; protocol layout authority remains WS11.

## Region and lifecycle integration

WS14/WS15 may continue to use `nearby()` / `regionDelta()` after authoritative movement/region changes. Those legacy domain records are now safe because `NpcWorld` refuses unauthoritative position records.

`setState()` may update runtime state such as HP/enabled/dead, but cannot mutate template identity, runtime identity, source instance identity, zone or authoritative X/Y/Z.

## Real acceptance test

WS16 CI checks out the exact WS14 provider and exact Open-KO Moradon SMD used by WS14 acceptance, then runs WS16 materialization across every source-backed anchor. The test verifies:

- 31 templates / 39 spawn groups / declared population 43 remain unchanged;
- all 37 source anchors resolve to authoritative finite Y through WS14;
- the two no-anchor groups remain non-visible rather than guessed;
- WS31 Caspy identity/provenance still matches;
- detail/nearby semantic snapshots expose authoritative X/Y/Z.

No product packet layout is added by this integration.
