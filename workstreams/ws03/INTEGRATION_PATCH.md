WS03

# Integration handoff — authenticated gameplay connection dispatcher

WS03 now owns the long-lived authenticated GAME connection coordination layer. It still does **not** absorb world, movement, NPC, combat, inventory, economy, mob, loot, progression, gateway, DB, or client business logic.

## Canonical session identity/state

Every GAME connection has one canonical record:

```text
socketId:uint16
sessionId:string = "game:<socketId>"
accountId:string|null
characterId:string|null
zoneId:int|null
entityId:uint16|null
position:{x,y,z}|null
phase:
  CONNECTED
  AUTHENTICATED
  CHARACTER_SELECTED
  WORLD_LOADING
  WORLD_READY
  DISCONNECTING
  CLOSED
```

`socketId` remains the WS14/wire runtime id. `sessionId` is the stable string key required by WS45 and accepted by WS15.

## State transitions

```text
CONNECTED -> AUTHENTICATED -> CHARACTER_SELECTED -> WORLD_LOADING -> WORLD_READY
     |              |                 |                  |              |
     +--------------+-----------------+------------------+--------------+-> DISCONNECTING -> CLOSED

CHARACTER_SELECTED -> AUTHENTICATED  (lease/select rejection rollback)
WORLD_LOADING -> AUTHENTICATED       (pre-world rollback only)
WORLD_READY -> WORLD_LOADING          (WS14 zone transition)
```

Known gameplay opcodes received in the wrong state are rejected/ignored in a controlled way before downstream execution. Unknown/unowned opcodes are metadata-logged and ignored; they do not cause an unnecessary disconnect.

## WS14 world lifecycle

Backward-compatible constructor input remains:

```js
new GameSession(repository, { worldSession, socketId })
```

Selection still calls exactly:

```js
await worldSession.beginSelectedCharacter({ accountId, characterId, socketId })
```

and world lifecycle packets still call:

```js
await worldSession.handleClientPacket(socketId, payload)
```

The canonical `WIZ_SEL_CHAR` success packet must still be the first returned client packet. `WORLD_READY` is derived from WS14's returned state/snapshot; WS03 does not fabricate it.

Current WS14 has no public disconnect method. If a future/composed WS14 adapter exposes `disconnect(socketId, { reason })` or normalized `cleanup(actor, { reason })`, WS03 calls it in the deterministic cleanup chain. Until WS14 adds that verified hook, its internal session map cannot be safely mutated by WS03.

## WS15 movement — direct raw-service contract

When a `MovementService` is supplied as `movementSession`:

- entering `WORLD_READY` calls `registerSession({ sessionId, entityId, zoneId, position, headingRaw })`;
- `0x06 WIZ_MOVE` routes exactly 9 bytes after opcode to `handleMovePacket(sessionId, payload)`;
- `0x09 WIZ_ROTATE` routes exactly 2 bytes after opcode to `handleRotatePacket(sessionId, payload)`;
- accepted `result.packet` + `result.recipients` are surfaced through `onGameplayBroadcast`;
- a WS14 zone-transition snapshot calls WS15 `teleport()` to reset the authoritative movement baseline;
- disconnect calls `movementSession.disconnect(sessionId)`.

Malformed move/rotate lengths fail closed before WS15 is invoked. WS15 policy rejections are controlled packet-level rejections and do not crash the process.

## WS16 NPC boundary

Supply raw `NpcInteractionRouter` as `npcRouter`.

Direct routes:

- `0x20 WIZ_NPC_EVENT` — exact `opcode + npcId:u16`.
- `0x22 WIZ_TARGET_HP` — exact `opcode + targetId:u16 + immediate:u8`.

WS03 passes the full packet plus an immutable canonical actor context to `npcRouter.route(packet, actor)`.

`0x1D WIZ_REQ_NPCIN` remains routed to WS14 by default because the passing Moradon bootstrap currently depends on WS14's region-detail state. Set `npcRoutesRequestNpcIn: true` only after the central owner resolves the WS14/WS16 ownership collision and re-proves Moradon.

## WS17 / WS19 / WS22 trust boundary

WS03 exposes `trustedDomainCall(domain, operation)` for already-verified protocol decoders/composition adapters:

```js
await session.trustedDomainCall('inventory', verifiedOperation)
await session.trustedDomainCall('combat', verifiedOperation)
await session.trustedDomainCall('economy', verifiedOperation)
```

The downstream adapter receives:

```js
adapter.execute({ actor: canonicalAuthenticatedActor, operation })
```

No client-supplied account/character/zone/entity identity is trusted. WS03 injects identity from its own canonical state. No opcode is bound for these domains until a verified 1298 packet contract is supplied.

## WS25 / WS26 / WS27 outbound result boundary

`deliverDomainEvent(source, event)` accepts only `WS25`, `WS26`, or `WS27` while `WORLD_READY` and calls:

```js
domainEventAdapter.encode({ source, event, actor })
```

The encoder returns normalized `clientPackets` / `broadcastPackets`. This standardizes session delivery without inventing mob/loot/progression opcodes in WS03.

## WS45 duplicate ownership

When raw `SessionOwnershipService` is supplied as `ownership`:

1. successful credential validation -> `acquireAccount({ accountId, sessionId, serverId })`;
2. successful local character ownership validation -> `acquireCharacter(...)` **before** WS14 world load;
3. duplicate account/character rejection never enters the next session state;
4. disconnect calls `ownership.disconnect(sessionId, { useGrace, reason })` exactly once.

No new numeric KO duplicate-login result code is invented. Until a verified legacy mapping exists, duplicate account rejection uses the existing generic game-login failure response.

## Queue / backpressure / disconnect

`SessionDispatcher` is now the per-connection serialization boundary:

- one packet handler executes at a time;
- queue packet/byte limits prevent unbounded async buildup;
- a long handler cannot allow a later packet to overtake it;
- disconnect stops acceptance of new work, cancels queued work, waits the active handler, then cleans up once;
- fatal malformed/backpressure errors close the session in a classified path rather than allowing an unhandled process exception.

The TCP server also pauses the socket while processing a read batch, so kernel/Node flow control participates in backpressure.

## Deterministic cleanup order

WS03 calls available downstream hooks in this order and continues even if one cleanup hook fails:

```text
WS15 movement
WS16 NPC
WS19 combat
WS17 inventory
WS22 economy
WS25/26/27 event adapter
WS14 world
WS45 ownership
```

Duplicate disconnect calls share one cleanup promise.

## Production logging

- packet trace is opt-in with `PACKET_TRACE=1`;
- traces contain direction, opcode, length, socket id and state metadata only;
- payload bytes, passwords, credentials, tokens and secret/key-shaped metadata are not logged;
- transport/session failures are classified (`MALFORMED_PACKET`, downstream, ownership, backpressure, transport, internal) instead of silent `socket.destroy(error)` behavior.
