'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  HEIGHT_STATUS,
  SmdHeightMap,
  SmdHeightResolver,
  gitBlobSha1,
} = require('../../services/ko1298-world');

function i32(value) {
  const out = Buffer.alloc(4);
  out.writeInt32LE(value);
  return out;
}

function u32(value) {
  const out = Buffer.alloc(4);
  out.writeUInt32LE(value);
  return out;
}

function f32(value) {
  const out = Buffer.alloc(4);
  out.writeFloatLE(value);
  return out;
}

function triangleAt(y) {
  return [
    { x: 0, y, z: 0 },
    { x: 0, y, z: 4 },
    { x: 4, y, z: 0 },
  ];
}

function buildSmd({ terrainHeight = 0, triangles = [] } = {}) {
  const chunks = [];
  const mapSize = 5;
  const unitDist = 4;
  const width = 16;
  chunks.push(i32(mapSize), f32(unitDist));
  for (let z = 0; z < mapSize; z += 1) {
    for (let x = 0; x < mapSize; x += 1) {
      const height = typeof terrainHeight === 'function' ? terrainHeight(x, z) : terrainHeight;
      chunks.push(f32(height));
    }
  }

  chunks.push(f32(width), f32(width), i32(triangles.length));
  for (const triangle of triangles) {
    for (const vertex of triangle) chunks.push(f32(vertex.x), f32(vertex.y), f32(vertex.z));
  }

  chunks.push(i32(1)); // one 16m main cell exists
  chunks.push(i32(0)); // shape object index list is irrelevant to collision height
  for (let subZ = 0; subZ < 4; subZ += 1) {
    for (let subX = 0; subX < 4; subX += 1) {
      const include = subX === 0 && subZ === 0;
      chunks.push(i32(include ? triangles.length : 0));
      if (include) {
        for (let face = 0; face < triangles.length; face += 1) {
          chunks.push(u32(face * 3), u32(face * 3 + 1), u32(face * 3 + 2));
        }
      }
    }
  }
  return Buffer.concat(chunks);
}

test('terrain height is parsed/interpolated in world units and deterministic', () => {
  const map = new SmdHeightMap(buildSmd({ terrainHeight: 12.5 }));
  const first = map.resolve(2, 2);
  const second = map.resolve(2, 2);
  assert.deepEqual(first, second);
  assert.equal(first.status, HEIGHT_STATUS.AUTHORITATIVE);
  assert.equal(first.surface, 'terrain');
  assert.equal(first.height, 12.5);
  assert.equal(map.mapWidth, 16);
  assert.equal(map.unitDist, 4);
});

test('terrain interpolation follows the SMD parity triangles', () => {
  const map = new SmdHeightMap(buildSmd({ terrainHeight: (x, z) => x + (z * 10) }));
  assert.ok(Number.isFinite(map.terrainHeightAt(1, 1)));
  assert.ok(Number.isFinite(map.terrainHeightAt(5, 6)));
  assert.equal(map.terrainHeightAt(0, 0), 0);
});

test('single invariant shape above terrain is authoritative without guessing a Y hint', () => {
  const map = new SmdHeightMap(buildSmd({ triangles: [triangleAt(5)] }));
  const result = map.resolve(1, 1);
  assert.equal(result.status, HEIGHT_STATUS.AUTHORITATIVE);
  assert.equal(result.surface, 'shape');
  assert.equal(result.height, 5);
});

test('stacked shape surfaces require source Y and fail closed without it', () => {
  const map = new SmdHeightMap(buildSmd({ triangles: [triangleAt(5), triangleAt(10)] }));
  const unresolved = map.resolve(1, 1);
  assert.equal(unresolved.status, HEIGHT_STATUS.UNRESOLVED);
  assert.equal(unresolved.reason, 'shape-y-hint-required');
  assert.equal(Object.hasOwn(unresolved, 'height'), false);

  const nearUpper = map.resolve(1, 1, { yHint: 9 });
  assert.equal(nearUpper.status, HEIGHT_STATUS.AUTHORITATIVE);
  assert.equal(nearUpper.height, 10);
  assert.equal(nearUpper.surface, 'shape');

  const nearLower = map.resolve(1, 1, { yHint: 5.1 });
  assert.equal(nearLower.status, HEIGHT_STATUS.AUTHORITATIVE);
  assert.equal(nearLower.height, 5);
});

test('terrain/shape ambiguity does not silently degrade to terrain', () => {
  const map = new SmdHeightMap(buildSmd({
    terrainHeight: 0,
    triangles: [triangleAt(-1), triangleAt(5)],
  }));
  const result = map.resolve(1, 1);
  assert.equal(result.status, HEIGHT_STATUS.UNRESOLVED);
  assert.equal(result.reason, 'shape-y-hint-required');
  assert.equal(Object.hasOwn(result, 'height'), false);
});

test('invalid coordinates and outside-map queries are explicit', () => {
  const map = new SmdHeightMap(buildSmd());
  assert.deepEqual(map.resolve(Number.NaN, 1), { status: HEIGHT_STATUS.INVALID, reason: 'invalid-coordinate' });
  assert.deepEqual(map.resolve(-1, 1), { status: HEIGHT_STATUS.INVALID, reason: 'outside-map' });
  assert.deepEqual(map.resolve(16, 1), { status: HEIGHT_STATUS.INVALID, reason: 'outside-map' });
  assert.deepEqual(map.resolve(1, 16), { status: HEIGHT_STATUS.INVALID, reason: 'outside-map' });
});

test('resolver distinguishes unknown zone from known zone without a height asset', () => {
  const zoneRegistry = { get: (zoneId) => (zoneId === 21 || zoneId === 1 ? { zoneId } : null) };
  const resolver = new SmdHeightResolver({ zoneRegistry, zoneAssets: {} });
  assert.deepEqual(resolver.resolveHeight(999, 1, 1), {
    status: HEIGHT_STATUS.INVALID,
    reason: 'unknown-zone',
    zoneId: 999,
  });
  assert.deepEqual(resolver.resolveHeight(1, 1, 1), {
    status: HEIGHT_STATUS.UNRESOLVED,
    reason: 'zone-height-asset-unavailable',
    zoneId: 1,
  });
});

test('resolver parses a zone asset once and reuses a deterministic read-only cache', () => {
  const buffer = buildSmd({ terrainHeight: 3 });
  let reads = 0;
  const zoneRegistry = { get: (zoneId) => (zoneId === 21 ? { zoneId } : null) };
  const resolver = new SmdHeightResolver({
    zoneRegistry,
    zoneAssets: {
      21: {
        path: '/authority/moradon.smd',
        expectedByteLength: buffer.length,
        expectedGitBlobSha1: gitBlobSha1(buffer),
      },
    },
    readFile: () => {
      reads += 1;
      return buffer;
    },
  });

  assert.equal(resolver.resolveHeight(21, 1, 1).height, 3);
  assert.equal(resolver.resolveHeight(21, 2, 2).height, 3);
  assert.equal(reads, 1);
  assert.equal(resolver.cacheSize, 1);
});

test('asset identity mismatch fails closed with no guessed height', () => {
  const buffer = buildSmd();
  const zoneRegistry = { get: (zoneId) => (zoneId === 21 ? { zoneId } : null) };
  const resolver = new SmdHeightResolver({
    zoneRegistry,
    zoneAssets: { 21: { path: '/wrong.smd', expectedGitBlobSha1: '0'.repeat(40) } },
    readFile: () => buffer,
  });
  const result = resolver.resolveHeight(21, 1, 1);
  assert.equal(result.status, HEIGHT_STATUS.UNRESOLVED);
  assert.equal(result.reason, 'zone-height-asset-invalid');
  assert.equal(Object.hasOwn(result, 'height'), false);
});
