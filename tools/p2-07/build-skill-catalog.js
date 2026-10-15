#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { buildSkillCatalog, validateCatalog } = require('../../services/ko1298-combat/source-skill-catalog');

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
const mainPath = args.get('--main');
const outPath = args.get('--out');
if (!mainPath || !outPath) {
  process.stderr.write('usage: build-skill-catalog --main <Skill_Magic_Main_us.tbl.csv> --out <catalog.json> [--type1 file ... --type4 file]\n');
  process.exit(2);
}
const typeCsv = {};
for (const type of [1, 2, 3, 4]) {
  const p = args.get(`--type${type}`);
  if (p) typeCsv[type] = fs.readFileSync(p, 'utf8');
}
const catalog = buildSkillCatalog({ mainCsv: fs.readFileSync(mainPath, 'utf8'), typeCsv });
const validation = validateCatalog(catalog);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify({ ...catalog, validation }, null, 2)}\n`);
process.stdout.write(JSON.stringify({
  records: catalog.recordCount,
  coverage: catalog.coverage,
  issues: catalog.issues.length,
  valid: validation.ok,
}) + '\n');
if (!validation.ok) process.exitCode = 1;
