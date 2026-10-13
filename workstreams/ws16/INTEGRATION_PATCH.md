# WS16

## Integration patch contract

WS16 does not modify WS14 world-session, WS15 movement, client, gateway, inventory or combat code. The integration point is intentionally narrow.

### Load verified NPC data

```js
const fs = require('node:fs');
const { NpcWorld, NpcInteractionRouter, resolveNpcData, encodeNpcIn, encodeNpcOut } = require('../../services/ko1298-npc');
const doc = JSON.parse(fs.readFileSync('world-data/npc/moradon.json', 'utf8'));
const world = new NpcWorld();
for (const npc of resolveNpcData(doc, {
  terrainY: ({ zoneId, x, z }) => worldSessionTerrainHeight(zoneId, x, z),
})) world.add(npc);
```

`worldSessionTerrainHeight()` is an integration placeholder name. WS14/zone ownership must provide the real map height for zone 21.

### Character enters Moradon

After the selected character has zone id and position, create the router and send `router.nearbyPacket({ zoneId, x, z })`. The client then requests unknown ids with `WIZ_REQ_NPCIN (0x1D)`.

### Route WS16 opcodes only

Feed opcodes `0x1D`, `0x20` and `0x22` to `router.route(packet, session)`. If it returns `kind: 'packets'`, write each returned packet to the existing game-session socket. Do not move login/version/nation/character/world-session ownership into WS16.

### Spawn/despawn broadcast hooks

For a static NPC becoming visible, broadcast `encodeNpcIn(npc)` to sessions whose 3x3 visibility region contains it. For removal, broadcast `encodeNpcOut(instanceId)` before removing it from `NpcWorld`. The session registry/broadcast loop belongs to world/session integration and is intentionally not implemented here.

### Movement handoff

When WS15 changes a player's region, recompute `world.nearby(zoneId, x, z)` and diff against that session's prior visible NPC ids. Added ids use `encodeNpcIn()` or the region-id/request flow; removed ids use `encodeNpcOut()`. WS16 does not change movement or teleport logic.

### Merchant and quest boundaries

`merchantInterface({ session, npc })` receives `sellingGroup` (203002 for Caspy) and hands off to the future merchant/inventory owner. `questInterface({ session, npc })` is the boundary for quest/talk logic. WS16 mutates neither inventory nor quest state.

### First visual acceptance target

1. Real 1298 client enters zone 21.
2. Session position is close enough to Caspy's region.
3. Server sends `WIZ_NPC_REGION`.
4. Client requests runtime id 10000 via `WIZ_REQ_NPCIN`.
5. WS16 sends Caspy using `sPid=22000`.
6. Real client resolves its own 1298 model asset and renders the NPC.
7. Clicking the NPC emits `WIZ_NPC_EVENT 0x20 + 10000` and routes to merchant interface.

No client patch, Three.js entity, fake screenshot or guessed model id is part of this path.
