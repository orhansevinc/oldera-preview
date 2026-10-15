'use strict';

const { MobCombatService } = require('./mob-combat-service.cjs');

const DEFAULT_TICK_MS = 100;
const DEATH_LEDGER_LIMIT = 8192;

function requiredFunction(owner, name) {
  const fn = owner?.[name];
  if (typeof fn !== 'function') {
    throw new TypeError(`ko1298-mobs: ${name} port is required`);
  }
  return fn.bind(owner);
}

function optionalFunction(owner, name, fallback = () => {}) {
  const fn = owner?.[name];
  if (fn !== undefined && typeof fn !== 'function') {
    throw new TypeError(`ko1298-mobs: ${name} port must be a function`);
  }
  return typeof fn === 'function' ? fn.bind(owner) : fallback;
}

function finitePosition(position, label = 'player.position') {
  if (!position || ![position.x, position.y, position.z].every(Number.isFinite)) {
    throw new TypeError(`ko1298-mobs: ${label} requires finite x/y/z`);
  }
  return Object.freeze({ x: position.x, y: position.y, z: position.z });
}

function normalizePlayer(player) {
  if (!player || (typeof player.id !== 'string' && typeof player.id !== 'number')) {
    throw new TypeError('ko1298-mobs: player.id is required');
  }
  if (player.zoneId === undefined || player.zoneId === null) {
    throw new TypeError('ko1298-mobs: player.zoneId is required');
  }
  return Object.freeze({
    ...player,
    id: String(player.id),
    zoneId: String(player.zoneId),
    position: finitePosition(player.position),
  });
}

function requireTimestamp(now) {
  if (!Number.isFinite(now) || now < 0) throw new TypeError('ko1298-mobs: timestamp must be finite and >= 0');
  return now;
}

function freezeEvent(event) {
  return Object.freeze({ ...event });
}

function defaultAlive(target) {
  if (!target) return false;
  if (target.alive === false || target.dead === true) return false;
  if (Number.isFinite(target.hp) && target.hp <= 0) return false;
  return true;
}

class MobProductionRuntime {
  constructor(worldDefinition, {
    terrain,
    runtimeIds,
    world,
    movement,
    combat,
    loot = {},
    events = {},
    tickIntervalMs = DEFAULT_TICK_MS,
    clock = () => Date.now(),
  } = {}) {
    if (!worldDefinition) throw new TypeError('ko1298-mobs: worldDefinition is required');
    if (!Number.isInteger(tickIntervalMs) || tickIntervalMs < 20) {
      throw new RangeError('ko1298-mobs: tickIntervalMs must be an integer >= 20');
    }
    if (typeof clock !== 'function') throw new TypeError('ko1298-mobs: clock must be a function');

    requiredFunction(terrain, 'resolveHeight');
    requiredFunction(runtimeIds, 'claim');
    const visibilityKey = requiredFunction(world, 'visibilityKey');
    const isMobVisibleToPlayer = requiredFunction(world, 'isMobVisibleToPlayer');
    const movementChase = requiredFunction(movement, 'chase');
    const movementReturnHome = requiredFunction(movement, 'returnHome');
    const movementStop = requiredFunction(movement, 'stop');
    const movementPatrol = requiredFunction(movement, 'patrol');
    const movementNoPath = optionalFunction(movement, 'onNoPath');
    const attackIntent = requiredFunction(combat, 'attackIntent');
    const canAggro = optionalFunction(combat, 'canAggro', () => true);
    const canAttack = optionalFunction(combat, 'canAttack', () => true);
    const isTargetAlive = optionalFunction(combat, 'isTargetAlive', defaultAlive);
    const externalCandidates = optionalFunction(world, 'listAggroCandidates', null);
    const externalTarget = optionalFunction(world, 'getTargetSnapshot', null);

    this.clock = clock;
    this.tickIntervalMs = tickIntervalMs;
    this.timer = null;
    this.players = new Map();
    this.playerVisibilityKeys = new Map();
    this.deathEvents = new Map();
    this.eventSink = events;
    this.loot = loot;
    this.visibilityKey = visibilityKey;

    const emit = (kind, payload) => this.#emit(kind, payload);
    const getPlayer = (id) => this.players.get(String(id)) ?? null;

    this.service = new MobCombatService(worldDefinition, {
      terrain,
      runtimeIds,
      world: {
        listAggroCandidates: (request) => {
          if (externalCandidates) return externalCandidates(request);
          return [...this.players.values()].filter((player) => player.zoneId === String(request.zoneId));
        },
        getTargetSnapshot: (id) => externalTarget ? externalTarget(id) : getPlayer(id),
        isMobVisibleToPlayer,
        onMobSpawn: (snapshot, event) => emit('mob-spawn', { snapshot, event }),
        onMobStateChange: (snapshot, event) => emit('mob-state', { snapshot, event }),
        onMobDespawn: (snapshot, event) => emit('mob-despawn', { snapshot, event }),
        onNearbyMobSpawn: (player, snapshot, event) => emit('visibility-in', { player, snapshot, event }),
        onNearbyMobDespawn: (player, snapshot, event) => emit('visibility-out', { player, snapshot, event }),
        onAssistSignal: (event) => emit('assist-signal', event),
      },
      movement: {
        chase: (intent) => { emit('movement-intent', { kind: 'CHASE', intent }); return movementChase(intent); },
        returnHome: (intent) => { emit('movement-intent', { kind: 'RETURN_HOME', intent }); return movementReturnHome(intent); },
        stop: (intent) => { emit('movement-intent', { kind: 'STOP', intent }); return movementStop(intent); },
        patrol: (intent) => { emit('movement-intent', { kind: 'PATROL', intent }); return movementPatrol(intent); },
        onNoPath: (event) => { emit('movement-no-path', event); return movementNoPath(event); },
      },
      combat: {
        isTargetAlive,
        canAggro,
        canAttack,
        attackIntent: (intent) => {
          emit('attack-intent', intent);
          return attackIntent(intent);
        },
      },
      visibility: {
        onEvent: (event) => emit('visibility-semantic', event),
      },
    });
  }

  initialize(now = 0) {
    const snapshots = this.service.initialize(requireTimestamp(now));
    return Object.freeze({
      snapshots,
      stats: this.service.stats(),
      runtimeIdentity: this.service.runtimeIdentityPolicy(),
    });
  }

  tick(now = this.clock()) {
    const started = process.hrtime.bigint();
    const snapshots = this.service.tick(requireTimestamp(now));
    const elapsedNs = process.hrtime.bigint() - started;
    return Object.freeze({ snapshots, elapsedNs, stats: this.service.stats() });
  }

  start({ setIntervalFn = setInterval } = {}) {
    if (this.timer) return this.timer;
    if (typeof setIntervalFn !== 'function') throw new TypeError('ko1298-mobs: setIntervalFn must be a function');
    this.timer = setIntervalFn(() => this.tick(this.clock()), this.tickIntervalMs);
    return this.timer;
  }

  stop({ clearIntervalFn = clearInterval } = {}) {
    if (!this.timer) return false;
    if (typeof clearIntervalFn !== 'function') throw new TypeError('ko1298-mobs: clearIntervalFn must be a function');
    clearIntervalFn(this.timer);
    this.timer = null;
    return true;
  }

  playerUpsert(player, now = this.clock()) {
    now = requireTimestamp(now);
    const snapshot = normalizePlayer(player);
    const previous = this.players.get(snapshot.id) ?? null;
    const previousKey = this.playerVisibilityKeys.get(snapshot.id) ?? null;
    const rawKey = this.visibilityKey(snapshot);
    if (rawKey === undefined || rawKey === null || String(rawKey).trim() === '') {
      throw new Error('ko1298-mobs: world.visibilityKey returned an empty key');
    }
    const nextKey = String(rawKey);

    this.players.set(snapshot.id, snapshot);
    this.playerVisibilityKeys.set(snapshot.id, nextKey);

    if (!previous) {
      return Object.freeze({ kind: 'ENTER', events: this.service.playerEnteredRegion(snapshot, now), player: snapshot });
    }

    if (previousKey !== nextKey) {
      const leave = this.service.playerLeftRegion(snapshot.id, now);
      const enter = this.service.playerEnteredRegion(snapshot, now);
      return Object.freeze({ kind: 'REGION_CHANGE', leave, enter, player: snapshot });
    }

    // MobService tracks players for visibility callbacks. P2-04 remains region/AOI
    // authority; refreshing the same visibility bucket must not synthesize OUT/IN.
    this.service.players.set(snapshot.id, snapshot);
    return Object.freeze({ kind: 'UPDATE', events: Object.freeze([]), player: snapshot });
  }

  playerDisconnected(playerId, now = this.clock()) {
    now = requireTimestamp(now);
    const id = String(playerId);
    this.players.delete(id);
    this.playerVisibilityKeys.delete(id);
    return this.service.playerDisconnected(id, now);
  }

  syncMobPosition(identifier, position, now = this.clock()) {
    const sourceIdentity = this.#sourceIdentity(identifier);
    return this.service.syncPosition(sourceIdentity, finitePosition(position, 'mob.position'), requireTimestamp(now));
  }

  reportMovementOutcome(identifier, outcome, now = this.clock()) {
    const sourceIdentity = this.#sourceIdentity(identifier);
    return this.service.reportMovementOutcome(sourceIdentity, outcome, requireTimestamp(now));
  }

  clearTarget(identifier, now = this.clock(), reason = 'external-clear') {
    const sourceIdentity = this.#sourceIdentity(identifier);
    return this.service.clearTarget(sourceIdentity, requireTimestamp(now), reason);
  }

  getNearby(query) {
    return this.service.getNearby(query);
  }

  visibilitySnapshot(identifier) {
    return this.service.visibilitySnapshot(identifier);
  }

  combatSnapshot(identifier) {
    return this.service.combatSnapshot(identifier);
  }

  applyCombatResult(identifier, result, now = this.clock(), meta = {}) {
    const applied = this.service.applyCombatResult(identifier, result, requireTimestamp(now), meta);
    if (!applied.applied || !applied.deathTransition) return applied;

    const eventId = `ko1298-mob-death:${applied.mob.runtimeId}:${applied.requestKey}`;
    if (!this.deathEvents.has(eventId)) {
      const deathEvent = freezeEvent({
        eventId,
        requestKey: applied.requestKey,
        attackerId: applied.attackerId,
        runtimeId: applied.mob.runtimeId,
        sourceIdentity: applied.mob.sourceIdentity,
        templateId: applied.mob.templateId,
        zoneId: applied.mob.zoneId,
        position: applied.mob.position,
        spawnEpoch: applied.mob.spawnEpoch,
        atMs: now,
      });
      this.#rememberDeath(eventId, deathEvent);
      optionalFunction(this.loot, 'onMobDeath')(deathEvent);
      this.#emit('mob-death', deathEvent);
      return Object.freeze({ ...applied, deathEvent });
    }
    return Object.freeze({ ...applied, deathEvent: this.deathEvents.get(eventId) });
  }

  diagnoseVisibility({ zoneId, x, z }) {
    const nearby = this.service.getNearby({ zoneId, x, z });
    const all = this.service.visibilitySnapshot();
    let nearest = null;
    for (const mob of all) {
      const dx = mob.x - x;
      const dz = mob.z - z;
      const distance2d = Math.hypot(dx, dz);
      if (!nearest || distance2d < nearest.distance2d) {
        nearest = Object.freeze({ runtimeId: mob.runtimeId, sourceIdentity: mob.sourceIdentity, name: mob.name, x: mob.x, y: mob.y, z: mob.z, distance2d });
      }
    }
    return Object.freeze({
      zoneId: String(zoneId),
      x,
      z,
      totalMaterialized: all.length,
      nearbyCount: nearby.length,
      nearest,
    });
  }

  benchmarkTicks({ iterations = 1000, startAtMs = 1_000_000, stepMs = 100 } = {}) {
    if (!Number.isInteger(iterations) || iterations < 1) throw new RangeError('ko1298-mobs: benchmark iterations must be >= 1');
    const started = process.hrtime.bigint();
    for (let i = 0; i < iterations; i += 1) this.service.tick(startAtMs + i * stepMs);
    const elapsedNs = process.hrtime.bigint() - started;
    return Object.freeze({
      iterations,
      elapsedNs,
      nsPerTick: Number(elapsedNs) / iterations,
      mobCount: this.service.stats().mobCount,
      timerModel: 'single-central-timer',
    });
  }

  #sourceIdentity(identifier) {
    return this.service.visibilitySnapshot(identifier).sourceIdentity;
  }

  #emit(kind, payload) {
    optionalFunction(this.eventSink, 'onEvent')(freezeEvent({ kind, payload }));
  }

  #rememberDeath(eventId, event) {
    if (this.deathEvents.has(eventId)) this.deathEvents.delete(eventId);
    this.deathEvents.set(eventId, event);
    while (this.deathEvents.size > DEATH_LEDGER_LIMIT) {
      this.deathEvents.delete(this.deathEvents.keys().next().value);
    }
  }
}

function createMobProductionRuntime(worldDefinition, ports) {
  return new MobProductionRuntime(worldDefinition, ports);
}

module.exports = {
  DEFAULT_TICK_MS,
  DEATH_LEDGER_LIMIT,
  MobProductionRuntime,
  createMobProductionRuntime,
  normalizePlayer,
};
