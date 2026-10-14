'use strict';

const { MobVisibilityService } = require('./mob-visibility-service.cjs');
const { MobState } = require('./mob-model.cjs');
const { combatAuthorityForTemplate } = require('./mob-combat-authority.cjs');

const DEAD_STATES = new Set([MobState.DEAD, MobState.CORPSE, MobState.DESPAWNED]);
const ACTIVE_COMBAT_STATES = new Set([MobState.AGGRO, MobState.CHASING, MobState.ATTACK_INTENT]);
const RESULT_LEDGER_LIMIT = 4096;

function idValue(value) {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return null;
}

function resultEnvelope(input) {
  if (!input || typeof input !== 'object') throw new TypeError('ko1298-mobs: combat result object is required');
  const inner = input.result && typeof input.result === 'object' ? input.result : input;
  return { outer: input, inner };
}

function resultRequestKey(outer, inner, meta) {
  const value = meta.requestKey ?? outer.requestKey ?? inner.requestKey;
  if (value === null || value === undefined || String(value).trim() === '') {
    throw new TypeError('ko1298-mobs: combat result requires requestKey for idempotency');
  }
  return String(value);
}

function resultAttackerId(outer, inner, meta) {
  const value = meta.sourceId ?? meta.attackerId ?? outer.attackerId ?? inner.attackerId;
  const id = idValue(value);
  if (!id) throw new TypeError('ko1298-mobs: combat result requires authoritative attacker/source identity');
  return id;
}

function resultAbsoluteHp(outer) {
  const value = outer.absoluteTargetHp ?? outer.absoluteHp;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError('ko1298-mobs: combat result requires non-negative integer absoluteTargetHp/absoluteHp');
  }
  return value;
}

function isAliveMob(mob) {
  return mob.hp > 0 && !DEAD_STATES.has(mob.state);
}

class MobCombatService extends MobVisibilityService {
  constructor(worldDefinition, ports = {}) {
    const originalWorld = ports.world ?? {};
    const originalCombat = ports.combat ?? {};
    let service = null;

    const wrappedWorld = {
      ...originalWorld,
      onMobStateChange: (snapshot, event) => {
        if (typeof originalWorld.onMobStateChange === 'function') originalWorld.onMobStateChange(snapshot, event);
        if (service) service._emitSemanticCombatState(snapshot, event);
      },
    };

    const wrappedCombat = {
      ...originalCombat,
      attackIntent: (intent) => {
        const enriched = service ? service._enrichAttackIntent(intent) : intent;
        if (typeof originalCombat.attackIntent === 'function') originalCombat.attackIntent(enriched);
      },
    };

    super(worldDefinition, { ...ports, world: wrappedWorld, combat: wrappedCombat });
    service = this;
    this.appliedCombatResults = new Map();
  }

  combatSnapshots() {
    this._requireInitialized();
    this._requireRuntimeIdentityReady();
    return Object.freeze(this._orderedMobs().map((mob) => this._combatSnapshotForMob(mob)));
  }

  combatSnapshot(identifier) {
    if (identifier === undefined) return this.combatSnapshots();
    this._requireInitialized();
    this._requireRuntimeIdentityReady();
    return this._combatSnapshotForMob(this._resolveMob(identifier));
  }

  getCombatSnapshot(identifier) {
    return this.combatSnapshot(identifier);
  }

  applyHealth(identifier, hp, now, meta = {}) {
    now = this._combatTimestamp(now);
    this._requireInitialized();
    const mob = this._resolveMob(identifier);
    if (!Number.isFinite(hp)) throw new TypeError('ko1298-mobs: hp must be finite');
    if (DEAD_STATES.has(mob.state)) return this._attachRuntimeIdentity(super.get(mob.id));

    const absoluteHp = Math.max(0, Math.min(mob.maxHp, Math.trunc(hp)));
    if (absoluteHp === 0) {
      this._die(mob, now, meta);
    } else {
      mob.hp = absoluteHp;
      mob.revision += 1;
      this._emitState(mob, 'health-synced', now, meta);
    }
    return this._attachRuntimeIdentity(super.get(mob.id));
  }

  applyDamage(identifier, combatResult, now, meta = {}) {
    return this.applyCombatResult(identifier, combatResult, now, meta);
  }

  applyCombatResult(identifier, combatResult, now, meta = {}) {
    now = this._combatTimestamp(now);
    this._requireInitialized();
    const mob = this._resolveMob(identifier);
    const { outer, inner } = resultEnvelope(combatResult);

    if (outer.ok === false || inner.ok === false) {
      return Object.freeze({
        applied: false,
        duplicate: false,
        reason: 'COMBAT_REJECTED',
        mob: this._combatSnapshotForMob(mob),
      });
    }

    const requestKey = resultRequestKey(outer, inner, meta);
    const attackerId = resultAttackerId(outer, inner, meta);
    const absoluteHp = resultAbsoluteHp(outer);
    if (absoluteHp > mob.maxHp) {
      throw new RangeError(`ko1298-mobs: absolute HP ${absoluteHp} exceeds maxHP ${mob.maxHp} for ${mob.id}`);
    }

    const suppliedTarget = outer.targetId ?? inner.targetId ?? meta.targetId;
    if (suppliedTarget !== undefined && suppliedTarget !== null) {
      const accepted = new Set([String(mob.id)]);
      if (Number.isInteger(mob.runtimeId)) accepted.add(String(mob.runtimeId));
      if (!accepted.has(String(suppliedTarget))) {
        throw new RangeError(`ko1298-mobs: combat result target ${suppliedTarget} does not match ${mob.id}`);
      }
    }

    const ledgerKey = `${attackerId}:${requestKey}:${mob.id}`;
    if (this.appliedCombatResults.has(ledgerKey)) {
      return Object.freeze({
        applied: false,
        duplicate: true,
        reason: 'DUPLICATE_COMBAT_RESULT',
        requestKey,
        attackerId,
        mob: this._combatSnapshotForMob(mob),
      });
    }

    if (!isAliveMob(mob)) {
      return Object.freeze({
        applied: false,
        duplicate: false,
        reason: 'MOB_NOT_ATTACKABLE',
        requestKey,
        attackerId,
        mob: this._combatSnapshotForMob(mob),
      });
    }

    const previousHp = mob.hp;
    this._rememberCombatResult(ledgerKey, Object.freeze({ requestKey, attackerId, absoluteHp, atMs: now }));

    if (absoluteHp === 0) {
      this._die(mob, now, {
        ...meta,
        requestKey,
        attackerId,
        ws19DeathEvent: outer.deathEvent ?? inner.deathEvent ?? null,
      });
      return Object.freeze({
        applied: true,
        duplicate: false,
        requestKey,
        attackerId,
        previousHp,
        absoluteHp: 0,
        deathTransition: true,
        mob: this._combatSnapshotForMob(mob),
      });
    }

    mob.hp = absoluteHp;
    let retaliation = false;
    if (absoluteHp < previousHp) retaliation = this._retaliateToAttacker(mob, attackerId);
    mob.revision += 1;
    this._emitState(mob, retaliation ? 'combat-hit-retaliate' : 'combat-health-synced', now, {
      ...meta,
      requestKey,
      attackerId,
      previousHp,
      absoluteHp,
      retaliation,
    });

    return Object.freeze({
      applied: true,
      duplicate: false,
      requestKey,
      attackerId,
      previousHp,
      absoluteHp,
      deathTransition: false,
      retaliation,
      mob: this._combatSnapshotForMob(mob),
    });
  }

  playerEnteredRegion(player, now) {
    const events = super.playerEnteredRegion(player, now);
    this._cleanupInvisibleTargets(this._combatTimestamp(now), 'player-region-crossing');
    return events;
  }

  playerLeftRegion(playerId, now) {
    now = this._combatTimestamp(now);
    this._clearTargetsForPlayer(String(playerId), now, 'player-left-region');
    return super.playerLeftRegion(playerId, now);
  }

  playerDisconnected(playerId, now) {
    now = this._combatTimestamp(now);
    this._clearTargetsForPlayer(String(playerId), now, 'player-disconnect');
    return super.playerLeftRegion(playerId, now);
  }

  syncPosition(identifier, position, now) {
    const result = super.syncPosition(identifier, position, now);
    const mob = this._resolveMob(identifier);
    this._cleanupMobTargetVisibility(mob, this._combatTimestamp(now), 'mob-left-target-visibility');
    return result;
  }

  tick(now) {
    now = this._combatTimestamp(now);
    this._cleanupInvisibleTargets(now, 'target-out-of-view');
    return super.tick(now);
  }

  _combatSnapshotForMob(mob) {
    if (![mob.position.x, mob.position.y, mob.position.z].every(Number.isFinite)) {
      throw new Error(`ko1298-mobs: ${mob.id} has no authoritative finite XYZ for combat`);
    }
    const template = this.definition.templates.get(mob.templateId);
    const authority = combatAuthorityForTemplate(template);
    const source = authority.sourceFields;
    const runtimeId = this.runtimeBySource.get(mob.id);
    if (!Number.isInteger(runtimeId)) throw new Error(`ko1298-mobs: ${mob.id} has no authoritative runtimeId`);
    const alive = isAliveMob(mob);

    const defense = Object.freeze({
      ac: source.sAc,
      evasionRate: source.sEvadeRate,
      sourceFields: Object.freeze({ sAc: source.sAc, sEvadeRate: source.sEvadeRate }),
      sourceRef: authority.sourceRef,
    });
    const attack = Object.freeze({
      attack: source.sAtk,
      hitRate: source.sHitRate,
      baseDamage: source.sDamage,
      attackDelayMs: source.sAttackDelay,
      attackRange: source.byAttackRange,
      searchRange: source.bySearchRange,
      tracingRange: source.byTracingRange,
      directAttack: source.byDirectAttack,
      magicAttack: source.byMagicAttack,
      sourceFields: Object.freeze({
        sAtk: source.sAtk,
        sHitRate: source.sHitRate,
        sDamage: source.sDamage,
        sAttackDelay: source.sAttackDelay,
        byAttackRange: source.byAttackRange,
        bySearchRange: source.bySearchRange,
        byTracingRange: source.byTracingRange,
        byDirectAttack: source.byDirectAttack,
        byMagicAttack: source.byMagicAttack,
      }),
      sourceRef: authority.sourceRef,
    });

    return Object.freeze({
      id: runtimeId,
      runtimeId,
      instanceId: runtimeId,
      sourceIdentity: mob.id,
      templateId: mob.templateId,
      groupId: mob.groupId,
      spawnId: mob.spawnId,
      zone: mob.zoneId,
      zoneId: mob.zoneId,
      position: Object.freeze({ ...mob.position }),
      home: Object.freeze({ ...mob.home }),
      state: mob.state,
      lifeState: alive ? 'ALIVE' : 'DEAD',
      level: authority.level,
      hp: mob.hp,
      maxHp: mob.maxHp,
      mp: source.sMpPoint,
      defense,
      attack,
      combat: Object.freeze({
        ac: source.sAc,
        evasionRate: source.sEvadeRate,
        hitRate: source.sHitRate,
        sourceAttack: attack,
      }),
      alive,
      targetable: alive,
      attackable: alive,
      targetId: mob.targetId,
      revision: mob.revision,
      spawnEpoch: mob.spawnEpoch,
      sourceRefs: Object.freeze({
        spawn: mob.sourceRef,
        template: template.sourceRef,
        combat: authority.sourceRef,
      }),
    });
  }

  _retaliateToAttacker(mob, attackerId) {
    const template = this.definition.templates.get(mob.templateId);
    const target = this.ports.world.getTargetSnapshot(attackerId);
    if (!this._isTargetEligible(mob, target, template, { enforceAggroRange: false })) return false;
    const tracked = this.players.get(attackerId);
    if (tracked && !this.ports.world.isMobVisibleToPlayer(tracked, this.get(mob.id))) return false;
    mob.targetId = attackerId;
    mob.state = MobState.AGGRO;
    mob.lastAttackIntentAt = null;
    mob.stuckCount = 0;
    return true;
  }

  _enrichAttackIntent(intent) {
    const mob = this._resolveMob(intent.mobId);
    const template = this.definition.templates.get(mob.templateId);
    if (template.dataClass !== 'real') return intent;
    const authority = combatAuthorityForTemplate(template);
    const source = authority.sourceFields;
    const runtimeId = this.runtimeBySource.get(mob.id);
    return Object.freeze({
      ...intent,
      runtimeId,
      instanceId: runtimeId,
      sourceIdentity: mob.id,
      templateId: mob.templateId,
      position: Object.freeze({ ...mob.position }),
      sourceAttack: Object.freeze({
        sAtk: source.sAtk,
        sHitRate: source.sHitRate,
        sDamage: source.sDamage,
        sAttackDelay: source.sAttackDelay,
        byAttackRange: source.byAttackRange,
        byDirectAttack: source.byDirectAttack,
        byMagicAttack: source.byMagicAttack,
        sourceRef: authority.sourceRef,
      }),
    });
  }

  _emitSemanticCombatState(snapshot, event) {
    if (typeof this.visibilityPort?.onEvent !== 'function') return;
    if (!Number.isInteger(snapshot?.runtimeId)) return;
    if (event?.type !== 'dead' && event?.type !== 'corpse') return;
    const alive = snapshot.hp > 0 && !DEAD_STATES.has(snapshot.state);
    this.visibilityPort.onEvent(Object.freeze({
      type: 'STATE',
      semantic: event.type === 'dead' ? 'DEATH' : 'CORPSE',
      runtimeId: snapshot.runtimeId,
      instanceId: snapshot.runtimeId,
      sourceIdentity: snapshot.sourceIdentity,
      zoneId: snapshot.zoneId,
      state: snapshot.state,
      lifeState: alive ? 'ALIVE' : 'DEAD',
      hp: snapshot.hp,
      alive,
      targetable: alive,
      attackable: alive,
      reason: event.type,
      atMs: event.atMs ?? null,
      spawnEpoch: snapshot.spawnEpoch,
    }));
  }

  _cleanupInvisibleTargets(now, reason) {
    for (const mob of this._orderedMobs()) this._cleanupMobTargetVisibility(mob, now, reason);
  }

  _cleanupMobTargetVisibility(mob, now, reason) {
    if (!ACTIVE_COMBAT_STATES.has(mob.state) || !mob.targetId) return false;
    const player = this.players.get(String(mob.targetId));
    if (!player) return false;
    if (this.ports.world.isMobVisibleToPlayer(player, this.get(mob.id))) return false;
    super.clearTarget(mob.id, now, reason);
    return true;
  }

  _clearTargetsForPlayer(playerId, now, reason) {
    for (const mob of this._orderedMobs()) {
      if (!ACTIVE_COMBAT_STATES.has(mob.state)) continue;
      if (String(mob.targetId) !== String(playerId)) continue;
      super.clearTarget(mob.id, now, reason);
    }
  }

  _rememberCombatResult(key, value) {
    if (this.appliedCombatResults.has(key)) this.appliedCombatResults.delete(key);
    this.appliedCombatResults.set(key, value);
    while (this.appliedCombatResults.size > RESULT_LEDGER_LIMIT) {
      this.appliedCombatResults.delete(this.appliedCombatResults.keys().next().value);
    }
  }

  _combatTimestamp(now) {
    if (!Number.isFinite(now) || now < 0) throw new TypeError('ko1298-mobs: timestamp must be a finite number >= 0');
    return now;
  }
}

module.exports = { MobCombatService };
