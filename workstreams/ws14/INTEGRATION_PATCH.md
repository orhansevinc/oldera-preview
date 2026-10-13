WS14

# Integration Patch Guide

No WS03 file is modified by this branch. This document is the handoff contract for the future integration commit on the control/integration line.

## Dependency direction

WS03 -> WS14 is allowed at the orchestration boundary; WS14 must not depend on WS03 internals.

WS03 responsibilities before the handoff:

- authenticated game session exists;
- character selection request is protocol-valid;
- selected `characterId` belongs to authenticated `accountId`;
- the connection has a stable game-server `socketId` that fits uint16;
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

## Exact WS03 -> WS14 contract after validated character selection

This is the authoritative call boundary for the Moradon critical path. WS03 calls it **after validating** `WIZ_SEL_CHAR`, but **before sending a competing success/world-placement response**:

```js
const {
  WorldSessionService,
} = require('../ko1298-world');

const started = await world.beginSelectedCharacter({
  accountId: authenticated.accountId,
  characterId: selectedCharacterId,
  socketId: connection.socketId,
});

for (const packet of started.clientPackets) {
  connection.send(packet);
}
```

Required inputs:

```text
accountId   string, non-empty, authenticated account identity
characterId string, non-empty, already proven to belong to accountId
socketId    integer 0..65535, stable game-server socket/session id
```

Repository contract used by `WorldSessionService`:

```js
getCharacterForWorld(accountId, characterId) -> Promise<Character|null>
getSurroundingUsers({ zoneId, x, z, excludeSocketId }) -> Promise<User[]>
getSurroundingNpcs({ zoneId, x, z }) -> Promise<Npc[]>
```

Successful `beginSelectedCharacter()` returns:

```text
state: WAIT_GAMESTART_LOADING
clientPackets: includes WS14-authored WIZ_SEL_CHAR (0x04) success/world-placement packet
broadcastPackets: []
snapshot: authoritative accountId/characterId/socketId/zoneId/x/z/y/state
```

For world-session opcodes only, WS03/the integration dispatcher then calls:

```js
const outcome = await world.handleClientPacket(connection.socketId, payload);
for (const packet of outcome.clientPackets) connection.send(packet);
for (const packet of outcome.broadcastPackets) {
  regionBroadcaster.send(outcome.snapshot.zoneId, packet);
}
```

Do not duplicate `WIZ_SEL_CHAR` success construction in WS03 after this call. WS14 owns the world-placement response produced by this handoff.

## Suggested orchestration construction

```js
const {
  WorldSessionService,
} = require('../ko1298-world');

const world = new WorldSessionService({
  repository: productionWorldRepository,
});
```

`productionWorldRepository` is an integration dependency. WS14 intentionally ships `MockWorldRepository` and a repository contract, not a database migration or persistence implementation.

## Routing ownership

The integration router should hand only these world-session opcodes to WS14:

- `0x0D` GAMESTART
- `0x16` request user details
- `0x1D` request NPC details
- `0x27` zone-change phase

Movement, attack, item movement and other gameplay packets must continue to their owning components. WS14 tests intentionally reject them.

## Important 1298 integration note

Do not adapt a legacy GAMESTART request shaped as `[0x0D][nameLength][characterName]` to WS14. The verified 1298 client sends `[0x0D][0x01]`, receives server `[0x0D]`, and then sends `[0x0D][0x02]`.

Similarly, do not treat `WIZ_ZONE_CHANGE` as an opcode-only acknowledgement. 1298 uses explicit LOADING/LOADED phase bytes.

## Current integration condition

At revalidation time, `ws03-ko1298-session@3a087ab1d98969ef531ac6e3f682f4a463222f5e` still reports successful character list/create/select and post-select WS14 handoff as missing. Therefore WS14 remains self-contained and fully tested; actual WS03 wiring belongs to WS03/integration control and is not implemented by this branch.
