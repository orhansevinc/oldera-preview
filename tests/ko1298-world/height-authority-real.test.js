'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const {
  HEIGHT_STATUS,
  MORADON_HEIGHT_AUTHORITY,
  createMoradonHeightResolver,
} = require('../../services/ko1298-world');

const smdPath = process.env.WS14_MORADON_SMD;
const npcPath = process.env.WS14_WS16_NPC_DATA;
const mobPath = process.env.WS14_WS25_MOB_DATA;
const hasAuthorityInputs = [smdPath, npcPath, mobPath].every((value) => typeof value === 'string' && value.length > 0);
const authorityTest = hasAuthorityInputs ? test : test.skip;

function loadJson(path) {
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

function createResolver() {
  return createMoradonHeightResolver({ smdPath });
}

function assertWireRepresentable({ x, z, height }) {
  const xRaw = Math.trunc(x * 10);
  const zRaw = Math.trunc(z * 10);
  const yRaw = Math.trunc(height * 10);
  assert.ok(xRaw >= 0 && xRaw <= 0xffff, `x=${x} is not uint16@0.1 representable`);
  assert.ok(zRaw >= 0 && zRaw <= 0xffff, `z=${z} is not uint16@0.1 representable`);
  assert.ok(yRaw >= -0x8000 && yRaw <= 0x7fff, `y=${height} is not int16@0.1 representable`);
}

authorityTest('real pinned Moradon SMD parses with exact asset identity', () => {
  const resolver = createResolver();
  const map = resolver.preload(21);
  assert.equal(map.gitBlobSha1, MORADON_HEIGHT_AUTHORITY.gitBlobSha1);
  assert.equal(map.byteLength, MORADON_HEIGHT_AUTHORITY.byteLength);
  assert.ok(map.mapSize >= 2);
  assert.ok(map.unitDist > 0);
  assert.ok(map.mapWidth > 480, `Moradon map width ${map.mapWidth} does not cover verified source positions`);
  assert.ok(map.shapeSectionEndOffset < map.byteLength, 'SMD parser must leave later map sections intact');
  assert.equal(resolver.cacheSize, 1);
});

authorityTest('known verified Moradon NPC sample resolves deterministically', () => {
  const npcDoc = loadJson(npcPath);
  const caspy = npcDoc.spawns.find((spawn) => spawn.templateSid === 13001 && spawn.anchor);
  assert.ok(caspy, 'verified Caspy anchor missing from WS16 provider');
  const resolver = createResolver();
  const first = resolver.resolveHeight(21, caspy.anchor.x, caspy.anchor.z);
  const second = resolver.resolveHeight(21, caspy.anchor.x, caspy.anchor.z);
  assert.deepEqual(first, second);
  assert.equal(first.status, HEIGHT_STATUS.AUTHORITATIVE, JSON.stringify(first));
  assert.ok(Number.isFinite(first.height));
  assertWireRepresentable({ x: caspy.anchor.x, z: caspy.anchor.z, height: first.height });
});

authorityTest('all WS16 source-anchored Moradon NPC groups have authoritative height', () => {
  const npcDoc = loadJson(npcPath);
  assert.equal(npcDoc.zoneId, 21);
  const points = npcDoc.spawns
    .filter((spawn) => spawn.anchor)
    .map((spawn) => ({ key: spawn.spawnKey, x: spawn.anchor.x, z: spawn.anchor.z }));
  assert.ok(points.length >= 37, `expected at least 37 source-anchored WS16 groups, got ${points.length}`);

  const resolver = createResolver();
  const results = points.map((point) => ({ point, result: resolver.resolveHeight(21, point.x, point.z) }));
  const invalid = results.filter(({ result }) => result.status === HEIGHT_STATUS.INVALID);
  const unresolved = results.filter(({ result }) => result.status === HEIGHT_STATUS.UNRESOLVED);
  const authoritative = results.filter(({ result }) => result.status === HEIGHT_STATUS.AUTHORITATIVE);

  for (const { point, result } of authoritative) {
    assert.ok(Number.isFinite(result.height));
    assertWireRepresentable({ ...point, height: result.height });
  }

  console.log('WS14_NPC_HEIGHT_COVERAGE', JSON.stringify({
    total: results.length,
    authoritative: authoritative.length,
    unresolved: unresolved.map(({ point, result }) => ({ key: point.key, reason: result.reason })),
    invalid: invalid.map(({ point, result }) => ({ key: point.key, reason: result.reason })),
  }));

  assert.equal(invalid.length, 0, `invalid WS16 NPC height points: ${JSON.stringify(invalid)}`);
  assert.equal(unresolved.length, 0, `unresolved WS16 NPC height points: ${JSON.stringify(unresolved)}`);
});

authorityTest('WS25 verified Moradon monster rectangles resolve at corners and center', () => {
  const mobDoc = loadJson(mobPath);
  assert.equal(mobDoc.zoneId, 21);
  assert.ok(Array.isArray(mobDoc.spawnRows) && mobDoc.spawnRows.length > 0);

  const points = [];
  for (const row of mobDoc.spawnRows) {
    const centerX = (row.leftX + row.rightX) / 2;
    const centerZ = (row.topZ + row.bottomZ) / 2;
    for (const [label, x, z] of [
      ['left-top', row.leftX, row.topZ],
      ['right-top', row.rightX, row.topZ],
      ['left-bottom', row.leftX, row.bottomZ],
      ['right-bottom', row.rightX, row.bottomZ],
      ['center', centerX, centerZ],
    ]) {
      points.push({ key: `${row.rowId}:${label}`, x, z });
    }
  }

  const resolver = createResolver();
  const results = points.map((point) => ({ point, result: resolver.resolveHeight(21, point.x, point.z) }));
  const invalid = results.filter(({ result }) => result.status === HEIGHT_STATUS.INVALID);
  const unresolved = results.filter(({ result }) => result.status === HEIGHT_STATUS.UNRESOLVED);
  const authoritative = results.filter(({ result }) => result.status === HEIGHT_STATUS.AUTHORITATIVE);

  for (const { point, result } of authoritative) {
    assert.ok(Number.isFinite(result.height));
    assertWireRepresentable({ ...point, height: result.height });
  }

  console.log('WS14_MOB_HEIGHT_COVERAGE', JSON.stringify({
    spawnRows: mobDoc.spawnRows.length,
    sampledPoints: results.length,
    authoritative: authoritative.length,
    unresolved: unresolved.map(({ point, result }) => ({ key: point.key, reason: result.reason })),
    invalid: invalid.map(({ point, result }) => ({ key: point.key, reason: result.reason })),
  }));

  assert.equal(invalid.length, 0, `invalid WS25 monster rectangle points: ${JSON.stringify(invalid)}`);
  assert.equal(unresolved.length, 0, `unresolved WS25 monster rectangle points: ${JSON.stringify(unresolved)}`);
});

authorityTest('real authority fails closed for invalid zone and out-of-bounds position', () => {
  const resolver = createResolver();
  const unknown = resolver.resolveHeight(250, 100, 100);
  assert.equal(unknown.status, HEIGHT_STATUS.INVALID);
  assert.equal(unknown.reason, 'unknown-zone');

  const map = resolver.preload(21);
  for (const [x, z] of [[-1, 1], [1, -1], [map.mapWidth, 1], [1, map.mapLength]]) {
    const result = resolver.resolveHeight(21, x, z);
    assert.equal(result.status, HEIGHT_STATUS.INVALID, JSON.stringify({ x, z, result }));
    assert.equal(result.reason, 'outside-map');
    assert.equal(Object.hasOwn(result, 'height'), false);
  }
});
