'use strict';

const { rollHitOutcome } = require('./hit-rate');

const LIFE_STATE = Object.freeze({ ALIVE: 'ALIVE', DEAD: 'DEAD' });

function createCombatant({ id, hp, maxHp, mp = 0, maxMp = 0, stats, combat, classId, level, skillPoints = {} }) {
  if (!id) throw new TypeError('id is required');
  if (!Number.isFinite(maxHp) || maxHp < 1) throw new RangeError('maxHp must be >= 1');
  const boundedHp = Math.max(0, Math.min(maxHp, hp));
  return {
    id,
    classId,
    level,
    stats,
    combat: { ...combat },
    hp: boundedHp,
    maxHp,
    mp: Math.max(0, Math.min(maxMp, mp)),
    maxMp,
    skillPoints: { ...skillPoints },
    lifeState: boundedHp === 0 ? LIFE_STATE.DEAD : LIFE_STATE.ALIVE,
  };
}

function applyHpDelta(entity, amount, { allowRevive = false } = {}) {
  if (!Number.isFinite(amount)) throw new TypeError('HP delta must be finite');
  const before = entity.hp;
  const wasAlive = entity.lifeState === LIFE_STATE.ALIVE;

  // Death is sticky. Source code has explicit regeneration/resurrection paths; a generic HP heal must not revive.
  if (!wasAlive && amount > 0 && !allowRevive) {
    return Object.freeze({ before, after: before, deltaApplied: 0, died: false, blockedByDeathState: true });
  }

  entity.hp = Math.max(0, Math.min(entity.maxHp, entity.hp + Math.trunc(amount)));
  if (wasAlive && entity.hp === 0) entity.lifeState = LIFE_STATE.DEAD;
  else if (!wasAlive && allowRevive && entity.hp > 0) entity.lifeState = LIFE_STATE.ALIVE;

  return Object.freeze({ before, after: entity.hp, deltaApplied: entity.hp - before, died: wasAlive && entity.lifeState === LIFE_STATE.DEAD });
}

class CombatService {
  constructor({ damagePolicy, rangeValidator, rng = Math.random, requireRangeValidation = true } = {}) {
    if (!damagePolicy || typeof damagePolicy.resolve !== 'function') throw new TypeError('damagePolicy.resolve is required');
    this.damagePolicy = damagePolicy;
    this.rangeValidator = rangeValidator;
    this.rng = rng;
    this.requireRangeValidation = requireRangeValidation;
  }

  normalAttack(attacker, target, context = {}) {
    if (attacker.lifeState !== LIFE_STATE.ALIVE || attacker.hp <= 0) return Object.freeze({ ok: false, reason: 'ATTACKER_DEAD' });
    if (target.lifeState !== LIFE_STATE.ALIVE || target.hp <= 0) return Object.freeze({ ok: false, reason: 'TARGET_DEAD' });

    if (!this.rangeValidator) {
      if (this.requireRangeValidation) return Object.freeze({ ok: false, reason: 'RANGE_VALIDATION_UNAVAILABLE' });
    } else {
      const range = this.rangeValidator({ attacker, target, kind: 'NORMAL_ATTACK', context });
      const ok = range === true || (range && range.ok === true);
      if (!ok) return Object.freeze({ ok: false, reason: range?.reason ?? 'OUT_OF_RANGE' });
    }

    if (!Number.isFinite(attacker.combat.hitRate) || !Number.isFinite(target.combat.evasionRate) || target.combat.evasionRate <= 0) {
      return Object.freeze({ ok: false, reason: 'INVALID_HIT_EVASION' });
    }

    const hitOutcome = rollHitOutcome(attacker.combat.hitRate / target.combat.evasionRate, this.rng);
    const resolved = this.damagePolicy.resolve({ attacker, target, hitOutcome, context });
    const hp = resolved.damage > 0 ? applyHpDelta(target, -resolved.damage) : Object.freeze({ before: target.hp, after: target.hp, deltaApplied: 0, died: false });

    return Object.freeze({ ok: true, type: 'NORMAL_ATTACK', attackerId: attacker.id, targetId: target.id, ...resolved, hp, targetLifeState: target.lifeState });
  }
}

module.exports = { CombatService, LIFE_STATE, applyHpDelta, createCombatant };
