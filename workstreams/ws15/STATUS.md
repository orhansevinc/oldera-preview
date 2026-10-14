WS15

# STATUS — AUTHORITATIVE MULTIPLAYER MOVEMENT HARDENING

## DURUM

**READY_FOR_INTEGRATION / WS15 SCOPE PRODUCTION-GRADE**

Existing 1298 movement implementation was preserved and hardened rather than replaced. The authoritative path now covers lifecycle gating, zone-transition freeze/reset, verified 48-unit region membership, deterministic nearby recipients, dedup/order protection, immutable gameplay snapshots, reconnect/disconnect cleanup, WS47 review signals, and scale/fuzz/soak coverage.

Implementation commit: `b1fee59e98a9dfa44223b090452df511c34bce76` (`ws15: harden authoritative multiplayer movement`).

GitHub Actions evidence: run `38520753108`, workflow `WS15 Movement Sync`, conclusion **success**. Both `unit` and `simulation` jobs completed successfully.

## VERIFIED 1298 SOURCE CONTRACT

Source pin used for movement semantics: Open-KO/KnightOnline `7d6cf81093e142c928c2ac9510512b2b182178b5`, version 1298.

Verified behavior applied:
- `WIZ_MOVE (0x06)` payload remains x/z u16, y i16, speed u16, flag u8, scale x10.
- moving packets keep the historical current/target behavior; stop collapses current and target to the stop coordinate.
- `PACKET_INTERVAL_MOVE = 1.5s`; periodic client movement is sent only when the client position changed.
- `PACKET_INTERVAL_ROTATE = 4.0s`.
- heading is sent as `(int16)(yaw * 100)` and received as `int16 / 100`; WS15 keeps the signed wire value exact and exposes derived yaw.
- server `VIEW_DISTANCE = 48`; movement calls region registration then region broadcast.

### Coalescing decision

No additional temporal movement coalescer is enabled. The verified client already throttles continuous movement at 1.5s. WS15 instead suppresses exact duplicate broadcasts and keeps flood/order validation. This avoids inventing packet timing semantics that are not present in 1298.

## AUTHORITATIVE MOVEMENT

Implemented:
- stable session/entity registration with duplicate-session and active entity-id reuse rejection;
- explicit `worldReady` state; `worldReady:false` sessions cannot move/rotate;
- `beginZoneTransition()` freezes movement, clears moving state and drops readiness;
- `completeZoneTransition()` performs trusted destination baseline reset and only then restores readiness;
- server-owned `sequence` and `lastAcceptedAtMs`; no client timestamp is trusted;
- optional monotonically increasing server/transport `receiveSequence` for stale/out-of-order rejection;
- class/buff/debuff speed adapter via function or `getMaxSpeed()` object;
- independent `absoluteMaxSpeed` hard ceiling retained;
- teleport remains a trusted baseline reset and never enters speed-hack/range processing;
- impossible/non-finite/overflow/underflow/non-tenth-unit coordinates rejected;
- `ZoneBoundsProvider` + `MapZoneBoundsProvider` make real map data pluggable;
- optional `terrainAuthority.validateMovement()` defines the SMD terrain/height/collision owner boundary without fabricating collision behavior;
- reconnect snapshot/restore; disconnect removes session, entity binding, region membership and flood accounting;
- entity id can be reused only after the old binding is cleaned up.

## REGION SYNC

Implemented verified 48-unit region cells and deterministic nearby-player visibility:
- region-cell crossing detection;
- enter/leave membership event via `onRegionMembership`;
- default 3x3 neighboring-cell recipient window (radius 1);
- same-zone + WORLD_READY + non-frozen recipient filtering;
- lexically deterministic recipient ordering;
- exact duplicate move/rotate broadcasts suppressed;
- teleport/zone changes remove old region membership and register the new one.

## GAMEPLAY READ APIs

### WS19 authoritative distance

```js
const snapshot = movement.getEntityDistanceSnapshot(attackerEntityId, targetEntityId);
const verdict = movement.isWithinRange({
  sourceEntityId: attackerEntityId,
  targetEntityId,
  maxDistance,
});
```

Distance snapshots are immutable, same-zone aware and expose horizontal + 3D distance. WS19 still owns combat resolution.

### WS25 immutable pursuit position

```js
const target = movement.getEntityPositionSnapshot(targetEntityId);
```

The returned object and nested position objects are frozen. It exposes zone, current/target position, heading, movement state, authoritative server sequence and region.

## WS03 / WS14 LIFECYCLE API

Register using the real world state:

```js
movement.registerSession({
  sessionId,
  entityId: socketId,
  zoneId: worldSnapshot.zoneId,
  position: worldSnapshot.position,
  worldReady: worldSnapshot.state === 'WORLD_READY',
});
```

When WS14 GAMESTART phase 2 reaches `WORLD_READY`:

```js
movement.setWorldReady(sessionId, true);
```

Before a WS14 zone-change handshake:

```js
movement.beginZoneTransition(sessionId, { reason: 'ws14-zone-change' });
```

After WS14 returns to `WORLD_READY` with the trusted destination:

```js
movement.completeZoneTransition(sessionId, {
  zoneId: worldSnapshot.zoneId,
  position: worldSnapshot.position,
  headingRaw,
});
```

Packet dispatch may carry server receive ordering metadata:

```js
movement.handleMovePacket(sessionId, payload, { receiveSequence });
movement.handleRotatePacket(sessionId, payload, { receiveSequence });
```

## SECURITY SIGNALS / WS47

`onSecuritySignal` emits sanitized observation metadata only. Signal types align with WS47 review contracts:
- `impossible_movement` for speed/range/order/flood/teleport-attempt observations;
- `repeated_invalid_position` for impossible position observations;
- `repeated_malformed_packet_metadata` for malformed movement/rotation metadata.

`evidence.reasonCode` / `evidence.category` differentiates speed, range, teleport, order and flood. No raw packet bodies are forwarded. Trusted teleport/zone transition/reconnect restore paths are separate from suspicious movement logic.

Explicit hook for an externally detected unauthorized teleport attempt:

```js
movement.signalSuspiciousTeleport(sessionId, { source: 'client-opcode' });
```

WS47 remains review-only; WS15 does not auto-ban/kick.

## TEST / SIMULATION EVIDENCE

GitHub Actions run `38520753108` on implementation commit `b1fee59e98a9dfa44223b090452df511c34bce76`:
- `unit`: **success**;
- `simulation`: **success**.

Total suite: **33 passing tests** = existing 11 baseline + 22 new hardening/simulation tests.

New coverage includes:
- pre-WORLD_READY rejection;
- zone-transition freeze/reset;
- region crossing and cross-region broadcast correctness;
- deterministic recipients;
- exact movement/rotation dedup;
- receive-order rejection;
- speed adapter + absolute ceiling;
- trusted teleport vs suspicious teleport hook;
- impossible coordinate / overflow / underflow / NaN;
- pluggable map bounds and external terrain owner;
- verified heading raw/yaw semantics;
- reconnect restore, disconnect cleanup and entity-id reuse;
- WS19 immutable distance snapshot and WS25 immutable position snapshot;
- 1,000 rapid direction changes;
- deterministic 2 / 10 / 100-player simulations;
- 10,001 accepted deterministic movement packets;
- 200 start/update/end fuzz cycles;
- 1,000 malformed payload fuzz cases;
- 500-packet flood soak (450 rejected after configured 50-packet window allowance);
- 5,000 register/disconnect churn cycles with zero remaining session/entity/region state;
- browser-style fixture: `world-register -> move -> rotate -> region-change -> stop -> teleport -> disconnect`.

## BLOCKERS / EXTERNAL OWNERS

No WS15-internal blocker remains.

Production composition still requires external owners to wire their real implementations:
1. WS14/WS03 must call the lifecycle methods at their canonical WORLD_READY / zone-transition boundaries.
2. Real SMD/map service must provide `ZoneBoundsProvider` and, if collision/height validation is required, `terrainAuthority`; WS15 intentionally does not invent collision data.
3. Character/class/buff service must supply the production `speedPolicy` adapter.
4. WS47 integration must map WS15 observation metadata to the actual character subject/correlation id before `AntiCheatSignalEngine.record()`.
5. WS19/WS25 should consume the immutable APIs above rather than maintaining competing coordinate authority.
