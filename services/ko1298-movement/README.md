# @oldkoweb/ko1298-movement

Authoritative multiplayer movement core for the real Knight Online 1.298 browser/server path.

## Verified 1.298 behavior

Primary source: Open-KO/KnightOnline commit `7d6cf81093e142c928c2ac9510512b2b182178b5` (`CURRENT_VERSION = 1298`).

- `WIZ_MOVE = 0x06`: `x:u16, z:u16, y:i16, speed:u16, flag:u8`, coordinates/speed scaled by 10.
- flags: `0x01` moving/start, `0x03` moving/continuous, `0x00` stop.
- client continuous movement interval is `1.5s` and is sent only when position changed; rotation interval is `4.0s`.
- client sends rotation as `(int16)(yaw * 100)` and receives it as `int16 / 100.0`; WS15 preserves the signed int16 exactly and exposes derived yaw without rewriting the packet value.
- Ebenezer region size is `VIEW_DISTANCE = 48`; `MoveProcess()` calls `RegisterRegion()` and then region broadcast.
- 1.298 server movement keeps current/next-position semantics: on moving packets previous target becomes current and received position becomes the next target; stop makes both positions equal.

Because the verified client already rate-limits continuous movement, WS15 does **not** invent a server-side temporal coalescer. It performs exact-packet broadcast deduplication, flood protection and optional server receive-order checking instead.

## Authoritative lifecycle

`registerSession()` creates the movement state. For legacy compatibility `worldReady` defaults to true, but production composition MUST pass the real WS14 readiness state explicitly. A session with `worldReady: false` cannot move or rotate.

Use `beginZoneTransition()` before WS14 starts a zone transition. It freezes movement and clears moving state. Use `completeZoneTransition()` only after the trusted world transition reaches `WORLD_READY`; it resets the authoritative baseline and unfreezes movement. `teleport()` is a trusted server/world API and never synthesizes `WIZ_MOVE`.

## Region sync

Positions are indexed into 48-unit cells. Crossing a cell emits `onRegionMembership({leave, enter, ...})`. Movement/rotation recipients are the deterministic sorted set of world-ready players in the sender's configured neighboring region window (default: the 3x3 cells around the sender), not every player in the zone.

## Ordering and time

The 1.298 movement payload contains no application timestamp/sequence field. WS15 therefore never trusts a client timestamp. The dispatcher may provide monotonically increasing server/transport `receiveSequence`; stale/out-of-order values are rejected. Every accepted authoritative mutation receives a server-owned `sequence` and `lastAcceptedAtMs`.

## Adapters

- `speedPolicy(state, move)` or `{ getMaxSpeed({state, move}) }`: class/buff/debuff-derived movement cap. `absoluteMaxSpeed` remains an independent hard safety ceiling.
- `ZoneBoundsProvider`: real SMD/map integration boundary. `MapZoneBoundsProvider` can delegate to a map object's `isValidPosition`.
- `terrainAuthority.validateMovement(...)`: optional external terrain/height/collision owner. WS15 intentionally contains no guessed SMD collision algorithm.
- `onSecuritySignal(observation)`: sanitized WS47-compatible observation hook; no raw packet bodies are forwarded.

## Read-only gameplay APIs

- `getPositionSnapshot(sessionId)` / `getEntityPositionSnapshot(entityId)` return frozen authoritative snapshots for WS25 pursuit/world consumers.
- `getDistanceSnapshot(sourceSessionId, targetSessionId)` / `getEntityDistanceSnapshot(...)` return frozen authoritative 2D/3D distances for WS19.
- `isWithinRange({ sourceEntityId, targetEntityId, maxDistance, threeDimensional })` provides a simple range projection without giving combat ownership to WS15.
- `createRestoreSnapshot()` + `restoreSession()` preserve authoritative position/heading across reconnect after the previous session is cleaned up.

## Security distinction

Normal movement can be rejected for speed, range, invalid position, ordering or flood reasons. Trusted `teleport()`/zone transition is a separate baseline reset and is excluded from speed-hack logic. If another server component observes an unauthorized client teleport attempt it can call `signalSuspiciousTeleport()` so WS47 receives review-only metadata.

## Tests

From repo root:

```bash
node --test tests/ko1298-movement/protocol.test.js tests/ko1298-movement/movement.test.js tests/ko1298-movement/production-hardening.test.js tests/ko1298-movement/browser-integration-fixture.test.js
node --test tests/ko1298-movement/deterministic-simulation.test.js tests/ko1298-movement/simulation-scale.test.js
```
