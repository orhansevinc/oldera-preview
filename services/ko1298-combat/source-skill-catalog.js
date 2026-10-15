'use strict';

const {
  MORAL,
  parseMainRow,
  parseType1Row,
  parseType2Row,
  parseType3Row,
  parseType4Row,
  requirementFromMain,
} = require('./verified-skill-data');

const SOURCE_LOCK = Object.freeze({
  clientAssets: 'Open-KO/ko-client-assets@b4636332c7cd818b0ce171eccc973dd3d6b2e56d',
  server: 'Open-KO/KnightOnline@7d6cf81093e142c928c2ac9510512b2b182178b5',
  main: 'Data/Skill_Magic_Main_us.tbl.csv',
  types: Object.freeze({
    1: 'Data/Skill_Magic_1.tbl.csv',
    2: 'Data/Skill_Magic_2.tbl.csv',
    3: 'Data/skill_magic_3.tbl.csv',
    4: 'Data/skill_magic_4.tbl.csv',
  }),
});

const CLASS = Object.freeze({
  101: 'KARUS_WARRIOR', 102: 'KARUS_ROGUE', 103: 'KARUS_WIZARD', 104: 'KARUS_PRIEST',
  105: 'KARUS_BERSERKER', 106: 'KARUS_GUARDIAN', 107: 'KARUS_HUNTER', 108: 'KARUS_PENETRATOR',
  109: 'KARUS_SORCERER', 110: 'KARUS_NECROMANCER', 111: 'KARUS_SHAMAN', 112: 'KARUS_DARKPRIEST',
  201: 'ELMORAD_WARRIOR', 202: 'ELMORAD_ROGUE', 203: 'ELMORAD_WIZARD', 204: 'ELMORAD_PRIEST',
  205: 'ELMORAD_BLADE', 206: 'ELMORAD_PROTECTOR', 207: 'ELMORAD_RANGER', 208: 'ELMORAD_ASSASSIN',
  209: 'ELMORAD_MAGE', 210: 'ELMORAD_ENCHANTER', 211: 'ELMORAD_CLERIC', 212: 'ELMORAD_DRUID',
});

const MORAL_NAME = Object.freeze(Object.fromEntries(Object.entries(MORAL).map(([k, v]) => [v, k])));
const TYPE_BEHAVIOR = Object.freeze({
  1: 'PHYSICAL_MELEE',
  2: 'PHYSICAL_RANGED',
  3: 'MAGIC_HP_OR_DURATION',
  4: 'BUFF_DEBUFF_STATS',
  5: 'SOURCE_TYPE_5',
  6: 'SOURCE_TYPE_6',
  7: 'SOURCE_TYPE_7',
  8: 'SOURCE_TYPE_8',
  9: 'SOURCE_TYPE_9',
  10: 'SOURCE_TYPE_10',
});
const IMPLEMENTED_TYPES = new Set([1, 2, 3, 4]);

function parseCsv(text) {
  if (typeof text !== 'string') throw new TypeError('CSV text must be a string');
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field.replace(/\r$/, '')); if (row.some(v => v !== '')) rows.push(row); row = []; field = ''; }
    else field += ch;
  }
  if (quoted) throw new RangeError('unterminated CSV quote');
  if (field.length || row.length) { row.push(field.replace(/\r$/, '')); if (row.some(v => v !== '')) rows.push(row); }
  return rows;
}

function dataRows(text) {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  return rows.slice(1);
}

function provenance(table) {
  return Object.freeze({
    client: `${SOURCE_LOCK.clientAssets}:${table}`,
    server: `${SOURCE_LOCK.server}:src/Server/Ebenezer/MagicProcess.cpp`,
  });
}

function parseMainCsv(text) {
  return dataRows(text).map(fields => parseMainRow(fields, provenance(SOURCE_LOCK.main)));
}

function parseTypeCsv(type, text) {
  const parsers = { 1: parseType1Row, 2: parseType2Row, 3: parseType3Row, 4: parseType4Row };
  const parser = parsers[type];
  if (!parser) throw new RangeError(`typed semantic parser is not verified for type ${type}`);
  return dataRows(text).map(fields => parser(fields, provenance(SOURCE_LOCK.types[type])));
}

function classForSkillId(id) {
  const classId = Math.trunc(Number(id) / 1000);
  return Object.freeze({ classId, className: CLASS[classId] || null });
}

function behaviorFor(skill) {
  const types = [skill.type1, skill.type2].filter(v => Number(v) > 0);
  if (!types.length) return Object.freeze(['PASSIVE_OR_METADATA']);
  return Object.freeze(types.map(type => TYPE_BEHAVIOR[type] || `SOURCE_TYPE_${type}`));
}

function executionStatus(skill) {
  const types = [skill.type1, skill.type2].filter(v => Number(v) > 0);
  if (!types.length) return 'CATALOG_ONLY_PASSIVE_OR_METADATA';
  return types.every(type => IMPLEMENTED_TYPES.has(type))
    ? 'IMPLEMENTED_WITH_AUTHORITY_PORTS'
    : 'CATALOGED_SOURCE_TYPE_NOT_EXECUTABLE';
}

function attachTypeRows(main, typeMaps) {
  const primary = main.type1 ? typeMaps.get(main.type1)?.get(main.id) ?? null : null;
  const secondary = main.type2 ? typeMaps.get(main.type2)?.get(main.id) ?? null : null;
  return { primary, secondary };
}

function packetContract(skill) {
  return Object.freeze({
    opcode: 'WIZ_MAGIC_PROCESS',
    opcodeHex: '0x31',
    c2sBytesIncludingOpcode: 22,
    commands: Object.freeze(['CASTING', 'FLYING', 'EFFECTING', 'FAIL', 'DURATION_EXPIRED', 'CANCEL']),
    responseAuthority: skill.id === 101003 ? 'VERIFIED_SLASH_101003_EXACT' : 'GENERIC_FRAME_ONLY_EXACT_EFFECT_PAYLOAD_UNVERIFIED',
  });
}

function buildSkillCatalog({ mainCsv, typeCsv = {} } = {}) {
  const mainRows = parseMainCsv(mainCsv);
  const typeMaps = new Map();
  for (const type of [1, 2, 3, 4]) {
    const rows = typeCsv[type] ? parseTypeCsv(type, typeCsv[type]) : [];
    typeMaps.set(type, new Map(rows.map(row => [row.id, row])));
  }
  const seen = new Set();
  const issues = [];
  const records = mainRows.map(main => {
    if (seen.has(main.id)) issues.push({ code: 'DUPLICATE_SKILL_ID', skillId: main.id });
    seen.add(main.id);
    const namespace = classForSkillId(main.id);
    if (!namespace.className) issues.push({ code: 'UNKNOWN_CLASS_NAMESPACE', skillId: main.id, classId: namespace.classId });
    const rows = attachTypeRows(main, typeMaps);
    for (const [label, type, row] of [['primary', main.type1, rows.primary], ['secondary', main.type2, rows.secondary]]) {
      if (type > 0 && type <= 4 && !row) issues.push({ code: 'MISSING_TYPED_ROW', skillId: main.id, type, slot: label });
    }
    const req = requirementFromMain(main);
    return Object.freeze({
      id: main.id,
      name: main.name,
      description: main.description,
      namespace,
      requirement: req,
      target: Object.freeze({ moral: main.moral, moralName: MORAL_NAME[main.moral] || `MORAL_${main.moral}` }),
      range: main.range,
      cast: Object.freeze({
        clientCastTimeMs: main.clientCastTimeMs,
        clientRecastMs: main.clientRecastMs,
        serverCooldown: 'MUST_BE_INJECTED_FROM_VERIFIED_SERVER_POLICY_NOT_CLIENT_RECAST',
      }),
      cost: Object.freeze({
        resource: main.resourceCost,
        hp: main.hpCost,
        requiredItemClass: main.requiredItemClass,
        exhaustItemId: main.exhaustItemId,
      }),
      effect: Object.freeze({
        primaryType: main.type1,
        secondaryType: main.type2,
        primaryTypeData: rows.primary,
        secondaryTypeData: rows.secondary,
        behaviors: behaviorFor(main),
        executionStatus: executionStatus(main),
      }),
      packet: packetContract(main),
      successRate: main.successRate,
      source: main.provenance,
    });
  });
  const coverage = {};
  for (const record of records) {
    for (const behavior of record.effect.behaviors) coverage[behavior] = (coverage[behavior] || 0) + 1;
  }
  return Object.freeze({
    schemaVersion: 'oldkoweb-p2-07-skill-catalog/v1',
    sourceLock: SOURCE_LOCK,
    recordCount: records.length,
    records: Object.freeze(records),
    coverage: Object.freeze(coverage),
    issues: Object.freeze(issues),
  });
}

function validateCatalog(catalog) {
  if (!catalog || !Array.isArray(catalog.records) || catalog.records.length === 0) throw new Error('skill catalog is empty');
  const fatal = catalog.issues.filter(issue => issue.code === 'DUPLICATE_SKILL_ID' || issue.code === 'UNKNOWN_CLASS_NAMESPACE');
  return Object.freeze({
    ok: fatal.length === 0,
    fatal: Object.freeze(fatal),
    warnings: Object.freeze(catalog.issues.filter(issue => !fatal.includes(issue))),
  });
}

module.exports = {
  CLASS,
  IMPLEMENTED_TYPES,
  MORAL_NAME,
  SOURCE_LOCK,
  TYPE_BEHAVIOR,
  buildSkillCatalog,
  classForSkillId,
  parseCsv,
  parseMainCsv,
  parseTypeCsv,
  validateCatalog,
};
