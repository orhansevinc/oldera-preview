# WS14 — KO 1298 World Session / Multi-Zone Protocol

Status: **MULTI-ZONE LIFECYCLE READY; production entry remains fail-closed per zone data**

Implementation commit: `40c748d72b3f5ccf13bbb5aace7abcae05fd25be`
Implementation CI: GitHub Actions run `38521440351`, job `115711809894` — **SUCCESS**.
Canonical Moradon E2E remains WS10 run `38505039290` / run #26 — **PASS**.

## Scope

WS14 owns authoritative world-session lifecycle only: selected-character world entry, zone membership, region subscription, zone-transition transaction boundaries, reconnect placement, world-ready gating, and integration ports for movement/NPC/mob/PvP/progression domains.

WS14 does **not** implement movement algorithms, combat, NPC AI, mob AI, inventory, or client behavior.

## Data boundary

`data/zones.1298.json` separates three concepts that must not be conflated:

1. verified 1298 **zone identity** (`zoneId`, source-backed name/type);
2. verified **world data** (`mapRef`, spawn) when a pinned source exists;
3. **production-entry readiness**, which additionally requires representable coordinates, verified zone-ability data, and external entry rules.

`ZoneRegistry.requireKnown(zoneId)` rejects unknown IDs. `ZoneRegistry.requireProductionReady(zoneId)` rejects known-but-incomplete zones. No guessed coordinates or rule values are accepted.

The current catalog contains 16 WS31-verified zone IDs. Moradon 21 is the only built-in definition marked `PRODUCTION_READY`. Other source-backed IDs remain `RULES_PENDING`, `IDENTITY_ONLY`, or `DATA_CONFLICT` until their missing contracts are pinned.

## ZoneDefinition / ZoneRuntime

`ZoneDefinition` is immutable data: zone ID, name/type, optional nation constraint, map reference, spawn, zone-ability flags, entry status, and explicit unknowns.

`ZoneRuntime` owns only deterministic membership for one definition. Membership insertion/removal is not a substitute for NPC/mob/movement logic.

`ZoneRegistry` owns definitions and one runtime per definition. A caller may inject a stricter registry or additional verified definitions for integration/test composition.

## Initial world entry

Legacy `beginSelectedCharacter()` remains a compatibility entry point and still selects Moradon 21 at `(312, 402, 0)`.

Generic `beginWorldEntry({ accountId, characterId, socketId, zoneId, position, reason })` performs:

1. account/character ownership lookup;
2. fail-closed zone definition lookup;
3. protocol coordinate representability validation;
4. nation constraint check;
5. optional `zonePolicy.canEnter(...)` decision;
6. exact 1298 `WIZ_SEL_CHAR` success packet;
7. normal two-phase `WIZ_GAMESTART` bootstrap;
8. region subscription and nearby snapshot;
9. movement registration adapter;
10. runtime membership insertion only when `WORLD_READY` is reached.

Movement and combat capability is `false` until `WORLD_READY`.

## Zone transition state machine

Every accepted transition has a monotonic audit trail containing the required states:

`REQUESTED -> AUTHORIZED -> LEAVING_SOURCE -> TELEPORT -> LOADING -> LOADED -> WORLD_READY`

Compatibility aliases keep the former canonical tests valid:

- `ZONE_CHANGE_WAIT_LOADING` => `TELEPORT`
- `ZONE_CHANGE_WAIT_LOADED` => `LOADED`

### REQUESTED / AUTHORIZED

A second request while `session.transition` exists is rejected with `zone change already in progress`.

Authorization is fail-closed: target definition must be production-ready, coordinates must fit the 1298 wire format, nation constraints must pass, and an installed `zonePolicy.canEnter` (WS24 adapter) may deny entry.

### LEAVING_SOURCE

Before the client is told to load the target:

1. old region entity IDs are captured in `clientEntityCleanup`;
2. `lifecycle.onClientRegionReset(...)` is called;
3. source region subscription is removed;
4. source `ZoneRuntime` membership is removed;
5. `lifecycle.onSourceLeave(...)` is called.

`zoneBroadcasts` contains the source-zone `USER_OUT` packet for composition/broadcast. WS14 does not invent client-side entity packets beyond protocol evidence.

### TELEPORT

The target remains pending; the authoritative session `zoneId/x/z/y` is still the source state.

For a true cross-zone transition, the verified target zone-ability packet is emitted before the exact 1298 `WIZ_ZONE_CHANGE/TELEPORT` packet. Same-zone Moradon compatibility emits only the historical teleport packet.

### LOADING

Only after exact client `[WIZ_ZONE_CHANGE, LOADING]` is accepted does WS14:

1. set authoritative target position;
2. add target runtime membership;
3. call `lifecycle.onTargetEnter(...)`;
4. subscribe to target region;
5. call the WS15-compatible `movementPort.teleport(sessionId, { zoneId, position, headingRaw, reason })` baseline reset;
6. obtain nearby users;
7. obtain nearby NPCs;
8. obtain mobs from `mobPort.getNearby(...)`;
9. optionally obtain mob wire packets from `bootstrapPort.buildMobBootstrap(...)`;
10. emit region user IDs, region NPC IDs, optional mob bootstrap packets, then `WIZ_ZONE_CHANGE/LOADED` acknowledgement.

The declared bootstrap stage order is always `USERS -> NPCS -> MOBS`.

### LOADED / WORLD_READY

Only exact client `[WIZ_ZONE_CHANGE, LOADED]` moves the session to `WORLD_READY`. Target runtime membership is refreshed with the final snapshot and the normal `USER_REGENE` broadcast is returned.

Only now are `capabilities.movement` and `capabilities.combat` true.

## Rollback

Any synchronous lifecycle failure during request preparation, or target-load failure after client `LOADING`, invokes rollback:

1. unsubscribe target region when installed;
2. remove target membership when added;
3. reset WS15 movement baseline back to source if target teleport reset already occurred;
4. restore source zone/position and old nearby snapshots;
5. restore source membership/subscription when they existed;
6. return to `WORLD_READY`;
7. record `ROLLED_BACK` audit event.

If the target teleport packet was already exposed to the caller, `error.rollbackOutcome.clientPackets` contains a source teleport recovery packet. If rollback itself fails, the session is marked `TRANSITION_FAILED` instead of pretending recovery succeeded.

## Disconnect during transition

`disconnect(socketId)` removes the socket from every source/target runtime touched by an active transition, removes the active region subscription, calls the WS15 disconnect adapter, emits lifecycle cleanup, stores the final audit trail, and deletes the world session. It never commits a pending target merely because the socket disconnected.

## Region / stale entity contract

The `regionPort` contract is deliberately transport/domain-neutral:

- `subscribe({ socketId, zoneId, position, reason })`
- `unsubscribe({ socketId, zoneId, reason })`

`clientEntityCleanup` identifies stale user/NPC/mob IDs from the source region and sets `clearAll: true`. The client/packet integration layer must ensure those old-zone entities cannot remain visible after transition. WS14 itself does not fabricate unknown despawn wire shapes.

## Reconnect restore

`restoreAuthoritativeSession({ accountId, characterId, socketId })` requires repository port `getAuthoritativeWorldState(accountId, characterId)` and then reuses generic world entry. There is no Moradon fallback: missing/unknown/not-production-ready restored zones fail closed.

## Respawn / warp / gate / teleport

Transition intent is explicit and preserved as one of:

- `WARP`
- `GATE`
- `TELEPORT`
- `RESPAWN`

`planWorldReposition(...)` is the WS27/final-composition seam. It returns `IN_ZONE_REPOSITION` when target zone equals source, otherwise `ZONE_TRANSITION`. It does not conflate a same-zone respawn with `WIZ_MOVE`, nor does it invent a respawn packet. Cross-zone reposition can be executed through `requestZoneChange(...)` with the original reason.

## Integration ports

All lifecycle-critical control ports are synchronous so source/target membership cannot race an unresolved promise:

- `zonePolicy.canEnter(...)` — WS24 rule decision;
- `movementPort.registerSession(...)` — WS15 initial baseline;
- `movementPort.teleport(sessionId, request)` — WS15 teleport baseline reset;
- `movementPort.disconnect(sessionId)` — WS15 cleanup;
- `regionPort.subscribe/unsubscribe(...)` — region lifecycle;
- `lifecycle.onClientRegionReset/onSourceLeave/onTargetEnter/onWorldReady/onTransitionRollback/onDisconnect` — composition hooks;
- `mobPort.getNearby(...)` — WS25 snapshot hook (may return a Promise because it is read-only bootstrap data);
- `bootstrapPort.buildMobBootstrap(...)` — packet integration hook for mobs (may return a Promise);
- repository `getSurroundingUsers/getSurroundingNpcs` — existing world snapshot ports;
- repository `getAuthoritativeWorldState` — reconnect port.

## Moradon protocol regression

The canonical 1298 Moradon bytes remain unchanged:

- select success: `04 01 15 30 0c b4 0f 00 00 00`
- same-zone transition teleport: `27 03 15 00 30 0c b4 0f 00 00 00`
- zone loaded response (empty surroundings): `15 00 00`, `1c 00 00`, `27 02`
- Moradon zone ability: exact legacy serializer remains in use.

WS10 run #26 continues to be the canonical genuine C++/Emscripten/WASM/WebGL2 Moradon proof; WS14 changes are server lifecycle additions, not a replacement client/render path.
