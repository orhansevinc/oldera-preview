WS14

# Integration Patch Guide

No WS03 file is modified by this branch. This document is the handoff contract for the future integration commit on the control/integration line.

## Dependency direction

WS03 -> WS14 is allowed at the orchestration boundary; WS14 must not depend on WS03 internals.

WS03 responsibilities before the handoff:

- authenticated game session exists;
- character selection request is protocol-valid;
- selected `characterId` belongs to authenticated `accountId`;
- the connection has a stable game-server `socketId`;
- duplicate/disallowed selection decisions are rejected before calling WS14.

WS14 responsibilities after validation:

- resolve world snapshot via `getCharacterForWorld(accountId, characterId)`;
- initialize Moradon zone/spawn;
- create the `WIZ_SEL_CHAR` success response containing world placement;
- run the 1298 GAMESTART two-phase state machine;
- serialize MYINFO/zone ability;
- initialize nearby user/NPC ID lists and detail replies;
- run the 1298 zone-change handshake;
- expose `WORLD_READY` only at the source-verified completion points.

## Suggested orchestration pseudocode

```js
const {
  WorldSessionService,
  ProductionWorldRepository,
} = require('../ko1298-world');

const world = new WorldSessionService({
  repository: new ProductionWorldRepository(/* existing persistence adapter */),
});

// After WS03 validates the authenticated selection request:
const started = await world.beginSelectedCharacter({
  accountId: authenticated.accountId,
  characterId: selectedCharacterId,
  socketId: connection.socketId,
});

for (const packet of started.clientPackets) connection.send(packet);

// For world-session opcodes only:
const outcome = await world.handleClientPacket(connection.socketId, payload);
for (const packet of outcome.clientPackets) connection.send(packet);
for (const packet of outcome.broadcastPackets) regionBroadcaster.send(outcome.snapshot.zoneId, packet);
```

`ProductionWorldRepository` is illustrative: WS14 intentionally ships a `MockWorldRepository` and a repository contract, not a database migration or persistence implementation.

## Routing ownership

The integration router should hand only these world-session opcodes to WS14:

- `0x0D` GAMESTART
- `0x16` request user details
- `0x1D` request NPC details
- `0x27` zone-change phase

Movement, attack, item movement and other gameplay packets must continue to their own future/owning components. WS14 tests intentionally reject them.

## Important 1298 integration note

Do not adapt a legacy GAMESTART request shaped as `[0x0D][nameLength][characterName]` to WS14. The verified 1298 client sends `[0x0D][0x01]`, receives server `[0x0D]`, and then sends `[0x0D][0x02]`.

Similarly, do not treat `WIZ_ZONE_CHANGE` as an opcode-only acknowledgement. 1298 uses explicit LOADING/LOADED phase bytes.

## Current integration condition

At preparation time, branch `ws03-ko1298-session` was still at the same commit as `main` and did not yet expose a committed integration surface under `services/ko1298-session/**`. Therefore WS14 is self-contained and fully tested, while actual WS03 wiring is intentionally left for the integration/control line after WS03 publishes its service contract.
