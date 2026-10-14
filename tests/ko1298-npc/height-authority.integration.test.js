'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  NpcWorld,
  materializeNpcPopulation,
  catalogStats,
  HEIGHT_AUTHORITY_DEPENDENCY,
} = require('../../services/ko1298-npc');

const ws14ModulePath = process.env.WS16_WS14_MODULE;
const smdPath = process.env.WS16_MORADON_SMD;
const ws31CatalogPath = process.env.WS16_WS31_NPC_CATALOG;
const seedPath = path.join(__dirname, '../../world-data/npc/moradon.json');

const integrationReady = Boolean(ws14ModulePath && smdPath && ws31CatalogPath);

test('WS14 public height authority materializes every WS16 source anchor with authoritative XYZ', { skip: !integrationReady }, () => {
  const ws14 = require(ws14ModulePath);
  assert.equal(typeof ws14.createMoradonHeightResolver, 'function');
  assert.equal(ws14.HEIGHT_STATUS?.AUTHORITATIVE, 'authoritative');

  const doc = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
  const stats = catalogStats(doc);
  assert.deepEqual(
    { templates: stats.templates, spawnGroups: stats.spawnGroups, anchoredSpawnGroups: stats.anchoredSpawnGroups, declaredPopulation: stats.declaredPopulation },
    { templates: 31, spawnGroups: 39, anchoredSpawnGroups: 37, declaredPopulation: 43 },
  );

  const heightAuthority = ws14.createMoradonHeightResolver({ smdPath });
  const report = materializeNpcPopulation(doc, { heightAuthority });
  assert.equal(report.authoritativeNpcCount, 37);
  assert.equal(report.unresolved.length, 2);
  assert.equal(report.records.every(npc => (
    Number.isFinite(npc.x)
    && Number.isFinite(npc.y)
    && Number.isFinite(npc.z)
    && npc.positionAuthority.dependency === HEIGHT_AUTHORITY_DEPENDENCY
    && npc.positionAuthority.status === 'authoritative'
  )), true);

  const caspy = report.records.find(npc => npc.templateSid === 13001);
  assert.ok(caspy);
  const direct = heightAuthority.resolveHeight(caspy.zoneId, caspy.x, caspy.z);
  assert.equal(direct.status, 'authoritative');
  assert.equal(caspy.y, direct.height);

  const world = new NpcWorld();
  world.reloadZone(21, [...report.records]);
  const detail = world.detailSnapshot(caspy.instanceId);
  assert.deepEqual(detail.position, { zoneId: 21, x: caspy.x, y: direct.height, z: caspy.z });
  assert.equal(detail.positionAuthority.status, 'authoritative');
  assert.equal(world.nearbySnapshot(21, caspy.x, caspy.z).every(row => row.positionAuthority.status === 'authoritative'), true);

  const ws31 = JSON.parse(fs.readFileSync(ws31CatalogPath, 'utf8'));
  const ws31Caspy = ws31.find(row => row.id === 13001);
  assert.ok(ws31Caspy);
  assert.equal(ws31Caspy.patch, '1298');
  assert.ok(ws31Caspy.zone_ids.includes(21));
  assert.equal(ws31Caspy.resource_id, caspy.resourceId);
  assert.ok(ws31Caspy.source.some(source => source.ref.includes('Open-KO/OpenKO-db@bec619466938d278339c30e5b1a4bff3c9413bab')));
});
