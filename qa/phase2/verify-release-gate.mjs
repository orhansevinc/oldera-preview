#!/usr/bin/env node
import fs from 'node:fs';
import crypto from 'node:crypto';

function parseArgs(argv) { const o={}; for(let i=2;i<argv.length;i++) if(argv[i].startsWith('--')) o[argv[i].slice(2)] = argv[i+1] && !argv[i+1].startsWith('--') ? argv[++i] : true; return o; }
function read(file) { return JSON.parse(fs.readFileSync(file,'utf8')); }
function fingerprint(file) { return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`; }

const a = parseArgs(process.argv);
for (const k of ['candidate','matrix','local','domain']) if (!a[k]) { console.error(`missing --${k}`); process.exit(64); }
const fp = fingerprint(a.candidate);
const matrix = read(a.matrix), local = read(a.local), domain = read(a.domain);
const scenarios = read(new URL('./acceptance-scenarios.json', import.meta.url));
const blockers = [], failures = [];

for (const [name, doc] of [['matrix',matrix],['local',local],['domain',domain]]) {
  if (doc.candidate_fingerprint !== fp) blockers.push({ owner:'P2-13', code:'CANDIDATE_IDENTITY_MISMATCH', artifact:name, expected:fp, actual:doc.candidate_fingerprint || null });
}
for (const row of matrix.rows || []) {
  if (!row.critical) continue;
  if (row.overall === 'FAIL') failures.push({ owner:row.owner, code:'CRITICAL_COVERAGE_FAIL', row:row.id });
  else if (row.overall !== 'PASS') blockers.push({ owner:row.owner, code:'CRITICAL_COVERAGE_NOT_VERIFIED', row:row.id, actual:row.overall });
}
for (const item of matrix.discovery || []) if (item.status !== 'PASS') blockers.push({ owner:'P2-13', code:'INVENTORY_DISCOVERY_INCOMPLETE', category:item.category, actual:item.status, error:item.error || null });

const mergedScenario = { ...(local.scenario_results || {}), ...(domain.scenario_results || {}) };
for (const scenario of scenarios.scenarios.filter(s => s.critical)) {
  const got = mergedScenario[scenario.id];
  if (!got) blockers.push({ owner:scenario.owners?.[0] || 'P2-13', code:'CRITICAL_SCENARIO_NOT_RUN', scenario:scenario.id });
  else if (got.result === 'FAIL') failures.push({ owner:got.owner || scenario.owners?.[0] || 'P2-13', code:'CRITICAL_SCENARIO_FAIL', scenario:scenario.id });
  else if (got.result !== 'PASS') blockers.push({ owner:got.owner || scenario.owners?.[0] || 'P2-13', code:'CRITICAL_SCENARIO_BLOCKED', scenario:scenario.id, actual:got.result });
}
if (!local.local_verified) blockers.push({ owner:'P2-00', code:'LOCAL_VERIFIED_FALSE' });
if (!domain.domain_verified) blockers.push({ owner:'P2-12', code:'DOMAIN_VERIFIED_FALSE' });
for (const host of ['site','play','admin']) {
  const h = domain.http?.[host];
  if (!h?.ok || !String(h.final_url || '').startsWith('https://')) blockers.push({ owner:'P2-12', code:'PUBLIC_DOMAIN_NOT_VERIFIED', host, evidence:h || null });
}

const decision = failures.length ? 'RELEASE_BLOCKED_FAIL' : blockers.length ? 'RELEASE_BLOCKED_INCOMPLETE' : 'RELEASE_APPROVED';
const result = { schema_version:'oldkoweb-phase2-release-gate/v1', candidate_fingerprint:fp, decision, local_verified: blockers.every(x=>x.code!=='LOCAL_VERIFIED_FALSE'), domain_verified: decision==='RELEASE_APPROVED', failures, blockers };
console.log(JSON.stringify(result, null, 2));
if (decision !== 'RELEASE_APPROVED') process.exitCode = 2;
