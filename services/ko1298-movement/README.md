# OldKO 1298 Movement Sync (WS15)

Server-side authoritative movement/position synchronization core for the real Knight Online 1298 protocol.

## Protocol facts used

- `WIZ_MOVE = 0x06`.
- Client move payload is 9 bytes: `x:u16`, `z:u16`, `y:i16`, `speed:u16`, `flag:u8`, little-endian.
- X/Z/Y and speed use a `×10` wire scale.
- Move flag `0x01` means moving; `0x02` means a periodic/continuous update.
  - `0x01` => start
  - `0x03` => update
  - `0x00` => end/stop
- Server broadcast prepends `entityId:u16` after opcode.
- `WIZ_ROTATE = 0x09` carries a signed 16-bit heading and is synchronized separately.
- `WIZ_WARP = 0x1e` is not treated as movement. A world/session service must own warp/zone-transition packets and call `teleport()` here only to reset the movement baseline.

The legacy 1298 server treats a moving packet position as the **next predicted position**: the previous target becomes current position and the incoming position becomes the new target. WS15 preserves that model while adding authoritative validation.

## Integration ports

Create `MovementService` with:

- `zoneBounds.isValidPosition(zoneId, position)` — required; can be backed by WS14 zone/map logic.
- `broadcast(event)` — emits accepted `move` / `rotate` packets plus an explicit same-zone recipient list.
- `speedPolicy(state)` — optional dynamic maximum speed (class/buffs/mounts can be accounted for by the caller).
- `floodGuard.check({sessionId, kind, nowMs})` — optional; a default sliding-window guard is included.
- `onTeleport(event)` and `onDisconnect(event)` — optional lifecycle hooks.

No DB, gateway, combat, NPC, inventory, admin, website, client, WS03 or WS14 code is modified.
