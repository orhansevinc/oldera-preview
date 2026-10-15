'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSkillCatalog, classForSkillId, parseCsv, validateCatalog } = require('../../services/ko1298-combat/source-skill-catalog');

const header = Array.from({ length: 30 }, (_, i) => `"${i + 1}"`).join(',');
const row = (values) => values.map(v => `"${String(v).replaceAll('"', '""')}"`).join(',');
const main = [
  header,
  row(['101003','slash','slash','Inflict 120% damage','26','0','0','2601','12','0','0','0','10002','-1','7','3','1010','4','0','0','0','0','31','0','0','100','1','0','0','0']),
  row(['107505','Fire arrow','Fire arrow','Arrow plus burn','0','0','0','0','0','0','0','0','0','0','7','5','1075','10','0','7','391010000','13','30','0','0','100','2','3','25','0']),
  row(['107645','Stealth','Stealth','Hide from enemies','0','0','0','0','0','0','0','0','0','0','1','45','1076','40','0','9','0','0','0','0','0','100','9','0','0','0']),
].join('\n');
const type1 = '"1","2","3","4","5","6","7","8","9","10","11","12"\n"101003","0","100","120","100","0","1","0","0","128","128","0"';
const type2 = '"1","2","3","4","5","6"\n"107505","0","100","0","100","1"';
const type3 = '"1","2","3","4","5","6","7"\n"107505","0","1","0","-30","10","1"';

test('RFC4180 parser preserves commas and embedded newlines inside quotes', () => {
  const rows = parseCsv('"a","b,b","c\nline"\n"1","2","3"');
  assert.deepEqual(rows[0], ['a','b,b','c\nline']);
  assert.equal(rows.length, 2);
});

test('catalog keeps exact class namespace, requirements, costs, types and wire boundary', () => {
  const catalog = buildSkillCatalog({ mainCsv: main, typeCsv: { 1:type1, 2:type2, 3:type3 } });
  assert.equal(catalog.recordCount, 3);
  const slash = catalog.records.find(v => v.id === 101003);
  assert.equal(slash.namespace.className, 'KARUS_WARRIOR');
  assert.equal(slash.requirement.mode, 'BASE_LEVEL');
  assert.equal(slash.cost.resource, 4);
  assert.equal(slash.effect.primaryTypeData.damageMod, 120);
  assert.equal(slash.packet.responseAuthority, 'VERIFIED_SLASH_101003_EXACT');
  const fire = catalog.records.find(v => v.id === 107505);
  assert.deepEqual(fire.effect.behaviors, ['PHYSICAL_RANGED','MAGIC_HP_OR_DURATION']);
  assert.equal(fire.requirement.classId, 107);
  assert.equal(fire.requirement.skillPointSlot, 5);
  const stealth = catalog.records.find(v => v.id === 107645);
  assert.equal(stealth.effect.executionStatus, 'CATALOGED_SOURCE_TYPE_NOT_EXECUTABLE');
  assert.equal(validateCatalog(catalog).ok, true);
});

test('class source map includes both nations and promoted 1298 classes', () => {
  assert.equal(classForSkillId(105560).className, 'KARUS_BERSERKER');
  assert.equal(classForSkillId(208655).className, 'ELMORAD_ASSASSIN');
  assert.equal(classForSkillId(212760).className, 'ELMORAD_DRUID');
});
