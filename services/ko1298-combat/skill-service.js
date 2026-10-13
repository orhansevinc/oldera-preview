'use strict';

const { LIFE_STATE, applyHpDelta } = require('./combat-service');

const SKILL_RESULT = Object.freeze({
  OK: 'OK', UNKNOWN_SKILL: 'UNKNOWN_SKILL', CASTER_DEAD: 'CASTER_DEAD', TARGET_DEAD: 'TARGET_DEAD',
  CLASS_MISMATCH: 'CLASS_MISMATCH', LEVEL_TOO_LOW: 'LEVEL_TOO_LOW', SKILL_POINTS_TOO_LOW: 'SKILL_POINTS_TOO_LOW',
  COOLDOWN: 'COOLDOWN', INSUFFICIENT_MP: 'INSUFFICIENT_MP', RANGE_VALIDATION_UNAVAILABLE: 'RANGE_VALIDATION_UNAVAILABLE',
  OUT_OF_RANGE: 'OUT_OF_RANGE', UNSUPPORTED_EFFECT: 'UNSUPPORTED_EFFECT',
});

class InMemorySkillTableAdapter {
  constructor(rows = []) { this.rows = new Map(rows.map((row) => [Number(row.id), Object.freeze({ ...row })])); }
  get(skillId) { return this.rows.get(Number(skillId)) ?? null; }
}

class SkillService {
  constructor({ skillTable, clock = () => Date.now(), rangeValidator = null, requireRangeValidation = true } = {}) {
    if (!skillTable || typeof skillTable.get !== 'function') throw new TypeError('skillTable.get is required');
    this.skillTable = skillTable;
    this.clock = clock;
    this.rangeValidator = rangeValidator;
    this.requireRangeValidation = requireRangeValidation;
    this.cooldowns = new Map();
  }

  _key(casterId, skillId) { return `${casterId}:${skillId}`; }

  request({ caster, target = null, skillId, context = {} }) {
    const skill = this.skillTable.get(skillId);
    if (!skill) return Object.freeze({ ok: false, reason: SKILL_RESULT.UNKNOWN_SKILL });
    if (caster.lifeState !== LIFE_STATE.ALIVE || caster.hp <= 0) return Object.freeze({ ok: false, reason: SKILL_RESULT.CASTER_DEAD });
    if (target && (target.lifeState !== LIFE_STATE.ALIVE || target.hp <= 0) && !skill.allowDeadTarget) return Object.freeze({ ok: false, reason: SKILL_RESULT.TARGET_DEAD });

    if (skill.classId != null && Number(skill.classId) !== Number(caster.classId)) return Object.freeze({ ok: false, reason: SKILL_RESULT.CLASS_MISMATCH });
    if ((skill.requiredLevel ?? 0) > (caster.level ?? 0)) return Object.freeze({ ok: false, reason: SKILL_RESULT.LEVEL_TOO_LOW });
    if (skill.skillPointSlot != null && (skill.requiredSkillPoints ?? 0) > Number(caster.skillPoints?.[skill.skillPointSlot] ?? 0)) {
      return Object.freeze({ ok: false, reason: SKILL_RESULT.SKILL_POINTS_TOO_LOW });
    }

    const now = this.clock();
    const cooldownUntil = this.cooldowns.get(this._key(caster.id, skill.id)) ?? 0;
    if (now < cooldownUntil) return Object.freeze({ ok: false, reason: SKILL_RESULT.COOLDOWN, retryAt: cooldownUntil });
    if ((skill.manaCost ?? 0) > caster.mp) return Object.freeze({ ok: false, reason: SKILL_RESULT.INSUFFICIENT_MP });

    if (skill.requiresRange !== false) {
      if (!this.rangeValidator) {
        if (this.requireRangeValidation) return Object.freeze({ ok: false, reason: SKILL_RESULT.RANGE_VALIDATION_UNAVAILABLE });
      } else {
        const range = this.rangeValidator({ caster, target, skill, kind: 'SKILL', context });
        const rangeOk = range === true || (range && range.ok === true);
        if (!rangeOk) return Object.freeze({ ok: false, reason: range?.reason ?? SKILL_RESULT.OUT_OF_RANGE });
      }
    }

    const effectType = skill.effect?.type ?? 'NONE';
    if (!['NONE', 'FLAT_DAMAGE', 'FLAT_HEAL'].includes(effectType) || (effectType === 'FLAT_DAMAGE' && !target)) {
      return Object.freeze({ ok: false, reason: SKILL_RESULT.UNSUPPORTED_EFFECT });
    }

    // Deduct only after every validation passes, and only for supported Stage-2 fixture effects.
    caster.mp -= Math.trunc(skill.manaCost ?? 0);
    const cooldownMs = Math.max(0, Math.trunc(skill.cooldownMs ?? 0));
    if (cooldownMs > 0) this.cooldowns.set(this._key(caster.id, skill.id), now + cooldownMs);

    let effect = null;
    if (effectType === 'FLAT_DAMAGE') {
      effect = applyHpDelta(target, -Math.max(0, Math.trunc(skill.effect.amount ?? 0)));
    } else if (effectType === 'FLAT_HEAL') {
      const recipient = target ?? caster;
      effect = applyHpDelta(recipient, Math.max(0, Math.trunc(skill.effect.amount ?? 0)));
    }

    return Object.freeze({ ok: true, reason: SKILL_RESULT.OK, skillId: skill.id, manaSpent: Math.trunc(skill.manaCost ?? 0), cooldownUntil: cooldownMs > 0 ? now + cooldownMs : null, effect });
  }
}

module.exports = { InMemorySkillTableAdapter, SKILL_RESULT, SkillService };
