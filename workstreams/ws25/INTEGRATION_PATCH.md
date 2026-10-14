# WS25 Moradon Mob Integration Contract

## Construction

```js
const {
  MobService,
  DeterministicMobScheduler,
  loadVerifiedWorldDefinition,
} = require('../../services/ko1298-mobs');

const definition = loadVerifiedWorldDefinition(sourceBackedZoneData, {
  ws31Catalog,
});

const mobs = new MobService(definition, {
  world,
  terrain: {
    resolveHeight: ws14HeightResolver.resolveHeight,
  },
  movement,
  combat,
});

const scheduler = new DeterministicMobScheduler(mobs, { tickIntervalMs: 100 });
scheduler.initialize(monotonicNowMs);
```

## Required authorities

### `terrain.height-authority`

Provider: WS14 `ws14-world-session@9b82adefb05a3cca32f430e25f8a1d9109db93b2`.

WS25 consumes only the public height boundary:

```js
terrain = {
  resolveHeight(zoneId, x, z) => {
    status: 'authoritative' | 'unresolved' | 'invalid',
    height?,
    surface?,
    policy?,
    terrainHeight?,
    shapeHeight?,
    reason?,
  },
};
```

For production `dataClass=real` spawns, only `status === 'authoritative'` with a finite `height` is accepted. WS25 supplies the deterministic K_NPCPOS X/Z and consumes only Y. The resolver cannot replace the selected X/Z. There is no y=0, constant-Y, source-Y, manual fixture-Y or guessed fallback in the production path.

Initial materialization fails closed before any spawn event when height is not authoritative. A respawn remains `despawned` and is retried/deferred until a fresh authoritative height is available.

### `visibility.protocol`

Provider: WS11 `ws11-protocol-lab@944b6ff9b6329af29f1048a74aa6e14fca141639`.

Current visibility authority verifies the Moradon monster wire family through `WIZ_NPC_REGION (0x1C)`, `WIZ_REQ_NPCIN (0x1D)`, `WIZ_NPC_INOUT (0x0A)` and the NPC detail record. Monsters use that same verified CNpc family.

WS25 does **not** encode browser packets. It emits mob lifecycle/visibility-domain events only. Composition must consume the WS11 protocol authority rather than invent an encoder in WS25.

### `WS31 monster catalog`

Provider: WS31 `ws31-data-catalog@546d2ab62cd46a97f3385ebcddbe0c775a02c2eb`.

Current catalog authority freezes the Moradon monster slice as:

- 10 verified monster templates: 750, 751, 752, 754, 755, 850, 851, 852, 853, 854;
- 20 selected verified K_NPCPOS spawn groups;
- 135 declared deterministic runtime slots;
- source position semantics: K_NPCPOS rectangle/count;
- deterministic projection is allowed for WS25 and is explicitly not claimed to reproduce original 1298 RNG identity.

The WS25 checked-in verified slice remains source-backed to `Open-KO/OpenKO-db@bec619466938d278339c30e5b1a4bff3c9413bab` and is regression-checked against the WS31 summary in CI.

## Coordinate basis

Each real mob has three related coordinate records:

- `spawnAnchor`: immutable deterministic X/Z + heading selected inside its verified K_NPCPOS rectangle;
- `spawnOrigin`: the latest authoritative X/Y/Z materialization for that anchor;
- `home`: the same latest authoritative coordinate used by chase/leash/return-home intents.

On initial spawn:

```text
spawnAnchor X/Z -> WS14 resolveHeight(zoneId,x,z)
                 -> authoritative Y
                 -> position == spawnOrigin == home
```

On respawn, WS25 keeps the same deterministic verified rectangle slot X/Z and calls WS14 again. A new authoritative Y replaces `position`, `spawnOrigin` and `home` together before the respawn event is emitted.

## WS14 / world port

```js
world = {
  listAggroCandidates({ mob, zoneId, origin, range, atMs }) => targetSnapshot[],
  getTargetSnapshot(targetId) => targetSnapshot | null,

  // Region/cell authority remains outside WS25.
  isMobVisibleToPlayer(playerSnapshot, mobSnapshot) => boolean,

  onMobSpawn(mobSnapshot, event),
  onMobStateChange(mobSnapshot, event),
  onMobDespawn(mobSnapshot, event),
  onNearbyMobSpawn(playerSnapshot, mobSnapshot, event),
  onNearbyMobDespawn(playerSnapshot, mobSnapshot, event),

  // Source-backed OpenKO FindFriend(type=0) signal.
  onAssistSignal({ mobId, targetId, zoneId, group, family, searchRange, origin, atMs, source }),
};
```

Player region lifecycle:

```js
mobs.playerEnteredRegion(playerSnapshot, nowMs);
mobs.playerLeftRegion(playerId, nowMs);
```

WS25 does not own region-cell calculation.

## WS15 / movement port

```js
movement = {
  chase({ mobId, targetId, zoneId, home, leashRange, atMs }),
  returnHome({ mobId, zoneId, home, atMs, reason }),
  patrol({ mobId, zoneId, path, atMs }),
  stop({ mobId, atMs, reason }),
  onNoPath({ mobId, zoneId, state, atMs }),
};
```

Movement authority reports back:

```js
mobs.syncPosition(mobId, authoritativePosition, nowMs);
mobs.reportMovementOutcome(mobId, 'progress' | 'stuck' | 'no-path', nowMs);
```

WS25 does not copy WS15 pathfinding/movement. Chase and return-home carry the authoritative WS14-derived `home` coordinate; runtime movement still comes back through `syncPosition()`.

## WS19 / combat port

```js
combat = {
  isTargetAlive(targetSnapshot) => boolean,
  canAggro(mobSnapshot, targetSnapshot) => boolean,
  canAttack(mobSnapshot, targetSnapshot) => boolean,
  attackIntent({ mobId, targetId, zoneId, attackRange, sourceAttackDelayMs, atMs }),
};
```

WS19/adapters apply combat and feed authoritative absolute HP back:

```js
mobs.applyHealth(mobId, authoritativeHp, nowMs, {
  sourceId,
  killerId,
  combatEventId,
});
```

WS25 never calculates guessed damage.

## WS26 / WS27 death handoff

The integration composition root listens for one WS25 state event:

```js
onMobStateChange(mob, event) {
  if (event.type === 'dead') {
    // WS26 loot and WS27 progression consume authoritative death/combat context.
  }
}
```

WS25 does not generate loot, XP, party-share or death penalties.

## Runtime IDs

`mob.id` is stable for the deterministic spawn slot across death/respawn. `spawnEpoch` increments only after a successful authoritative respawn. Consumers needing a unique life identity should use `${mob.id}@${mob.spawnEpoch}`.

## WS50 handoff

This WS25 revision is intended for a **new** immutable WS50 candidate. Do not mutate `WS50-C3`; C3 remains an immutable historical provider-set pinned to WS25 `a42b489e1a17d7c2889cfd92909ddd45c65e825e`.

Dependencies to discover for the next candidate:

```text
requires terrain.height-authority -> WS14@9b82adefb05a3cca32f430e25f8a1d9109db93b2
requires visibility.protocol       -> WS11@944b6ff9b6329af29f1048a74aa6e14fca141639
requires WS31 monster catalog      -> WS31@546d2ab62cd46a97f3385ebcddbe0c775a02c2eb
```

No browser packet encoder is owned or guessed by WS25.
