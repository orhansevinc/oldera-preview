#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const args = process.argv.slice(2);
const getArg = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const providerRoot = path.resolve(getArg('--provider-root', path.join(repoRoot, '.ws49-providers')));
const outputRoot = path.resolve(getArg('--output', path.join(repoRoot, 'artifacts/ws49')));
const reportPath = path.join(outputRoot, 'integration-report.json');
const report = JSON.parse(await readFile(reportPath, 'utf8'));
const heads = JSON.parse(await readFile(path.join(providerRoot, 'actual-provider-heads.json'), 'utf8'));
const headById = Object.fromEntries(heads.providers.map((p) => [p.id, p]));
const movement = require(path.join(providerRoot, 'ws15/services/ko1298-movement/src'));
const { MovementService, StaticZoneBounds } = movement;
const EPOCH = report.deterministicEpochMs;

function packet({ x, z, y = 0, speed, flag }) {
  const b = Buffer.alloc(9); b.writeUInt16LE(Math.round(x * 10), 0); b.writeUInt16LE(Math.round(z * 10), 2);
  b.writeInt16LE(Math.round(y * 10), 4); b.writeUInt16LE(Math.round(speed * 10), 6); b.writeUInt8(flag, 8); return b;
}
function fixture() {
  let now = EPOCH; const regions = [], broadcasts = [], disconnects = [];
  const service = new MovementService({
    zoneBounds: new StaticZoneBounds({ 21: { minX: 0, maxX: 2000, minY: -100, maxY: 300, minZ: 0, maxZ: 2000 } }),
    clock: () => now, speedPolicy: () => 10,
    onRegionMembership: (e) => regions.push(e), broadcast: (e) => broadcasts.push(e), onDisconnect: (e) => disconnects.push(e),
    config: { positionSlack: 0.5 }
  });
  return { service, regions, broadcasts, disconnects, advance(ms) { now += ms; } };
}
function safe(value) {
  if (typeof value === 'bigint') return value.toString();
  if (Buffer.isBuffer(value)) return { hex: value.toString('hex'), bytes: value.length };
  if (Array.isArray(value)) return value.map(safe);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, safe(v)]));
  return value;
}

for (const scenario of report.scenarios) {
  scenario.providers = scenario.providers.map((p) => ({
    ...p,
    sha: headById[p.id]?.testedSha || p.sha,
    baselineSha: headById[p.id]?.baselineSha || p.sha,
    driftFromBaseline: Boolean(headById[p.id]?.drift)
  }));
}

let cFailure = null;
try {
  const f = fixture();
  for (const [sessionId, entityId, x] of [['z', 10, 47], ['a', 11, 50], ['m', 12, 150], ['x', 13, 400]]) {
    f.service.registerSession({ sessionId, entityId, zoneId: 21, position: { x, y: 0, z: 20 }, worldReady: true });
  }
  const first = f.service.handleMovePacket('z', packet({ x: 49, z: 20, speed: 2, flag: 1 }));
  f.advance(1500);
  const crossed = f.service.handleMovePacket('z', packet({ x: 52, z: 20, speed: 2, flag: 3 }));
  assert.equal(f.regions.length, 1); assert.equal(f.regions[0].leave.x, 0); assert.equal(f.regions[0].enter.x, 1);
  assert.deepEqual(crossed.recipients, ['a', 'z']);
  const scenario = report.scenarios.find((x) => x.id === 'C');
  scenario.status = 'PASS'; scenario.firstFailingEvent = null; scenario.blocker = null; scenario.error = null;
  scenario.providers = [{ id: 'WS15', branch: headById.WS15.branch, sha: headById.WS15.testedSha, baselineSha: headById.WS15.baselineSha, driftFromBaseline: headById.WS15.drift }];
  scenario.expected = '48-unit region leave/enter plus deterministic nearby recipients';
  scenario.actual = safe({ membership: f.regions[0], recipients: crossed.recipients });
  await writeFile(path.join(outputRoot, 'transcripts/C.json'), `${JSON.stringify(safe([
    { sequence: 1, tMs: EPOCH + 10, event: 'region-boundary-start', data: first },
    { sequence: 2, tMs: EPOCH + 20, event: 'region-crossing', data: { membership: f.regions[0], recipients: crossed.recipients } }
  ]), null, 2)}\n`);
  await rm(path.join(outputRoot, 'failure-snapshots/C.json'), { force: true });
} catch (error) {
  cFailure = error;
  const scenario = report.scenarios.find((x) => x.id === 'C');
  scenario.status = 'FAIL'; scenario.blocker = null;
  scenario.firstFailingEvent = 'current WS15 region-crossing execution';
  scenario.expected = '48-unit region leave/enter plus deterministic nearby recipients'; scenario.actual = error.message;
  scenario.error = { name: error.name, code: error.code || null, message: error.message };
}

let reconnectFailure = null;
try {
  const f = fixture();
  for (let i = 0; i < 50; i += 1) {
    const oldId = `old-${i}`, newId = `new-${i}`, entityId = 5000 + i;
    f.service.registerSession({ sessionId: oldId, entityId, zoneId: 21, position: { x: 100 + i / 10, y: 0, z: 100 }, worldReady: true });
    const snapshot = f.service.createRestoreSnapshot(oldId);
    assert.equal(f.service.disconnect(oldId), true);
    const restored = f.service.restoreSession({ sessionId: newId, entityId, snapshot, worldReady: true });
    assert.equal(restored.entityId, entityId); assert.equal(restored.worldReady, true); assert.equal(f.service.disconnect(newId), true);
  }
  report.stress[0] = { name: '50 reconnect/session-restore cycles', status: 'PASS', scope: 'WS15 authoritative movement snapshot/restore only; not persisted product restore', actual: { cycles: 50, disconnects: f.disconnects.length } };
} catch (error) {
  reconnectFailure = error;
  report.stress[0] = { name: '50 reconnect/session-restore cycles', status: 'FAIL', scope: 'WS15 authoritative movement snapshot/restore', error: { name: error.name, code: error.code || null, message: error.message } };
}

report.providerHeadsAtRun = heads;
report.counts = {
  pass: report.scenarios.filter((x) => x.status === 'PASS').length,
  fail: report.scenarios.filter((x) => x.status === 'FAIL').length,
  blocked: report.scenarios.filter((x) => x.status === 'BLOCKED').length
};
report.topBlockers = report.scenarios.filter((x) => x.status === 'BLOCKED').slice(0, 5).map((x) => ({ scenario: x.id, message: x.blocker?.message || x.actual, missingContract: x.blocker?.missingContract || x.firstFailingEvent }));

const md = ['# WS49 Deterministic Gameplay Integration Report', '',
  `Seed: \`${report.seed}\`  `, `Deterministic epoch: \`${report.deterministicEpochMs}\`  `,
  `Scenario result: **${report.counts.pass} PASS / ${report.counts.fail} FAIL / ${report.counts.blocked} BLOCKED**`, '',
  '> WS10 remains the canonical real-browser Moradon gate. WS49 tests exact provider HEADs resolved at run start.', '',
  '## Provider manifest', '', '| Provider | Branch | Baseline SHA | Tested HEAD | Drift |', '|---|---|---|---|---|'];
for (const p of heads.providers) md.push(`| ${p.id} | \`${p.branch}\` | \`${p.baselineSha.slice(0, 12)}\` | \`${p.testedSha.slice(0, 12)}\` | ${p.drift ? 'YES' : 'NO'} |`);
md.push('', '## Scenarios', '', '| ID | Scenario | Result | First failing event / blocker |', '|---|---|---|---|');
for (const s of report.scenarios) md.push(`| ${s.id} | ${s.name} | **${s.status}** | ${s.blocker?.message || s.error?.message || s.firstFailingEvent || ''} |`);
md.push('', '## Stress', '', '| Stress | Result | Scope |', '|---|---|---|');
for (const s of report.stress) md.push(`| ${s.name} | **${s.status}** | ${s.scope || ''} |`);
md.push('', '## Top blockers', '');
for (const b of report.topBlockers) md.push(`- **${b.scenario}:** ${b.message} Missing contract: ${b.missingContract}`);
md.push('');
await mkdir(outputRoot, { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
await writeFile(path.join(outputRoot, 'integration-report.md'), md.join('\n'));
await writeFile(path.join(outputRoot, 'actual-provider-heads.json'), `${JSON.stringify(heads, null, 2)}\n`);
if (cFailure || reconnectFailure || report.counts.fail > 0 || report.stress.some((x) => x.status === 'FAIL')) process.exitCode = 1;
