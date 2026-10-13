'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  addPrimary,
  calculateArmorClass,
  calculateAttackPower,
  calculateEvasionRate,
  calculateHitRate,
  calculateMaxHp,
  calculateMaxMp,
  earnedSkillPoints,
  totalPrimaryStatBudget,
} = require('../../services/ko1298-combat');

test('effective primary stats add base + item + buff without 255 clamp', () => {
  assert.deepEqual(addPrimary(
    { str: 250, sta: 60, dex: 70, int: 50, mpStat: 50 },
    { str: 10, sta: 5, dex: 1, int: 2, mpStat: 3 },
    { str: 5, sta: 2, dex: 4, int: 1, mpStat: 0 },
  ), { str: 265, sta: 67, dex: 75, int: 53, mpStat: 53 });
});

test('HP formula mirrors Open-KO SetMaxHp arithmetic', () => {
  assert.equal(calculateMaxHp({ level: 10, effectiveSta: 65, coefficient: { hitPoint: 0.005 }, itemMaxHp: 20, flatMaxHpAmount: 30 }), 160);
});

test('MP formula supports ManaPoint and SP coefficient paths', () => {
  assert.deepEqual(calculateMaxMp({ level: 10, effectiveInt: 70, effectiveSta: 65, coefficient: { manaPoint: 0.004, sp: 0 }, itemMaxMp: 0 }), { mode: 'MANA_POINT', value: 280 });
  assert.deepEqual(calculateMaxMp({ level: 10, effectiveInt: 70, effectiveSta: 65, coefficient: { manaPoint: 0, sp: 0.004 }, itemMaxMp: 10 }), { mode: 'SP', value: 114 });
  assert.deepEqual(calculateMaxMp({ level: 10, effectiveInt: 70, effectiveSta: 65, coefficient: { manaPoint: 0, sp: 0 }, itemMaxMp: 10 }), { mode: 'UNKNOWN', value: null });
});

test('AP distinguishes melee STR/itemHit from bow DEX/bow damage', () => {
  assert.equal(calculateAttackPower({ level: 10, effectiveStr: 100, effectiveDex: 120, weaponCoefficient: 0.001, itemHit: 50, isBow: false }), 88);
  assert.equal(calculateAttackPower({ level: 10, effectiveStr: 100, effectiveDex: 120, weaponCoefficient: 0.001, itemHit: 50, bowDamage: 60, isBow: true }), 123);
});

test('AC, hit rate and evasion rate mirror source formulas', () => {
  assert.equal(calculateArmorClass({ armorCoefficient: 1.5, bodyAc: 10, itemAc: 100 }), 165);
  assert.equal(calculateHitRate({ hitRateCoefficient: 0.001, level: 10, effectiveDex: 100 }), 2);
  assert.equal(calculateEvasionRate({ evasionCoefficient: 0.001, level: 10, effectiveDex: 100 }), 2);
});

test('level budgets expose 3 stat points per level and 2 skill points after level 9', () => {
  assert.equal(totalPrimaryStatBudget(1), 300);
  assert.equal(totalPrimaryStatBudget(10), 327);
  assert.equal(earnedSkillPoints(9), 0);
  assert.equal(earnedSkillPoints(10), 2);
  assert.equal(earnedSkillPoints(70), 122);
});
