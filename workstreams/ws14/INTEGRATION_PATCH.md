# WS14 — Integration Patch / Downstream Contract

Implementation commit: `40c748d72b3f5ccf13bbb5aace7abcae05fd25be`
CI evidence: run `38521440351`, job `115711809894` — SUCCESS.

## Stable compatibility entry

WS03 may keep its existing selected-character call:

```js
await world.beginSelectedCharacter({ accountId, characterId, socketId });
```

That call intentionally preserves the canonical Moradon 21 selection/bootstrap path used by WS10.

## Generic entry

For a verified production-ready target:

```js
await world.beginWorldEntry({
  accountId,
  characterId,
  socketId,
  zoneId,
  position, // optional only when ZoneDefinition.spawn is verified
  reason: 'INITIAL' | 'RECONNECT',
});
```

Unknown or incomplete zones throw; callers must not catch that and substitute guessed coordinates.

## Transition request

```js
const out = world.requestZoneChange({
  socketId,
  targetZoneId,
  position, // optional only when target definition has verified spawn
  reason: 'WARP' | 'GATE' | 'TELEPORT' | 'RESPAWN',
  subZone: 0,
});
```

`out.clientPackets` goes to the moving client. `out.zoneBroadcasts` is source-zone broadcast work. `out.clientEntityCleanup` describes stale source entities that the composition layer must clear.

Continue routing exact client `WIZ_ZONE_CHANGE` phase packets back through:

```js
await world.handleClientPacket(socketId, packet);
```

Do not enable movement/combat until:

```js
world.getCapabilities(socketId)
// { movement: true, combat: true } only in WORLD_READY with no active transition
```

## WS15 adapter

Pass the existing movement service through:

```js
new WorldSessionService({
  repository,
  movementPort: {
    registerSession: (input) => movement.registerSession(input),
    teleport: (sessionId, request) => movement.teleport(sessionId, request),
    disconnect: (sessionId) => movement.disconnect(sessionId),
  },
});
```

The transition teleport callback occurs only after client target `LOADING` is accepted. WS14 never converts a warp/gate/respawn into `WIZ_MOVE`.

## WS24 adapter

```js
zonePolicy: {
  canEnter({ character, targetZone, reason }) {
    const decision = zoneRules.CanEnterZone(character.nation, targetZone.zoneId, runtimeState);
    return { allowed: Boolean(decision), reason: decision ? undefined : 'WS24_DENIED' };
  },
}
```

The adapter is synchronous at this lifecycle boundary. Unknown zones are already denied by WS14 before WS24 is called.

## WS16 / region adapter

Use `regionPort.subscribe/unsubscribe` for authoritative session-region registration. Consume lifecycle hooks:

- `onClientRegionReset` before leaving source;
- `onSourceLeave` after source membership removal;
- `onTargetEnter` after target membership insertion;
- `onWorldReady` after final client `LOADED`.

Nearby NPC wire detail remains supplied by the existing WS14 repository/serializer contract; WS14 does not implement NPC AI.

## WS25 mob adapter

Provide read/bootstrap hooks only:

```js
mobPort: {
  getNearby: ({ zoneId, x, z }) => mobWorld.getNearby({ zoneId, x, z }),
},
bootstrapPort: {
  buildMobBootstrap: ({ session, mobs }) => packetAdapter.buildMobBootstrap(session, mobs),
},
```

WS14 fixes ordering (`USERS -> NPCS -> MOBS`) but does not own mob AI or invent mob packet formats.

## WS27 reposition adapter

After WS27 resolves a respawn destination, call:

```js
const plan = world.planWorldReposition({
  socketId,
  targetZoneId: destination.zoneId,
  position: destination.position,
  reason: 'RESPAWN',
});
```

If `plan.kind === 'ZONE_TRANSITION'`, use `requestZoneChange` with the same reason. If `IN_ZONE_REPOSITION`, final composition must use its verified same-zone respawn/reposition packet path and the WS15 teleport baseline port; do not fake it as a zone transition or movement packet.

## Reconnect adapter

Repository must expose:

```js
getAuthoritativeWorldState(accountId, characterId)
// -> { accountId?, characterId?, zoneId, x, z, y }
```

Then:

```js
await world.restoreAuthoritativeSession({ accountId, characterId, socketId });
```

No authoritative state or a non-production-ready zone is an error; there is no implicit Moradon fallback.

## Disconnect

Always route socket close through:

```js
world.disconnect(socketId, reason);
```

This cleans all touched source/target memberships and active region/movement state even if the socket disconnects mid-transition.
