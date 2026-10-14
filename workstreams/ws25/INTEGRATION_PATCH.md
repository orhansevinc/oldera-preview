# WS25 Stage 2/3 Integration Contract

## Construction

```js
const {
  MobService,
  DeterministicMobScheduler,
  loadVerifiedWorldDefinition,
} = require('../../services/ko1298-mobs');

const definition = loadVerifiedWorldDefinition(sourceBackedZoneData, {
  ws31Catalog,
  // Set requireWs31Catalog=true once WS31 contains the complete production slice.
});

const mobs = new MobService(definition, { world, movement, combat });
const scheduler = new DeterministicMobScheduler(mobs, { tickIntervalMs: 100 });
scheduler.initialize(monotonicNowMs);
```

## WS14 / world port

```js
world = {
  listAggroCandidates({ mob, zoneId, origin, range, atMs }) => targetSnapshot[],
  getTargetSnapshot(targetId) => targetSnapshot | null,

  // Mandatory for source-backed K_NPCPOS records whose Y is unresolved.
  resolveSpawnPosition({ mobId, zoneId, x, z, heading, sourceArea, sourceRef, atMs })
    => { x, y, z, heading },

  // Region/cell authority remains in WS14.
  isMobVisibleToPlayer(playerSnapshot, mobSnapshot) => boolean,

  onMobSpawn(mobSnapshot, event),
  onMobStateChange(mobSnapshot, event),
  onMobDespawn(mobSnapshot, event),
  onNearbyMobSpawn(playerSnapshot, mobSnapshot, event),
  onNearbyMobDespawn(playerSnapshot, mobSnapshot, event),

  // Source-backed OpenKO FindFriend(type=0) signal.
  // Do not propagate it with guessed rules; freeze exact WS14 region/group behavior first.
  onAssistSignal({ mobId, targetId, zoneId, group, family, searchRange, origin, atMs, source }),
};
```

Player region lifecycle:

```js
mobs.playerEnteredRegion(playerSnapshot, nowMs);
mobs.playerLeftRegion(playerId, nowMs);
```

A region transition should call leave for the old region then enter with the new authoritative snapshot. WS25 does not own region-cell calculation.

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

WS25 must not call WS15 internals or calculate a path itself.

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

WS25 never passes a guessed damage amount into its own state.

## WS26 / drop hook

The integration composition root listens for **one** WS25 state event:

```js
onMobStateChange(mob, event) {
  if (event.type === 'dead') {
    // invoke WS26 createFromMobDeath() with the authoritative combat/death event id/context
  }
}
```

Do not generate loot on `corpse`, `despawned`, or `respawn`.

## WS27 / progression hook

The same authoritative `dead` event plus WS19 killer/party context is the handoff point for WS27 mob-kill XP. WS25 does not calculate XP, party share or death penalties.

## Verified data contract

`world-data/mobs/verified/moradon-zone21.verified.json` is source-backed to:

- Open-KO/OpenKO-db K_MONSTER
- Open-KO/OpenKO-db K_NPCPOS

The current WS31 canonical `mobs.json` does not yet contain all Moradon 750/751/752/754/755/850-854 rows. Until WS31 expands, production bootstrap may load this WS25 source-backed slice with `requireWs31Catalog=false`, but should keep the file's `catalogStatus=upstream-verified-pending-ws31-catalog-expansion` visible. Once WS31 imports those IDs, enable `requireWs31Catalog=true` so catalog drift fails closed.

The deterministic X/Z point is selected inside a verified K_NPCPOS rectangle and is not claimed to match OpenKO's RNG. Y must come from authoritative world/terrain data.

## Runtime IDs

`mob.id` is stable for the spawn slot across death/respawn. `spawnEpoch` increments per respawn. Consumers that need a unique life identifier should use `${mob.id}@${mob.spawnEpoch}`; they must not assume respawn allocates a new logical mob ID.

## Threat/assist constraint

Do not add a generic threat table based on `m_DamagedUserList`; OpenKO labels that list for XP distribution. Exact attacker retarget rules belong behind a future verified policy based on the complete `ChangeTarget()` behavior.
