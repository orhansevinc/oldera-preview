#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function args(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const k = argv[i];
    if (!k.startsWith('--')) continue;
    out[k.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return out;
}
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
function ensureDir(file) { fs.mkdirSync(path.dirname(file), { recursive: true }); }
function slug(value) { return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 120); }

const a = args(process.argv);
if (!a.candidate || !a.out) {
  console.error('usage: node build-coverage-matrix.mjs --candidate <manifest.json> --out <matrix.json>');
  process.exit(64);
}
const here = path.dirname(new URL(import.meta.url).pathname);
const plan = readJson(path.join(here, 'coverage-plan.json'));
const candidateRaw = fs.readFileSync(a.candidate);
const candidate = JSON.parse(candidateRaw.toString('utf8'));
const fingerprint = `sha256:${sha256(candidateRaw)}`;
const dims = plan.evidence_dimensions;
const rows = [];
const discovery = [];
const seen = new Set();

function evidence(defaultSource = 'UNKNOWN', sourceDetail = null) {
  const o = {};
  for (const d of dims) o[d] = { status: d === 'source_data' ? defaultSource : 'NOT_RUN', evidence: d === 'source_data' ? sourceDetail : null };
  return o;
}
function addRow(row) {
  if (!row?.id || seen.has(row.id)) return;
  seen.add(row.id);
  rows.push({ ...row, candidate_fingerprint: fingerprint, evidence: row.evidence || evidence(), overall: 'NOT_RUN' });
}

for (const row of plan.static_rows) addRow({ ...row, evidence: evidence('UNKNOWN', 'Requires exact-candidate evidence') });

const zoneFile = path.resolve(process.cwd(), 'services/ko1298-world/data/zones.1298.json');
if (fs.existsSync(zoneFile)) {
  try {
    const zoneDoc = readJson(zoneFile);
    for (const z of zoneDoc.zones || []) {
      addRow({
        id: `map.zone-${z.zoneId}`,
        category: 'map', owner: 'P2-04', critical: z.zoneId === 21,
        name: `${z.name} (zone ${z.zoneId})`,
        metadata: { zoneId: z.zoneId, zoneType: z.zoneType, entryStatus: z.entryStatus, mapRef: z.mapRef, unknown: z.unknown || [] },
        evidence: evidence('PASS', `parsed ${path.relative(process.cwd(), zoneFile)}; entryStatus=${z.entryStatus}`)
      });
    }
    discovery.push({ category: 'maps', status: 'PASS', source: path.relative(process.cwd(), zoneFile), count: (zoneDoc.zones || []).length });
  } catch (err) {
    discovery.push({ category: 'maps', status: 'FAIL', source: path.relative(process.cwd(), zoneFile), error: err.message });
  }
} else {
  discovery.push({ category: 'maps', status: 'BLOCKED', source: 'services/ko1298-world/data/zones.1298.json', error: 'file not present in checked-out candidate' });
}

const inv = candidate.coverage_inventory || {};
const categories = [
  ['maps', 'map', 'P2-04'],
  ['npcs', 'npc', 'P2-05'],
  ['npc_services', 'npc-service', 'P2-05'],
  ['npc_spawn_groups', 'npc-spawn', 'P2-05'],
  ['mobs', 'mob', 'P2-06'],
  ['bosses', 'boss', 'P2-06'],
  ['mob_spawn_groups', 'mob-spawn', 'P2-06'],
  ['classes', 'class', 'P2-07'],
  ['skills', 'skill', 'P2-07'],
  ['effects', 'effect', 'P2-07'],
  ['item_operations', 'item-operation', 'P2-08'],
  ['social_pvp', 'social-pvp', 'P2-09'],
  ['ui_controls', 'ui-control', 'P2-10']
];
for (const [key, category, owner] of categories) {
  const values = inv[key];
  if (!Array.isArray(values) || values.length === 0) {
    discovery.push({ category: key, status: 'BLOCKED', error: `candidate.coverage_inventory.${key} missing/empty` });
    continue;
  }
  let count = 0;
  for (const value of values) {
    const obj = typeof value === 'object' && value ? value : { name: String(value) };
    const stable = obj.id ?? obj.zoneId ?? obj.templateSid ?? obj.skillId ?? obj.effectId ?? obj.classId ?? obj.name ?? value;
    addRow({
      id: `${category}.${slug(stable)}`,
      category, owner: obj.owner || owner, critical: Boolean(obj.critical),
      name: obj.name || `${category} ${stable}`,
      metadata: obj,
      evidence: evidence('PASS', `pinned candidate coverage_inventory.${key}`)
    });
    count += 1;
  }
  discovery.push({ category: key, status: 'PASS', source: `candidate.coverage_inventory.${key}`, count });
}

function classify(row) {
  const statuses = dims.map(d => row.evidence?.[d]?.status || 'UNKNOWN');
  if (statuses.includes('FAIL')) return 'FAIL';
  if (statuses.includes('BLOCKED')) return 'BLOCKED';
  if (statuses.every(s => s === 'PASS')) return 'PASS';
  if (statuses.includes('NOT_RUN')) return 'NOT_RUN';
  return 'UNKNOWN';
}
for (const row of rows) row.overall = classify(row);

const counts = rows.reduce((m, r) => { m[r.overall] = (m[r.overall] || 0) + 1; return m; }, {});
const doc = {
  schema_version: 'oldkoweb-phase2-coverage-matrix/v1',
  generated_at: new Date().toISOString(),
  candidate_fingerprint: fingerprint,
  candidate_identity: {
    integration_source_sha: candidate.integration_source_sha || candidate.source_commit || null,
    client_js_sha256: candidate.client_js_sha256 || candidate.client?.js_sha256 || null,
    client_wasm_sha256: candidate.client_wasm_sha256 || candidate.client?.wasm_sha256 || null,
    client_data_sha256: candidate.client_data_sha256 || candidate.client?.data_sha256 || null,
    db_migration_head: candidate.db_migration_head || candidate.database?.migration_head || null
  },
  evidence_dimensions: dims,
  discovery,
  summary: { total: rows.length, by_overall: counts, discovery_blockers: discovery.filter(x => x.status !== 'PASS').length },
  rows
};
ensureDir(a.out);
fs.writeFileSync(a.out, JSON.stringify(doc, null, 2) + '\n');
console.log(JSON.stringify(doc.summary));
if (doc.summary.discovery_blockers > 0) process.exitCode = 3;
