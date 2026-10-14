# WS16

## Production integration contract

WS16 owns NPC identity, verified Moradon population data, runtime NPC lifecycle/visibility and the validation boundary for NPC interaction. It does **not** copy WS14 world-session, WS22 economy, WS23 quest, WS33 Inn Storage, movement, inventory or combat business logic.

## Verified Moradon dataset

`world-data/npc/moradon.json` is the machine-readable source of truth for this branch.

- 31 unique `K_NPC` templates are cross-joined with Moradon (`ZoneID=21`) static `K_NPCPOS` rows.
- 39 verified static spawn groups are catalogued.
- Their `K_NPCPOS.NumNPC` total is 43.
- 37 groups have a source-verifiable path anchor and can be materialized without inventing X/Z.
- `16082` and `16083` have source rows with rectangles but no path point; they remain catalogued but are not materialized at an invented coordinate.
- Runtime `instanceId` is allocated from the verified NPC band `10000..29999`; it is runtime identity, not a source template/spawn ID.

The catalog pins Open-KO/OpenKO-db commit `bec619466938d278339c30e5b1a4bff3c9413bab` at top level and every template/spawn carries its exact `sourceRow`, so provenance is record-addressable without repeating the full source URL in every row.

## Terrain Y port

`K_NPCPOS` has no Y coordinate. The 1.298 client resolves world height from terrain and world-shape height. WS16 therefore keeps Y out of the seed and requires an injected resolver:

```js
const {
  createTerrainHeightResolver,
  resolveNpcData,
} = require('../../services/ko1298-npc');

const terrainY = createTerrainHeightResolver({
  terrainHeight: ({ zoneId, x, z }) => zoneTerrain.heightAt(zoneId, x, z),
  shapeHeight: ({ zoneId, x, z }) => zoneShapes.heightAt(zoneId, x, z),
});

const npcs = resolveNpcData(doc, { terrainY });
```

The resolver returns the higher finite terrain/shape height, matching the verified client policy. If neither source resolves, materialization fails closed; WS16 does not write fake `y=0` data.

## WS14 world/session integration

Create one `NpcWorld` for the authoritative world process and load resolved NPCs. WS14's repository-facing `getSurroundingNpcs({ zoneId, x, z })` can delegate to:

```js
npcWorld.nearby(zoneId, x, z)
```

On region crossing, use `router.regionSync({ zoneId, x, z }, previousNpcIds)`. It returns deterministic `enter`, `stay`, `leave`, current `ids`, `WIZ_NPC_REGION`, IN packets and OUT packets without taking ownership of WS15 movement.

Spawn/despawn/reload lifecycle lives in `NpcWorld`:

```text
spawn(npc)
despawn(instanceId)
reloadZone(zoneId, npcs) -> { spawned, despawned, updated, unchanged }
regionDelta(zoneId, x, z, previousIds)
```

`reloadZone()` rejects runtime-ID duplication and is idempotent for an unchanged dataset.

## Interaction validation boundary

`NpcInteractionRouter` validates authoritative NPC existence, session zone, enabled/dead runtime state and distance **before** any gameplay handoff.

The exact 1.298 server interaction-distance constant is still unverified. Production composition must therefore inject `interactionRange` or `interactionPolicy`. With neither configured, NPC interaction fails closed with `range-policy-unconfigured`; WS16 never invents a distance constant.

All successful handoffs use one result envelope:

```text
{
  kind: 'npc-interaction',
  status: 'handled',
  route: 'merchant' | 'quest' | 'inn' | 'world',
  instanceId,
  templateSid,
  result
}
```

## WS22 merchant port

Verified shop templates with source `sellingGroup > 0` are marked `interactionRoute: merchant` and `interactionVerified: true`. Inject:

```js
merchant: ({ session, npc, action }) => ws22Adapter.openNpcMerchant({ session, npc, action })
```

For WS22's `assertInteraction({ playerId, npcId, tx })` adapter, resolve the authoritative session for `playerId` and call WS16 `router.assertInteraction({ session, npcId })` before WS22 price/item work. Price/item ownership remains WS22/WS17.

## WS33 Inn port

`K_NPC` SID `12000`, `Inn hostess`, byType `31`, is verified in Moradon and marked `interactionRoute: inn`, `interactionVerified: true`.

Inject the WS33 handler only at this port:

```js
inn: createInnHostessHandler({ service: innStorage })
```

WS16 does not mutate storage.

## WS23 quest/event port

WS16 exposes a `quest` port, but source-visible names/byType values alone are not enough to claim exact 1.298 EVT semantics. Quest/event candidates remain spawned and targetable, but are marked `interactionVerified: false` until EVT/server behavior supplies the action mapping. They fail closed with `interaction-unverified` instead of being mislabeled as production quest logic.

Once verified, composition may enable that route and translate WS16's authoritative `templateSid` + verified action into WS23's `questRouter.route(...)` contract.

## WS14 gate/warp port

`SID 15002` is source-verified as `Aban[Battlefield Gate-keeper]`, byType `136`. WS16 exposes the `worldTransition` port but does not invent a destination or event. Its seed route remains `interactionVerified: false` until source evidence identifies the 1.298 transition action/destination. When verified, the port hands off to WS14; WS16 itself never changes zone state.

## Packet ownership

WS16 handles only the NPC-side 1.298 packets implemented here:

- `0x0A WIZ_NPC_INOUT`
- `0x1C WIZ_NPC_REGION`
- `0x1D WIZ_REQ_NPCIN`
- `0x20 WIZ_NPC_EVENT`
- `0x22 WIZ_TARGET_HP`

Malformed `0x1D/0x20/0x22` payloads are rejected without throwing through the session dispatcher. Detail and target responses are zone-scoped.
