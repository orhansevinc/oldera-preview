'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const moradonVerified = require('../../world-data/mobs/verified/moradon-zone21.verified.json');
const { MobService, loadVerifiedWorldDefinition } = require('../../services/ko1298-mobs');

const ws14ModulePath = process.env.WS25_WS14_WORLD_MODULE;
const smdPath = process.env.WS25_MORADON_SMD;
const ws31SummaryPath = process.env.WS25_WS31_SUMMARY;
const hasAuthority = Boolean(ws14ModulePath && smdPath && ws31SummaryPath);
const authorityTest = hasAuthority ? test : test.skip;

function assertWireRepresentable(position) {
  const xRaw = Math.trunc(position.x * 10);
  const zRaw = Math.trunc(position.z * 10);
  const yRaw = Math.trunc(position.y * 10);
  assert.ok(xRaw >= 0 && xRaw <= 0xffff, `x=${position.x} is not uint16@0.1 representable`);
  assert.ok(zRaw >= 0 && zRaw <= 0xffff, `z=${position.z} is not uint16@0.1 representable`);
  assert.ok(yRaw >= -0x8000 && yRaw <= 0x7fff, `y=${position.y} is not int16@0.1 representable`);
}

authorityTest('all 135 deterministic Moradon mob slots materialize through exact WS14 height authority', () => {
  const ws14 = require(path.resolve(ws14ModulePath));
  const ws31Summary = JSON.parse(fs.readFileSync(ws31SummaryPath, 'utf8'));
  const ws31Slice = ws31Summary.coverage.moradon_monsters;
  assert.deepEqual(ws31Slice.template_ids, [750, 751, 752, 754, 755, 850, 851, 852, 853, 854]);
  assert.equal(ws31Slice.templates, 10);
  assert.equal(ws31Slice.spawn_groups, 20);
  assert.equal(ws31Slice.declared_population, 135);
  assert.equal(ws31Slice.source_position_semantics, 'K_NPCPOS rectangle/count');

  const resolver = ws14.createMoradonHeightResolver({ smdPath });
  const world = loadVerifiedWorldDefinition(moradonVerified);
  const resolutions = [];

  const service = new MobService(world, {
    terrain: {
      resolveHeight(zoneId, x, z) {
        const result = resolver.resolveHeight(zoneId, x, z);
        resolutions.push({ zoneId, x, z, result });
        return result;
      },
    },
  });

  const mobs = service.initialize(0);
  assert.equal(moradonVerified.monsters.length, 10);
  assert.equal(moradonVerified.spawnRows.length, 20);
  assert.equal(world.templates.length, 10);
  assert.equal(world.spawnGroups.length, 20);
  assert.equal(mobs.length, 135);
  assert.equal(resolutions.length, 135);

  const nonAuthoritative = resolutions.filter(({ result }) => result.status !== ws14.HEIGHT_STATUS.AUTHORITATIVE);
  assert.deepEqual(nonAuthoritative, []);

  for (const mob of mobs) {
    assert.ok(Number.isFinite(mob.position.x));
    assert.ok(Number.isFinite(mob.position.y));
    assert.ok(Number.isFinite(mob.position.z));
    assert.deepEqual(mob.position, mob.home);
    assert.deepEqual(mob.position, mob.spawnOrigin);
    assert.equal(mob.position.x, mob.spawnAnchor.x);
    assert.equal(mob.position.z, mob.spawnAnchor.z);
    assert.equal(mob.heightAuthority.status, 'authoritative');
    assertWireRepresentable(mob.position);
  }

  const surfaceCounts = resolutions.reduce((counts, { result }) => {
    const key = result.surface ?? 'unknown';
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});

  console.log('WS25_MORADON_MOB_HEIGHT_COVERAGE', JSON.stringify({
    ws14Provider: process.env.WS25_WS14_PROVIDER_SHA ?? null,
    ws31Provider: process.env.WS25_WS31_PROVIDER_SHA ?? null,
    terrainAsset: ws14.MORADON_HEIGHT_AUTHORITY.gitBlobSha1,
    templates: world.templates.length,
    verifiedSpawnRows: world.spawnGroups.length,
    deterministicSlots: mobs.length,
    resolvedSlots: resolutions.length,
    authoritativeSlots: resolutions.length - nonAuthoritative.length,
    surfaceCounts,
  }));
});
