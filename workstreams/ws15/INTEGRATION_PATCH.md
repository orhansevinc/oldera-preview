WS15

# Integration Patch

## Construction

```js
const movement = new MovementService({
  zoneBounds: new MapZoneBoundsProvider({ getMap: (zoneId) => worldMapRegistry.get(zoneId) }),
  speedPolicy: { getMaxSpeed: ({ state, move }) => movementStats.maxSpeedFor({ entityId: state.entityId, phase: move.phase }) },
  terrainAuthority: { validateMovement: (request) => mapCollision.validateMovement(request) },
  broadcast: ({ recipients, packet }) => { for (const sessionId of recipients) sessions.send(sessionId, packet); },
  onRegionMembership: (event) => world.onMovementRegionMembership(event),
  onSecuritySignal: (observation) => antiCheat.record({
    ...observation,
    subject: { kind: 'character', id: sessionCharacterId(observation.sessionId) },
    correlationId: currentCorrelationId(observation.sessionId),
  }),
});
```

`terrainAuthority` is optional and owned by the real map/SMD layer. WS15 does not invent terrain height or collision rules.

## WS03 + WS14 lifecycle

```js
movement.registerSession({
  sessionId,
  entityId: socketId,
  zoneId: worldSnapshot.zoneId,
  position: worldSnapshot.position,
  headingRaw: 0,
  worldReady: worldSnapshot.state === 'WORLD_READY',
});
```

After WS14 GAMESTART phase 2 reaches `WORLD_READY`, call `movement.setWorldReady(sessionId, true)`.

Before WS14 zone-change: `movement.beginZoneTransition(sessionId, { reason: 'ws14-zone-change' })`.
After WS14 returns to `WORLD_READY`:

```js
movement.completeZoneTransition(sessionId, {
  zoneId: worldSnapshot.zoneId,
  position: { x: worldSnapshot.x, y: worldSnapshot.y, z: worldSnapshot.z },
  headingRaw: currentHeading,
});
```

Do not route warp/teleport through `handleMovePacket()`. Trusted teleport is a baseline reset and does not emit WIZ_MOVE.

## Packet dispatch and ordering

```js
movement.handleMovePacket(sessionId, payload, { receiveSequence: connection.nextServerReceiveSequence() });
movement.handleRotatePacket(sessionId, payload, { receiveSequence: connection.nextServerReceiveSequence() });
```

The 1298 packet has no application timestamp/sequence. `receiveSequence` is server/transport metadata; client timestamps are ignored.

## WS19 authoritative range

```js
const snapshot = movement.getEntityDistanceSnapshot(attackerEntityId, targetEntityId);
const verdict = movement.isWithinRange({ sourceEntityId: attackerEntityId, targetEntityId, maxDistance: skillOrAttackRange });
```

WS19 owns combat outcome; WS15 owns authoritative coordinate/distance snapshots.

## WS25 pursuit position

```js
const target = movement.getEntityPositionSnapshot(targetEntityId);
```

This is a frozen authoritative snapshot for pursuit/aggro reads.

## Reconnect / disconnect

```js
const restore = movement.createRestoreSnapshot(sessionId);
movement.disconnect(sessionId);
movement.restoreSession({ sessionId: newSessionId, entityId: socketId, snapshot: restore, worldReady: false });
```

The old entity binding must be cleaned before reuse; readiness is re-established by the owning world lifecycle.

## WS47 observations

`onSecuritySignal` receives review-only metadata using `impossible_movement`, `repeated_invalid_position`, or `repeated_malformed_packet_metadata`. Speed/range/teleport subtype is in `evidence.reasonCode/category`. No raw packet bytes are emitted.

## Coalescing decision

No extra temporal coalescer is enabled. Verified 1298 `PACKET_INTERVAL_MOVE` is 1.5 seconds and the client only sends periodic movement when position changed. Exact duplicate broadcasts are suppressed; valid distinct packets remain authoritative events.
