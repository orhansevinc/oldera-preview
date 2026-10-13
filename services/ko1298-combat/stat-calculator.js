'use strict';

function trunc(value) {
  return Math.trunc(value);
}

function requireFinite(name, value) {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
}

function nonNegative(name, value) {
  requireFinite(name, value);
  if (value < 0) throw new RangeError(`${name} must be >= 0`);
  return value;
}

function normalizePrimaryStats(stats = {}) {
  const mpStat = stats.mpStat ?? stats.mp ?? stats.cha ?? 0;
  return Object.freeze({
    str: nonNegative('str', stats.str ?? 0),
    sta: nonNegative('sta', stats.sta ?? 0),
    dex: nonNegative('dex', stats.dex ?? 0),
    int: nonNegative('int', stats.int ?? stats.intel ?? 0),
    mpStat: nonNegative('mpStat', mpStat),
  });
}

function addPrimary(base, item = {}, buff = {}) {
  const b = normalizePrimaryStats(base);
  const i = normalizePrimaryStats(item);
  const a = normalizePrimaryStats(buff);
  return Object.freeze({
    str: b.str + i.str + a.str,
    sta: b.sta + i.sta + a.sta,
    dex: b.dex + i.dex + a.dex,
    int: b.int + i.int + a.int,
    mpStat: b.mpStat + i.mpStat + a.mpStat,
  });
}

function calculateMaxHp({ level, effectiveSta, coefficient, itemMaxHp = 0, flatMaxHpAmount = 0 }) {
  nonNegative('level', level);
  nonNegative('effectiveSta', effectiveSta);
  requireFinite('coefficient.hitPoint', coefficient.hitPoint);
  return trunc(
    (coefficient.hitPoint * level * level * effectiveSta)
      + (0.1 * level * effectiveSta)
      + (effectiveSta / 5.0)
      + flatMaxHpAmount
      + itemMaxHp,
  );
}

function calculateMaxMp({ level, effectiveInt, effectiveSta, coefficient, itemMaxMp = 0 }) {
  nonNegative('level', level);
  nonNegative('effectiveInt', effectiveInt);
  nonNegative('effectiveSta', effectiveSta);
  const manaPoint = Number(coefficient.manaPoint ?? 0);
  const sp = Number(coefficient.sp ?? 0);

  if (manaPoint !== 0) {
    // Source adds 30 to INT before this formula and a final +20 for the ManaPoint path.
    const sourceInt = effectiveInt + 30;
    return Object.freeze({
      mode: 'MANA_POINT',
      value: trunc(
        (manaPoint * level * level * sourceInt)
          + (0.1 * level * 2 * sourceInt)
          + (sourceInt / 5.0),
      ) + itemMaxMp + 20,
    });
  }

  if (sp !== 0) {
    return Object.freeze({
      mode: 'SP',
      value: trunc(
        (sp * level * level * effectiveSta)
          + (0.1 * level * effectiveSta)
          + (effectiveSta / 5.0),
      ) + itemMaxMp,
    });
  }

  return Object.freeze({ mode: 'UNKNOWN', value: null });
}

function calculateAttackPower({
  level,
  effectiveStr,
  effectiveDex,
  weaponCoefficient,
  itemHit = 0,
  bowDamage = null,
  isBow = false,
}) {
  [level, effectiveStr, effectiveDex, weaponCoefficient, itemHit].forEach((v, idx) => requireFinite(`ap[${idx}]`, v));

  if (isBow) {
    if (bowDamage == null) throw new TypeError('bowDamage is required for bow AP');
    requireFinite('bowDamage', bowDamage);
    return trunc(
      (0.005 * bowDamage * (effectiveDex + 40))
        + (weaponCoefficient * bowDamage * level * effectiveDex)
        + 3,
    );
  }

  return trunc(
    (0.005 * itemHit * (effectiveStr + 40))
      + (weaponCoefficient * itemHit * level * effectiveStr)
      + 3,
  );
}

function calculateArmorClass({ armorCoefficient, bodyAc = 0, itemAc = 0 }) {
  [armorCoefficient, bodyAc, itemAc].forEach((v, idx) => requireFinite(`ac[${idx}]`, v));
  return trunc(armorCoefficient * (bodyAc + itemAc));
}

function calculateHitRate({ hitRateCoefficient, level, effectiveDex, itemHitRate = 100, hitRateAmount = 100 }) {
  [hitRateCoefficient, level, effectiveDex, itemHitRate, hitRateAmount]
    .forEach((v, idx) => requireFinite(`hitRate[${idx}]`, v));
  return ((1.0 + hitRateCoefficient * level * effectiveDex) * itemHitRate / 100.0)
    * (hitRateAmount / 100.0);
}

function calculateEvasionRate({ evasionCoefficient, level, effectiveDex, itemEvasionRate = 100, avoidRateAmount = 100 }) {
  [evasionCoefficient, level, effectiveDex, itemEvasionRate, avoidRateAmount]
    .forEach((v, idx) => requireFinite(`evasion[${idx}]`, v));
  return ((1.0 + evasionCoefficient * level * effectiveDex) * itemEvasionRate / 100.0)
    * (avoidRateAmount / 100.0);
}

function earnedSkillPoints(level) {
  nonNegative('level', level);
  return level > 9 ? 2 * (level - 9) : 0;
}

function totalPrimaryStatBudget(level) {
  nonNegative('level', level);
  return 300 + (3 * Math.max(0, level - 1));
}

function normalizeResists(resists = {}) {
  const keys = ['fire', 'cold', 'lightning', 'magic', 'disease', 'poison', 'dagger', 'sword', 'axe', 'mace', 'spear', 'bow'];
  return Object.freeze(Object.fromEntries(keys.map((key) => [key, Number(resists[key] ?? 0)])));
}

module.exports = {
  addPrimary,
  calculateArmorClass,
  calculateAttackPower,
  calculateEvasionRate,
  calculateHitRate,
  calculateMaxHp,
  calculateMaxMp,
  earnedSkillPoints,
  normalizePrimaryStats,
  normalizeResists,
  totalPrimaryStatBudget,
  trunc,
};
