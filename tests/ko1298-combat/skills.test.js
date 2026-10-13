'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  InMemorySkillTableAdapter,
  SkillService,
  createCombatant,
} = require('../../services/ko1298-combat');

function actor(id, { hp = 100, mp = 100, level = 20, classId = 101, skillPoints = { 5: 10 } } = {}) {
  return createCombatant({ id, hp, maxHp: 100, mp, maxMp: 100, classId, level, skillPoints, stats: {}, combat: { ap: 100, ac: 100, hitRate: 1, evasionRate: 1 } });
}

const fixtureSkills = [
  { id: 900001, name: 'fixture-strike', classId: 101, requiredLevel: 10, skillPointSlot: 5, requiredSkillPoints: 5, manaCost: 20, cooldownMs: 1000, effect: { type: 'FLAT_DAMAGE', amount: 25 } },
  { id: 900002, name: 'fixture-heal', classId: 101, requiredLevel: 10, skillPointSlot: 5, requiredSkillPoints: 1, manaCost: 10, cooldownMs: 500, requiresRange: false, effect: { type: 'FLAT_HEAL', amount: 15 } },
  { id: 900003, name: 'fixture-none', classId: 101, requiredLevel: 1, manaCost: 0, cooldownMs: 0, requiresRange: false, effect: { type: 'NONE' } },
];

test('skill request validates resource, consumes MP, starts cooldown and applies fixture effect', () => {
  let now = 1000;
  const service = new SkillService({ skillTable: new InMemorySkillTableAdapter(fixtureSkills), clock: () => now, rangeValidator: () => true });
  const caster = actor('c');
  const target = actor('t');
  const first = service.request({ caster, target, skillId: 900001 });
  assert.equal(first.ok, true);
  assert.equal(caster.mp, 80);
  assert.equal(target.hp, 75);
  assert.equal(first.cooldownUntil, 2000);

  const second = service.request({ caster, target, skillId: 900001 });
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'COOLDOWN');
  assert.equal(caster.mp, 80);

  now = 2000;
  assert.equal(service.request({ caster, target, skillId: 900001 }).ok, true);
});

test('skill validation rejects class, level, skill points and MP before mutation', () => {
  const service = new SkillService({ skillTable: new InMemorySkillTableAdapter(fixtureSkills), rangeValidator: () => true });
  const target = actor('t');

  const wrongClass = actor('c1', { classId: 102 });
  assert.equal(service.request({ caster: wrongClass, target, skillId: 900001 }).reason, 'CLASS_MISMATCH');

  const lowLevel = actor('c2', { level: 9 });
  assert.equal(service.request({ caster: lowLevel, target, skillId: 900001 }).reason, 'LEVEL_TOO_LOW');

  const lowSkill = actor('c3', { skillPoints: { 5: 4 } });
  assert.equal(service.request({ caster: lowSkill, target, skillId: 900001 }).reason, 'SKILL_POINTS_TOO_LOW');

  const lowMp = actor('c4', { mp: 19 });
  assert.equal(service.request({ caster: lowMp, target, skillId: 900001 }).reason, 'INSUFFICIENT_MP');
  assert.equal(lowMp.mp, 19);
});

test('range rejection and unsupported effects do not consume MP or cooldown', () => {
  let now = 1000;
  const rows = [...fixtureSkills, { id: 900004, classId: 101, manaCost: 30, cooldownMs: 1000, requiresRange: false, effect: { type: 'TYPE3_UNKNOWN' } }];
  const service = new SkillService({ skillTable: new InMemorySkillTableAdapter(rows), clock: () => now, rangeValidator: () => ({ ok: false, reason: 'OUT_OF_RANGE' }) });
  const caster = actor('c');
  const target = actor('t');

  assert.equal(service.request({ caster, target, skillId: 900001 }).reason, 'OUT_OF_RANGE');
  assert.equal(caster.mp, 100);

  assert.equal(service.request({ caster, target, skillId: 900004 }).reason, 'UNSUPPORTED_EFFECT');
  assert.equal(caster.mp, 100);
});

test('fixture heal is self/target-safe and range-independent', () => {
  const service = new SkillService({ skillTable: new InMemorySkillTableAdapter(fixtureSkills) });
  const caster = actor('c', { hp: 50 });
  const result = service.request({ caster, skillId: 900002 });
  assert.equal(result.ok, true);
  assert.equal(caster.hp, 65);
  assert.equal(caster.mp, 90);
});
