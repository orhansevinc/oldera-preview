'use strict';

// Exact combat/stat fields for the verified Moradon slice.
// Source schema and values:
// Open-KO/OpenKO-db@bec619466938d278339c30e5b1a4bff3c9413bab
// ManualSetup/6_InsertData_K_MONSTER.sql
//
// Important: source-valid zeroes (notably sAtk=0 for this slice) are preserved.
// Missing combat fields are never substituted with zero.
const SOURCE_COMMIT = 'bec619466938d278339c30e5b1a4bff3c9413bab';
const SOURCE_ROOT = `Open-KO/OpenKO-db@${SOURCE_COMMIT}:ManualSetup/6_InsertData_K_MONSTER.sql`;
const AISERVER_SOURCE = 'Open-KO/KnightOnline@7d6cf81093e142c928c2ac9510512b2b182178b5';

const ROWS = new Map([
  [750, ['Worm', 1, 7, 25, 0, 5, 1, 1, 4, 2000, 5, 3, 40, 0, 0]],
  [751, ['Earth worm', 2, 11, 48, 0, 10, 1, 1, 4, 2000, 5, 3, 40, 0, 0]],
  [752, ['Blood worm', 4, 20, 80, 0, 20, 2, 3, 5, 2000, 5, 3, 40, 0, 0]],
  [754, ['Carrion crawler', 6, 32, 120, 0, 31, 3, 4, 6, 2000, 5, 3, 40, 0, 0]],
  [755, ['Snatcher', 8, 48, 167, 0, 41, 4, 6, 7, 2000, 5, 3, 40, 0, 0]],
  [850, ['Bandicoot', 2, 11, 48, 0, 10, 1, 1, 3, 1700, 5, 3, 40, 0, 0]],
  [851, ['Wild Bandicoot', 5, 26, 99, 0, 26, 2, 3, 4, 1700, 5, 3, 40, 0, 0]],
  [852, ['Scavenger Bandicoot', 7, 40, 143, 0, 36, 3, 5, 6, 1700, 5, 3, 40, 0, 0]],
  [853, ['Rabid Bandicoot', 9, 57, 194, 0, 46, 4, 7, 7, 1700, 5, 3, 40, 0, 0]],
  [854, ['Cannibal Bandicoot', 11, 99, 253, 0, 57, 6, 9, 9, 1700, 5, 3, 40, 0, 0]],
].map(([sid, values]) => {
  const [name, level, iHpPoint, sMpPoint, sAtk, sAc, sHitRate, sEvadeRate, sDamage,
    sAttackDelay, byAttackRange, bySearchRange, byTracingRange, byDirectAttack, byMagicAttack] = values;
  const sourceFields = Object.freeze({
    iHpPoint,
    sMpPoint,
    sAtk,
    sAc,
    sHitRate,
    sEvadeRate,
    sDamage,
    sAttackDelay,
    byAttackRange,
    bySearchRange,
    byTracingRange,
    byDirectAttack,
    byMagicAttack,
  });
  return [sid, Object.freeze({
    sid,
    name,
    level,
    sourceRef: `${SOURCE_ROOT}#${sid}`,
    sourceFields,
  })];
}));

function sidOf(template) {
  const match = /^ko1298:monster:(\d+)$/.exec(String(template?.templateId ?? ''));
  return match ? Number(match[1]) : null;
}

function combatAuthorityForTemplate(template) {
  const sid = sidOf(template);
  const row = ROWS.get(sid);
  if (!row) {
    throw new RangeError(`ko1298-mobs: no exact Moradon combat authority for template ${template?.templateId ?? '<missing>'}`);
  }
  if (template?.dataClass !== 'real') {
    throw new TypeError(`ko1298-mobs: combat authority is forbidden for non-real template ${template?.templateId ?? '<missing>'}`);
  }
  if (!String(template.sourceRef ?? '').includes(SOURCE_COMMIT)) {
    throw new Error(`ko1298-mobs: ${template.templateId} combat sourceRef is not pinned to ${SOURCE_COMMIT}`);
  }
  const source = row.sourceFields;
  const exactChecks = [
    ['displayName', template.displayName, row.name],
    ['level', template.level, row.level],
    ['maxHp', template.maxHp, source.iHpPoint],
    ['attackDelayMs', template.attackDelayMs, source.sAttackDelay],
    ['attackRange', template.attackRange, source.byAttackRange],
    ['aggroRange', template.aggroRange, source.bySearchRange],
    ['leashRange', template.leashRange, Math.max(source.bySearchRange, source.byTracingRange, source.byAttackRange)],
  ];
  for (const [field, actual, expected] of exactChecks) {
    if (actual !== expected) {
      throw new Error(`ko1298-mobs: ${template.templateId} ${field} source mismatch (${actual} != ${expected})`);
    }
  }
  return row;
}

module.exports = {
  MORADON_COMBAT_SOURCE: Object.freeze({
    data: SOURCE_ROOT,
    aiServer: `${AISERVER_SOURCE}:src/Server/AIServer/Npc.cpp`,
    templateIds: Object.freeze([...ROWS.keys()]),
  }),
  combatAuthorityForTemplate,
};
