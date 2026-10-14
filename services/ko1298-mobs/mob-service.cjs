'use strict';

const {
  MobState,
  createMobInstance,
  distanceSquared,
  normalizePosition,
  snapshotMob,
  validateWorldDefinition,
} = require('./mob-model.cjs');

function noop() {}
function yes() { return true; }
function empty() { return []; }
function none() { return null; }
function invisible() { return false; }

function createPorts(ports = {}) {
  const world = ports.world ?? {};
  const movement = ports.movement ?? {};
  const combat = ports.combat ?? {};
  return Object.freeze({
    world: Object.freeze({
      listAggroCandidates: world.listAggroCandidates ?? empty,
      getTargetSnapshot: world.getTargetSnapshot ?? none,
      resolveSpawnPosition: world.resolveSpawnPosition ?? none,
      isMobVisibleToPlayer: world.isMobVisibleToPlayer ?? invisible,
      onMobSpawn: world.onMobSpawn ?? noop,
      onMobStateChange: world.onMobStateChange ?? noop,
      onMobDespawn: world.onMobDespawn ?? noop,
      onNearbyMobSpawn: world.onNearbyMobSpawn ?? noop,
      onNearbyMobDespawn: world.onNearbyMobDespawn ?? noop,
      onAssistSignal: world.onAssistSignal ?? noop,
    }),
    movement: Object.freeze({
      chase: movement.chase ?? noop,
      returnHome: movement.returnHome ?? noop,
      stop: movement.stop ?? noop,
      patrol: movement.patrol ?? noop,
      onNoPath: movement.onNoPath ?? noop,
    }),
    combat: Object.freeze({
      isTargetAlive: combat.isTargetAlive ?? yes,
      canAggro: combat.canAggro ?? yes,
      canAttack: combat.canAttack ?? yes,
      attackIntent: combat.attackIntent ?? noop,
    }),
  });
}

function requireTimestamp(now) {
  if (!Number.isFinite(now) || now < 0) throw new TypeError('ko1298-mobs: timestamp must be a finite number >= 0');
  return now;
}

function requireTargetId(target) {
  if (!target || (typeof target.id !== 'string' && typeof target.id !== 'number')) return null;
  return String(target.id);
}

function playerIdOf(player) {
  if (!player || (typeof player.id !== 'string' && typeof player.id !== 'number')) return null;
  return String(player.id);
}

class MobService {
  constructor(worldDefinition, ports = {}) {
    this.definition = validateWorldDefinition(worldDefinition);
    this.ports = createPorts(ports);
    this.mobs = new Map();
    this.players = new Map();
    this.initialized = false;

    for (const group of this.definition.spawnGroups) {
      const template = this.definition.templates.get(group.templateId);
      for (const spawn of group.spawns) {
        const mob = createMobInstance(this.definition.zoneId, group, spawn, template);
        this.mobs.set(mob.id, mob);
      }
    }
  }

  initialize(now = 0) {
    now = requireTimestamp(now);
    if (this.initialized) return this.list();
    for (const mob of this._orderedMobs()) this._resolveInitialPosition(mob, now);
    this.initialized = true;
    for (const mob of this._orderedMobs()) this._emitSpawn(mob, 'initial-spawn', now);
    return this.list();
  }

  list() {
    return this._orderedMobs().map(snapshotMob);
  }

  get(mobId) {
    const mob = this.mobs.get(mobId);
    return mob ? snapshotMob(mob) : null;
  }

  stats() {
    const states = {};
    for (const mob of this.mobs.values()) states[mob.state] = (states[mob.state] ?? 0) + 1;
    return Object.freeze({ mobCount: this.mobs.size, trackedPlayers: this.players.size, states: Object.freeze(states) });
  }

  tick(now) {
    now = requireTimestamp(now);
    this._requireInitialized();
    for (const mob of this._orderedMobs()) this._tickMob(mob, now);
    return this.list();
  }

  syncPosition(mobId, position, now) {
    now = requireTimestamp(now);
    this._requireInitialized();
    const mob = this._requireMob(mobId);
    if ([MobState.DEAD, MobState.CORPSE, MobState.DESPAWNED].includes(mob.state)) return snapshotMob(mob);
    const before = snapshotMob(mob);
    mob.position = { ...normalizePosition(position, `${mob.id}.position`) };
    mob.stuckCount = 0;
    mob.revision += 1;
    this._emitState(mob, 'position-synced', now);
    this._emitVisibilityDelta(before, snapshotMob(mob), now);
    return snapshotMob(mob);
  }

  reportMovementOutcome(mobId, outcome, now) {
    now = requireTimestamp(now);
    this._requireInitialized();
    const mob = this._requireMob(mobId);
    if (!['progress', 'stuck', 'no-path'].includes(outcome)) throw new TypeError('ko1298-mobs: movement outcome must be progress|stuck|no-path');
    const template = this.definition.templates.get(mob.templateId);
    if (outcome === 'progress') {
      mob.stuckCount = 0;
      return snapshotMob(mob);
    }
    if (outcome === 'stuck') {
      mob.stuckCount += 1;
      this._emitState(mob, 'movement-stuck', now, { stuckCount: mob.stuckCount });
      if (mob.stuckCount >= template.stuckThreshold && [MobState.AGGRO, MobState.CHASING, MobState.ATTACK_INTENT].includes(mob.state)) {
        this._returnHome(mob, now, 'stuck-threshold');
      }
      return snapshotMob(mob);
    }

    this.ports.movement.onNoPath(Object.freeze({ mobId: mob.id, zoneId: mob.zoneId, state: mob.state, atMs: now }));
    this._emitState(mob, 'no-path', now);
    if ([MobState.AGGRO, MobState.CHASING, MobState.ATTACK_INTENT].includes(mob.state)) this._returnHome(mob, now, 'no-path');
    return snapshotMob(mob);
  }

  applyHealth(mobId, hp, now, meta = {}) {
    now = requireTimestamp(now);
    this._requireInitialized();
    const mob = this._requireMob(mobId);
    if (!Number.isFinite(hp)) throw new TypeError('ko1298-mobs: hp must be finite');
    if ([MobState.CORPSE, MobState.DESPAWNED].includes(mob.state)) return snapshotMob(mob);

    mob.hp = Math.max(0, Math.min(mob.maxHp, Math.trunc(hp)));
    mob.revision += 1;
    if (mob.hp === 0 && mob.state !== MobState.DEAD) {
      this._die(mob, now, meta);
    } else if (mob.state !== MobState.DEAD) {
      this._emitState(mob, 'health-synced', now, meta);
    }
    return snapshotMob(mob);
  }

  clearTarget(mobId, now, reason = 'external-clear') {
    now = requireTimestamp(now);
    this._requireInitialized();
    const mob = this._requireMob(mobId);
    if (![MobState.AGGRO, MobState.CHASING, MobState.ATTACK_INTENT].includes(mob.state)) return snapshotMob(mob);
    if (this._isHome(mob)) this._enterIdle(mob, now, reason);
    else this._returnHome(mob, now, reason);
    return snapshotMob(mob);
  }

  playerEnteredRegion(player, now) {
    now = requireTimestamp(now);
    this._requireInitialized();
    const id = playerIdOf(player);
    if (!id) throw new TypeError('ko1298-mobs: player.id is required');
    if (String(player.zoneId) !== this.definition.zoneId) return [];
    const snapshot = Object.freeze({ ...player, id, zoneId: String(player.zoneId) });
    this.players.set(id, snapshot);
    const events = [];
    for (const mob of this._orderedMobs()) {
      if (!this._isWorldVisibleState(mob.state)) continue;
      if (!this.ports.world.isMobVisibleToPlayer(snapshot, snapshotMob(mob))) continue;
      const event = Object.freeze({ type: 'nearby-spawn', reason: 'player-enter-region', playerId: id, atMs: now });
      this.ports.world.onNearbyMobSpawn(snapshot, snapshotMob(mob), event);
      events.push({ playerId: id, mobId: mob.id, type: 'spawn' });
    }
    return Object.freeze(events);
  }

  playerLeftRegion(playerId, now) {
    now = requireTimestamp(now);
    this._requireInitialized();
    const id = String(playerId);
    const player = this.players.get(id);
    if (!player) return [];
    const events = [];
    for (const mob of this._orderedMobs()) {
      if (!this._isWorldVisibleState(mob.state)) continue;
      if (!this.ports.world.isMobVisibleToPlayer(player, snapshotMob(mob))) continue;
      const event = Object.freeze({ type: 'nearby-despawn', reason: 'player-leave-region', playerId: id, atMs: now });
      this.ports.world.onNearbyMobDespawn(player, snapshotMob(mob), event);
      events.push({ playerId: id, mobId: mob.id, type: 'despawn' });
    }
    this.players.delete(id);
    return Object.freeze(events);
  }

  _tickMob(mob, now) {
    const template = this.definition.templates.get(mob.templateId);

    if (mob.state === MobState.DEAD) {
      mob.state = MobState.CORPSE;
      mob.revision += 1;
      this._emitState(mob, 'corpse', now);
    }

    if (mob.state === MobState.CORPSE) {
      if (now >= mob.corpseDespawnAt) {
        mob.state = MobState.DESPAWNED;
        mob.revision += 1;
        this._emitDespawn(mob, 'corpse-despawn', now);
        return;
      }
      return;
    }

    if (mob.state === MobState.DESPAWNED) {
      if (now >= mob.respawnAt) this._respawn(mob, now);
      return;
    }

    if (mob.state === MobState.RETURNING) {
      if (this._isHome(mob)) {
        mob.position = { ...mob.home };
        this._enterIdle(mob, now, 'home-reached');
      }
      return;
    }

    if ([MobState.AGGRO, MobState.CHASING, MobState.ATTACK_INTENT].includes(mob.state)) {
      if (distanceSquared(mob.position, mob.home) > template.leashRange * template.leashRange) {
        this._returnHome(mob, now, 'mob-leash-exceeded');
        return;
      }
      const target = this.ports.world.getTargetSnapshot(mob.targetId);
      if (!this._isTargetEligible(mob, target, template, { enforceAggroRange: false })) {
        if (this._isHome(mob)) this._enterIdle(mob, now, 'target-invalid');
        else this._returnHome(mob, now, 'target-invalid');
        return;
      }
      if (distanceSquared(target.position, mob.home) > template.leashRange * template.leashRange) {
        this._returnHome(mob, now, 'target-leash-exceeded');
        return;
      }
      this._engageTarget(mob, target, template, now);
      return;
    }

    if (mob.state === MobState.IDLE || mob.state === MobState.PATROLLING) {
      if (this._acquireTarget(mob, template, now)) return;
      if (mob.state === MobState.IDLE && mob.patrolPath.length > 0) {
        mob.state = MobState.PATROLLING;
        mob.revision += 1;
        this._emitState(mob, 'patrol-intent', now);
        this.ports.movement.patrol(Object.freeze({ mobId: mob.id, zoneId: mob.zoneId, path: mob.patrolPath, atMs: now }));
      }
    }
  }

  _acquireTarget(mob, template, now) {
    const raw = this.ports.world.listAggroCandidates(Object.freeze({
      mob: snapshotMob(mob),
      zoneId: mob.zoneId,
      origin: Object.freeze({ ...mob.position }),
      range: template.aggroRange,
      atMs: now,
    }));
    const candidates = Array.isArray(raw) ? raw : [];
    const eligible = [];
    for (const target of candidates) {
      if (!this._isTargetEligible(mob, target, template, { enforceAggroRange: true })) continue;
      eligible.push({ target, id: requireTargetId(target), distance2: distanceSquared(mob.position, target.position) });
    }
    eligible.sort((a, b) => a.distance2 - b.distance2 || a.id.localeCompare(b.id));
    if (eligible.length === 0) return false;

    const chosen = eligible[0];
    mob.targetId = chosen.id;
    mob.state = MobState.AGGRO;
    mob.lastAttackIntentAt = null;
    mob.revision += 1;
    this._emitState(mob, 'aggro', now, { targetId: chosen.id });
    this._emitAssistSignal(mob, chosen.id, template, now);
    this._engageTarget(mob, chosen.target, template, now);
    return true;
  }

  _engageTarget(mob, target, template, now) {
    const d2 = distanceSquared(mob.position, target.position);
    if (d2 <= template.attackRange * template.attackRange && this.ports.combat.canAttack(snapshotMob(mob), target)) {
      const stateChanged = mob.state !== MobState.ATTACK_INTENT;
      if (stateChanged) {
        mob.state = MobState.ATTACK_INTENT;
        mob.revision += 1;
        this.ports.movement.stop(Object.freeze({ mobId: mob.id, atMs: now, reason: 'attack-range' }));
        this._emitState(mob, 'attack-intent', now, { targetId: mob.targetId });
      }
      if (mob.lastAttackIntentAt === null || now - mob.lastAttackIntentAt >= template.attackDelayMs) {
        mob.lastAttackIntentAt = now;
        this.ports.combat.attackIntent(Object.freeze({
          mobId: mob.id,
          targetId: mob.targetId,
          zoneId: mob.zoneId,
          attackRange: template.attackRange,
          sourceAttackDelayMs: template.attackDelayMs,
          atMs: now,
        }));
      }
      return;
    }

    if (mob.state !== MobState.CHASING) {
      mob.state = MobState.CHASING;
      mob.revision += 1;
      this._emitState(mob, 'chase', now, { targetId: mob.targetId });
      this.ports.movement.chase(Object.freeze({
        mobId: mob.id,
        targetId: mob.targetId,
        zoneId: mob.zoneId,
        home: Object.freeze({ ...mob.home }),
        leashRange: template.leashRange,
        atMs: now,
      }));
    }
  }

  _isTargetEligible(mob, target, template, { enforceAggroRange }) {
    const targetId = requireTargetId(target);
    if (!targetId || !target.position || String(target.zoneId) !== mob.zoneId) return false;
    if (![target.position.x, target.position.y, target.position.z].every(Number.isFinite)) return false;
    if (!this.ports.combat.isTargetAlive(target)) return false;
    if (!this.ports.combat.canAggro(snapshotMob(mob), target)) return false;
    if (enforceAggroRange && distanceSquared(mob.position, target.position) > template.aggroRange * template.aggroRange) return false;
    return true;
  }

  _returnHome(mob, now, reason) {
    if ([MobState.DEAD, MobState.CORPSE, MobState.DESPAWNED].includes(mob.state)) return;
    const previousTargetId = mob.targetId;
    mob.targetId = null;
    mob.lastAttackIntentAt = null;
    mob.state = MobState.RETURNING;
    mob.stuckCount = 0;
    mob.revision += 1;
    this._emitState(mob, 'return-home', now, { reason, previousTargetId });
    this.ports.movement.returnHome(Object.freeze({
      mobId: mob.id,
      zoneId: mob.zoneId,
      home: Object.freeze({ ...mob.home }),
      atMs: now,
      reason,
    }));
  }

  _enterIdle(mob, now, reason) {
    const previousTargetId = mob.targetId;
    mob.targetId = null;
    mob.lastAttackIntentAt = null;
    mob.state = MobState.IDLE;
    mob.stuckCount = 0;
    mob.revision += 1;
    this.ports.movement.stop(Object.freeze({ mobId: mob.id, atMs: now, reason }));
    this._emitState(mob, 'idle', now, { reason, previousTargetId });
  }

  _die(mob, now, meta) {
    const template = this.definition.templates.get(mob.templateId);
    const previousTargetId = mob.targetId;
    mob.hp = 0;
    mob.targetId = null;
    mob.state = MobState.DEAD;
    mob.diedAt = now;
    mob.corpseDespawnAt = now + mob.corpseDespawnMs;
    mob.respawnAt = now + mob.respawnDelayMs;
    mob.lastAttackIntentAt = null;
    mob.revision += 1;
    this.ports.movement.stop(Object.freeze({ mobId: mob.id, atMs: now, reason: 'dead' }));
    this._emitState(mob, 'dead', now, { ...meta, previousTargetId });
  }

  _respawn(mob, now) {
    mob.state = MobState.IDLE;
    mob.hp = mob.maxHp;
    mob.position = { ...mob.home };
    mob.targetId = null;
    mob.diedAt = null;
    mob.corpseDespawnAt = null;
    mob.respawnAt = null;
    mob.spawnEpoch += 1;
    mob.lastAttackIntentAt = null;
    mob.stuckCount = 0;
    mob.revision += 1;
    this._emitSpawn(mob, 'respawn', now);
  }

  _resolveInitialPosition(mob, now) {
    if (Number.isFinite(mob.position.y)) return;
    const resolved = this.ports.world.resolveSpawnPosition(Object.freeze({
      mobId: mob.id,
      zoneId: mob.zoneId,
      x: mob.position.x,
      z: mob.position.z,
      heading: mob.position.heading,
      sourceArea: mob.sourceArea,
      sourceRef: mob.sourceRef,
      atMs: now,
    }));
    if (!resolved || ![resolved.x, resolved.y, resolved.z].every(Number.isFinite)) {
      throw new Error(`ko1298-mobs: real spawn ${mob.id} requires authoritative height/position resolver`);
    }
    mob.position = { ...normalizePosition({ ...resolved, heading: resolved.heading ?? mob.position.heading }, `${mob.id}.resolvedPosition`) };
    mob.home = { ...mob.position };
  }

  _emitAssistSignal(mob, targetId, template, atMs) {
    const group = template.metadata.group;
    const family = template.metadata.family;
    if (!Number.isInteger(group) || !Number.isInteger(family)) return;
    this.ports.world.onAssistSignal(Object.freeze({
      mobId: mob.id,
      targetId,
      zoneId: mob.zoneId,
      group,
      family,
      searchRange: template.aggroRange,
      origin: Object.freeze({ ...mob.position }),
      atMs,
      source: 'OpenKO-AIServer-FindFriend-type0',
    }));
  }

  _emitSpawn(mob, type, atMs) {
    const snap = snapshotMob(mob);
    const event = Object.freeze({ type, atMs, spawnEpoch: mob.spawnEpoch });
    this.ports.world.onMobSpawn(snap, event);
    for (const player of this._orderedPlayers()) {
      if (!this.ports.world.isMobVisibleToPlayer(player, snap)) continue;
      this.ports.world.onNearbyMobSpawn(player, snap, Object.freeze({ type: 'nearby-spawn', reason: type, atMs, playerId: player.id }));
    }
  }

  _emitDespawn(mob, type, atMs) {
    const snap = snapshotMob(mob);
    const event = Object.freeze({ type, atMs, spawnEpoch: mob.spawnEpoch });
    this.ports.world.onMobDespawn(snap, event);
    for (const player of this._orderedPlayers()) {
      if (!this.ports.world.isMobVisibleToPlayer(player, snap)) continue;
      this.ports.world.onNearbyMobDespawn(player, snap, Object.freeze({ type: 'nearby-despawn', reason: type, atMs, playerId: player.id }));
    }
  }

  _emitVisibilityDelta(before, after, atMs) {
    for (const player of this._orderedPlayers()) {
      const beforeVisible = this._isWorldVisibleState(before.state) && this.ports.world.isMobVisibleToPlayer(player, before);
      const afterVisible = this._isWorldVisibleState(after.state) && this.ports.world.isMobVisibleToPlayer(player, after);
      if (beforeVisible === afterVisible) continue;
      if (afterVisible) this.ports.world.onNearbyMobSpawn(player, after, Object.freeze({ type: 'nearby-spawn', reason: 'mob-enter-visibility', atMs, playerId: player.id }));
      else this.ports.world.onNearbyMobDespawn(player, before, Object.freeze({ type: 'nearby-despawn', reason: 'mob-leave-visibility', atMs, playerId: player.id }));
    }
  }

  _emitState(mob, type, atMs, details = {}) {
    this.ports.world.onMobStateChange(snapshotMob(mob), Object.freeze({ type, atMs, ...details }));
  }

  _isHome(mob) {
    const template = this.definition.templates.get(mob.templateId);
    return distanceSquared(mob.position, mob.home) <= template.returnTolerance * template.returnTolerance;
  }

  _isWorldVisibleState(state) {
    return state !== MobState.DESPAWNED;
  }

  _requireInitialized() {
    if (!this.initialized) throw new Error('ko1298-mobs: initialize() must be called first');
  }

  _requireMob(mobId) {
    const mob = this.mobs.get(mobId);
    if (!mob) throw new RangeError(`ko1298-mobs: unknown mob ${mobId}`);
    return mob;
  }

  _orderedMobs() {
    return [...this.mobs.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  _orderedPlayers() {
    return [...this.players.values()].sort((a, b) => a.id.localeCompare(b.id));
  }
}

module.exports = { MobService };
