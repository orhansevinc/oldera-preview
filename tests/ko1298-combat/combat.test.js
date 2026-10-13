'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CombatService,
  LIFE_STATE,
  OpenKo1298NormalAttackDamagePolicy,
  applyHpDelta,
  createCombatant,
} = require('../../services/ko1298-combat');

function actor(id, hp, combat = {}) {
  return createCombatant({ id, hp, maxHp: hp || 100, mp: 50, maxMp: 50, classId: 101, level: 10, stats: {}, combat: { ap: 1000, ac: 0, hitRate: 10, evasionRate: 1, ...combat } });
}

test('HP update clamps and transitions alive -> dead at zero', () => {
  const target = actor('t', 50);
  const result = applyHpDelta(target, -999);
  assert.equal(target.hp, 0);
  assert.equal(target.lifeState, LIFE_STATE.DEAD);
  assert.equal(result.died, true);
  const blocked = applyHpDelta(target, 999);
  assert.equal(blocked.blockedByDeathState, true);
  assert.equal(target.hp, 0);
  assert.equal(target.lifeState, LIFE_STATE.DEAD);

  applyHpDelta(target, 50, { allowRevive: true });
  assert.equal(target.hp, 50);
  assert.equal(target.lifeState, LIFE_STATE.ALIVE);
});

test('normal attack fails closed when range hook is missing', () => {
  const service = new CombatService({ damagePolicy: new OpenKo1298NormalAttackDamagePolicy({ rng: () => 0 }) });
  assert.deepEqual(service.normalAttack(actor('a', 100), actor('t', 100)), { ok: false, reason: 'RANGE_VALIDATION_UNAVAILABLE' });
});

test('normal attack uses range hook, hit roll, source damage chain and death state', () => {
  const attacker = actor('a', 100, { ap: 1000, hitRate: 10, evasionRate: 1 });
  const target = actor('t', 70, { ac: 500, hitRate: 1, evasionRate: 1 });
  const service = new CombatService({
    damagePolicy: new OpenKo1298NormalAttackDamagePolicy({ rng: () => 0 }),
    rangeValidator: () => ({ ok: true }),
    rng: () => 0,
  });
  const result = service.normalAttack(attacker, target);
  assert.equal(result.ok, true);
  assert.equal(result.damage, 76);
  assert.equal(result.hp.died, true);
  assert.equal(target.hp, 0);
  assert.equal(target.lifeState, LIFE_STATE.DEAD);
});

test('range rejection does not damage target', () => {
  const target = actor('t', 100);
  const service = new CombatService({
    damagePolicy: new OpenKo1298NormalAttackDamagePolicy({ rng: () => 0 }),
    rangeValidator: () => ({ ok: false, reason: 'OUT_OF_RANGE' }),
  });
  assert.deepEqual(service.normalAttack(actor('a', 100), target), { ok: false, reason: 'OUT_OF_RANGE' });
  assert.equal(target.hp, 100);
});

test('weapon armor hook can project sequential right/left-hand reductions without owning inventory', () => {
  const attacker = actor('a', 100, { ap: 1000, hitRate: 10, evasionRate: 1 });
  const target = actor('t', 1000, { ac: 0, hitRate: 1, evasionRate: 1 });
  const service = new CombatService({
    damagePolicy: new OpenKo1298NormalAttackDamagePolicy({
      rng: () => 0,
      weaponArmorAdapter: () => [100, 100],
    }),
    rangeValidator: () => true,
    rng: () => 0,
  });
  const result = service.normalAttack(attacker, target);
  assert.equal(result.ok, true);
  assert.equal(result.stages.weaponArmorApplied, true);
  assert.equal(result.damage, 59);
});
