# WS15 Integration Patch

WS15 does not modify WS03, WS14, gateway, client, DB, combat, NPC, inventory, admin or website code. Integration is intentionally interface-only.

## World/session integration

1. Instantiate `MovementService` once in the world process.
2. Provide `zoneBounds.isValidPosition(zoneId, position)` from the authoritative WS14/world map layer. For production, this should use real zone/map validity rather than only an axis-aligned box.
3. On selected-character world entry, call `registerSession({ sessionId, entityId, zoneId, position, headingRaw, maxSpeed? })` using the authoritative spawn state.
4. When the 1298 session dispatcher receives `WIZ_MOVE (0x06)`, pass the **9-byte payload after the opcode** to `handleMovePacket(sessionId, payload)`.
5. When it receives `WIZ_ROTATE (0x09)`, pass the **2-byte payload after the opcode** to `handleRotatePacket(sessionId, payload)`.
6. Deliver `broadcast(event).packet` only to `event.recipients`. WS15 computes recipients strictly from registered sessions in the same `zoneId`.
7. On disconnect, call `disconnect(sessionId)` to delete position and flood state.

## Speed policy

Provide `speedPolicy(state)` from world/game rules when those rules are available. WS15 also enforces `absoluteMaxSpeed` as a hard ceiling. The dynamic policy should account for legitimate class/buff/mount rules without adding combat or skill logic to WS15.

## Teleport / warp distinction

Do **not** feed warps into `handleMovePacket()` and do not relax movement validation to make teleports pass.

- `WIZ_WARP (0x1e)` / zone transition remains owned by the world/session layer.
- After that layer authorizes a warp and selects the destination, call `movement.teleport(sessionId, { zoneId, position, headingRaw, reason })`.
- `teleport()` validates representability and destination bounds, resets current/target movement baseline, and emits `onTeleport`; it deliberately sends no `WIZ_MOVE` packet.

This keeps speed/range anti-cheat deterministic while permitting legitimate server-authorized teleports.

## Packet-flood hook

`SlidingWindowFloodGuard` is included and can be replaced by any object implementing:

```js
check({ sessionId, kind, nowMs }) -> { allow: boolean, reason?: string, event?: object }
cleanup(sessionId)
```

Use `onFlood` on the included guard to feed metrics, logging or session enforcement without coupling those concerns into WS15.
