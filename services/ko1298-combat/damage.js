'use strict';

const { HIT_OUTCOME } = require('./hit-rate');
const { trunc } = require('./stat-calculator');

function normalAttackPreArmorBase({ attackerAp, attackAmount = 100, defenderAc, rng = Math.random }) {
  if (defenderAc + 240 === 0) throw new RangeError('defenderAc + 240 cannot be zero');
  const tempHitB = trunc((attackerAp * attackAmount * 200 / 100) / (defenderAc + 240));
  const random = Math.floor(rng() * (tempHitB + 1)); // inclusive 0..tempHitB, matching myrand(0,temp_hit_B)
  return Object.freeze({
    tempHitB,
    damage: trunc((0.85 * tempHitB) + (0.3 * random)),
  });
}

function applyWeaponArmor(damage, armorValue = 0) {
  return damage - trunc(damage * armorValue / 200);
}

class OpenKo1298NormalAttackDamagePolicy {
  constructor({ rng = Math.random, magicItemDamageAdapter = null, weaponArmorAdapter = null } = {}) {
    this.rng = rng;
    this.magicItemDamageAdapter = magicItemDamageAdapter;
    this.weaponArmorAdapter = weaponArmorAdapter;
  }

  resolve({ attacker, target, hitOutcome }) {
    if (hitOutcome === HIT_OUTCOME.FAIL) return Object.freeze({ damage: 0, hitOutcome, stages: { failedHit: true } });

    const { tempHitB, damage: physical } = normalAttackPreArmorBase({
      attackerAp: attacker.combat.ap,
      attackAmount: attacker.combat.attackAmount ?? 100,
      defenderAc: target.combat.ac + (target.combat.flatAcAmount ?? 0),
      rng: this.rng,
    });

    let damage = physical;
    let magicItemApplied = false;
    if (this.magicItemDamageAdapter) {
      damage = trunc(this.magicItemDamageAdapter({ damage, attacker, target }));
      magicItemApplied = true;
    }

    let weaponArmorApplied = false;
    if (this.weaponArmorAdapter) {
      const projected = this.weaponArmorAdapter({ attacker, target });
      const armorValues = Array.isArray(projected) ? projected : [projected];
      for (const armorValue of armorValues) {
        if (armorValue == null) continue;
        damage = applyWeaponArmor(damage, armorValue);
        weaponArmorApplied = true;
      }
    }

    // Open-KO 1298/9 GetDamage() applies the final /3 after magic-item and weapon-armor stages.
    damage = trunc(damage / 3);

    return Object.freeze({
      damage: Math.max(0, damage),
      hitOutcome,
      stages: Object.freeze({ tempHitB, physical, magicItemApplied, weaponArmorApplied, finalDivisor: 3 }),
    });
  }
}

module.exports = { OpenKo1298NormalAttackDamagePolicy, applyWeaponArmor, normalAttackPreArmorBase };
