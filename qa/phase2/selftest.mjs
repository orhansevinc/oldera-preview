#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
const here = path.dirname(new URL(import.meta.url).pathname);
const plan = JSON.parse(fs.readFileSync(path.join(here,'coverage-plan.json'),'utf8'));
const scenarios = JSON.parse(fs.readFileSync(path.join(here,'acceptance-scenarios.json'),'utf8'));
if (new Set(plan.evidence_dimensions).size !== 5) throw new Error('expected five unique evidence dimensions');
for (const row of plan.static_rows) if (!row.id || !row.owner || typeof row.critical !== 'boolean') throw new Error(`bad static row ${JSON.stringify(row)}`);
const ids = scenarios.scenarios.map(x=>x.id);
if (new Set(ids).size !== ids.length) throw new Error('duplicate scenario id');
for (const s of scenarios.scenarios) if (!s.required_evidence?.length || !s.steps?.length) throw new Error(`scenario ${s.id} lacks evidence/steps`);
const regression = ['REG-01','REG-02','REG-03','REG-04','REG-05','REG-06','REG-07'];
for (const id of regression) if (!ids.includes(id)) throw new Error(`missing regression scenario ${id}`);
console.log(JSON.stringify({result:'PASS',static_rows:plan.static_rows.length,scenarios:scenarios.scenarios.length,critical_scenarios:scenarios.scenarios.filter(s=>s.critical).length}));
