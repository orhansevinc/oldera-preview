'use strict';

// Exact Moradon monster visibility fields from the pinned OpenKO 1298 K_MONSTER rows.
// Source: Open-KO/OpenKO-db@bec619466938d278339c30e5b1a4bff3c9413bab
// ManualSetup/6_InsertData_K_MONSTER.sql
const SOURCE_COMMIT = 'bec619466938d278339c30e5b1a4bff3c9413bab';
const SOURCE_ROOT = `Open-KO/OpenKO-db@${SOURCE_COMMIT}:ManualSetup/6_InsertData_K_MONSTER.sql`;
const SENDER_SOURCE = 'Open-KO/KnightOnline@7d6cf81093e142c928c2ac9510512b2b182178b5';

const ROWS = new Map([
  [750, { name: 'Worm', pid: 700, scale: 120, weapon1: 0, weapon2: 0, groupNation: 0, sellingGroup: 0, level: 1 }],
  [751, { name: 'Earth worm', pid: 700, scale: 135, weapon1: 0, weapon2: 0, groupNation: 0, sellingGroup: 0, level: 2 }],
  [752, { name: 'Blood worm', pid: 700, scale: 140, weapon1: 0, weapon2: 0, groupNation: 0, sellingGroup: 0, level: 4 }],
  [754, { name: 'Carrion crawler', pid: 700, scale: 200, weapon1: 0, weapon2: 0, groupNation: 0, sellingGroup: 0, level: 6 }],
  [755, { name: 'Snatcher', pid: 700, scale: 250, weapon1: 0, weapon2: 0, groupNation: 0, sellingGroup: 0, level: 8 }],
  [850, { name: 'Bandicoot', pid: 800, scale: 90, weapon1: 0, weapon2: 0, groupNation: 0, sellingGroup: 0, level: 2 }],
  [851, { name: 'Wild Bandicoot', pid: 800, scale: 110, weapon1: 0, weapon2: 0, groupNation: 0, sellingGroup: 0, level: 5 }],
  [852, { name: 'Scavenger Bandicoot', pid: 800, scale: 120, weapon1: 0, weapon2: 0, groupNation: 0, sellingGroup: 0, level: 7 }],
  [853, { name: 'Rabid Bandicoot', pid: 800, scale: 120, weapon1: 0, weapon2: 0, groupNation: 0, sellingGroup: 0, level: 9 }],
  [854, { name: 'Cannibal Bandicoot', pid: 800, scale: 150, weapon1: 0, weapon2: 0, groupNation: 0, sellingGroup: 0, level: 11 }],
].map(([sid, row]) => [sid, Object.freeze({
  sid,
  ...row,
  dataSourceRef: `${SOURCE_ROOT}#${sid}`,
})]));

const NORMAL_MONSTER_SENDER = Object.freeze({
  npcType: 0,
  stateGateOpen: 0,
  objectType: 0,
  clientIdk0: 0,
  clientIdk1: 0,
  senderSourceRef: `${SENDER_SOURCE}:src/Server/AIServer/Npc.cpp + src/Server/Ebenezer/Npc.cpp::GetNpcInfo`,
});

function sidOf(template) {
  const match = /^ko1298:monster:(\d+)$/.exec(String(template?.templateId ?? ''));
  return match ? Number(match[1]) : null;
}

function visibilityAuthorityForTemplate(template) {
  const sid = sidOf(template);
  const row = ROWS.get(sid);
  if (!row) {
    throw new RangeError(`ko1298-mobs: no exact Moradon visibility authority for template ${template?.templateId ?? '<missing>'}`);
  }
  if (template.dataClass !== 'real') {
    throw new TypeError(`ko1298-mobs: browser visibility authority is forbidden for non-real template ${template.templateId}`);
  }
  if (!String(template.sourceRef ?? '').includes(SOURCE_COMMIT)) {
    throw new Error(`ko1298-mobs: ${template.templateId} sourceRef is not pinned to ${SOURCE_COMMIT}`);
  }
  if (template.displayName !== row.name) {
    throw new Error(`ko1298-mobs: ${template.templateId} visibility name/source mismatch`);
  }
  if (template.modelRef !== row.pid) {
    throw new Error(`ko1298-mobs: ${template.templateId} visibility pid/source mismatch`);
  }
  if (template.level !== row.level) {
    throw new Error(`ko1298-mobs: ${template.templateId} visibility level/source mismatch`);
  }
  if (template.metadata?.group !== row.groupNation) {
    throw new Error(`ko1298-mobs: ${template.templateId} visibility group/source mismatch`);
  }
  return Object.freeze({ ...row, ...NORMAL_MONSTER_SENDER });
}

module.exports = {
  MORADON_VISIBILITY_SOURCE: Object.freeze({
    data: SOURCE_ROOT,
    sender: NORMAL_MONSTER_SENDER.senderSourceRef,
    templateIds: Object.freeze([...ROWS.keys()]),
  }),
  NORMAL_MONSTER_SENDER,
  visibilityAuthorityForTemplate,
};
