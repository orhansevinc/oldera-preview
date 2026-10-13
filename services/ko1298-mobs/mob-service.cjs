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

function createPorts(ports = {}) {
  const world = ports.world ?? {};
  const movement = ports.movement ?? {};
  const combat = ports.combat ?? {};
  return Object.freeze({
    world: Object.freeze({
      listAggroCandidates: world.listAggroCandidates ?? empty,
      getTargetSnapshot: world.getTargetSnapshot ?? none,
      onMobSpawn: world.onMobSpawn ?? noop,
      onMobStateChange: world.onMobStateChange ?? noop,
      onMobDespawn: world.onMobDespawn ?? noop,
    }),
    movement: Object.freeze({
      chase: movement.chase ?? noop,
      returnHome: movement.returnHome ?? noop,
      stop: movement.stop ?? noop,
    }),
    combat: Object.freeze({
      isTargetAlive: combat.isTargetAlive ?? yes,
      canAggro: combat.canAggro ?? yes,
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

class MobService {
  constructor(worldDefinition, ports = {}) {
    this.definition = validateWorldDefinition(worldDefinition);
    this.ports = createPorts(ports);
    this.mobs = new Map();
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
    this.initialized = true;
    for (const mob of this._orderedMobs()) {
      this.ports.world.onMobSpawn(snapshotMob(mob), Object.freeze({ type: 'initial-spawn', atMs: now }));
    }
    return this.list();
  }

  list() {
    return this._orderedMobs().map(snapshotMob);
  }

  get(mobId) {
    const mob = this.mobs.get(mobId);
    return mob ? snapshotMob(mob) : null;
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
    if (mob.state === MobState.DEAD || mob.state === MobState.DESPAWNED) return snapshotMob(mob);
    mob.position = { ...normalizePosition(position, `${mob.id}.position`) };
    mob.revision += 1;
    this._emitState(mob, 'position-synced', now);
    return snapshotMob(mob);
  }

  applyHealth(mobId, hp, now, meta = {}) {
    now = requireTimestamp(now);
    this._requireInitialized();
    const mob = this._requireMob(mobId);
    if (!Number.isFinite(hp)) throw new TypeError('ko1298-mobs: hp must be finite');
    if (mob.state === MobState.DESPAWNED) return snapshotMob(mob);

    mob.hp = Math.max(0, Math.min(mob.maxHp, Math.trunc(hp)));
    mob.revision += 1;
    if (mob.hp === 0 && mob.state !== MobState.DEAD) {
      this._die(mob, now, meta);
    } else {
      this._emitState(mob, 'health-synced', now, meta);
    }
    return snapshotMob(mob);
  }

  clearTarget(mobId, now, reason = 'external-clear') {
    now = requireTimestamp(now);
    this._requireInitialized();
    const mob = this._requireMob(mobId);
    if (mob.state !== MobState.CHASING) return snapshotMob(mob);
    this._enterIdle(mob, now, reason);
    return snapshotMob(mob);
  }

  _tickMob(mob, now) {
    const template = this.definition.templates.get(mob.templateId);

    if (mob.state === MobState.DEAD) {
      if (now >= mob.corpseDespawnAt) {
        mob.state = MobState.DESPAWNED;
        mob.revision += 1;
        this.ports.world.onMobDespawn(snapshotMob(mob), Object.freeze({ type: 'corpse-despawn', atMs: now }));
      }
      if (mob.state !== MobState.DESPAWNED) return;
    }

    if (mob.state === MobState.DESPAWNED) {
      if (now >= mob.respawnAt) this._respawn(mob, now);
      return;
    }

    if (mob.state === MobState.RETURNING) {
      if (distanceSquared(mob.position, mob.home) <= template.returnTolerance * template.returnTolerance) {
        mob.position = { ...mob.home };
        this._enterIdle(mob, now, 'home-reached');
      }
      return;
    }

    if (mob.state === MobState.CHASING) {
      if (distanceSquared(mob.position, mob.home) > template.leashRange * template.leashRange) {
        this._returnHome(mob, now, 'mob-leash-exceeded');
        return;
      }

      const target = this.ports.world.getTargetSnapshot(mob.targetId);
      if (!this._isTargetEligible(mob, target, template, { enforceAggroRange: false })) {
        this._enterIdle(mob, now, 'target-invalid');
      } else if (distanceSquared(target.position, mob.home) > template.leashRange * template.leashRange) {
        this._returnHome(mob, now, 'target-leash-exceeded');
        return;
      } else {
        return;
      }
    }

    if (mob.state === MobState.IDLE) this._acquireTarget(mob, template, now);
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
    if (eligible.length === 0) return;

    const chosen = eligible[0];
    mob.targetId = chosen.id;
    mob.state = MobState.CHASING;
    mob.revision += 1;
    this._emitState(mob, 'target-acquired', now, { targetId: chosen.id });
    this.ports.movement.chase(Object.freeze({
      mobId: mob.id,
      targetId: chosen.id,
      zoneId: mob.zoneId,
      home: Object.freeze({ ...mob.home }),
      leashRange: template.leashRange,
      atMs: now,
    }));
  }

  _isTargetEligible(mob, target, template, { enforceAggroRange }) {
    const targetId = requireTargetId(target);
    if (!targetId || !target.position || target.zoneId !== mob.zoneId) return false;
    if (![target.position.x, target.position.y, target.position.z].every(Number.isFinite)) return false;
    if (!this.ports.combat.isTargetAlive(target)) return false;
    if (!this.ports.combat.canAggro(snapshotMob(mob), target)) return false;
    if (enforceAggroRange && distanceSquared(mob.position, target.position) > template.aggroRange * template.aggroRange) {
      return false;
    }
    return true;
  }

  _returnHome(mob, now, reason) {
    const previousTargetId = mob.targetId;
    mob.targetId = null;
    mob.state = MobState.RETURNING;
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
    mob.state = MobState.IDLE;
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
    mob.corpseDespawnAt = now + template.corpseDespawnMs;
    mob.respawnAt = now + template.respawnDelayMs;
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
    mob.revision += 1;
    this.ports.world.onMobSpawn(snapshotMob(mob), Object.freeze({ type: 'respawn', atMs: now }));
  }

  _emitState(mob, type, atMs, details = {}) {
    this.ports.world.onMobStateChange(snapshotMob(mob), Object.freeze({ type, atMs, ...details }));
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
}

module.exports = { MobService };
