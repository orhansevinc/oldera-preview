import assert from 'node:assert/strict';
import { parseN3Terrain1298, decodeMapTile } from '../src/terrain/N3TerrainFormat.js';
import { N3TerrainSampler, NEGATIVE_FLT_MAX } from '../src/terrain/N3TerrainSampler.js';

function makeTerrainBuffer({ version = 1, name = 'unit', mapSize = 5 } = {}) {
  const encoder = new TextEncoder();
  const nameBytes = encoder.encode(name);
  const count = mapSize * mapSize;
  const buffer = new ArrayBuffer(4 + 4 + nameBytes.length + 4 + count * 8 + 12);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let offset = 0;

  view.setInt32(offset, version, true); offset += 4;
  view.setInt32(offset, nameBytes.length, true); offset += 4;
  bytes.set(nameBytes, offset); offset += nameBytes.length;
  view.setInt32(offset, mapSize, true); offset += 4;

  for (let x = 0; x < mapSize; x += 1) {
    for (let z = 0; z < mapSize; z += 1) {
      const i = x * mapSize + z;
      view.setFloat32(offset, x * 100 + z * 10 + i / 100, true); offset += 4;
      view.setUint32(offset, (0x1 | ((i & 0x1f) << 1) | ((i & 0x3ff) << 11)) >>> 0, true); offset += 4;
    }
  }
  return buffer;
}

const parsed = parseN3Terrain1298(makeTerrainBuffer());
assert.equal(parsed.terrainVersion, 1);
assert.equal(parsed.name, 'unit');
assert.equal(parsed.mapSize, 5);
assert.equal(parsed.pointCount, 25);
assert.equal(parsed.trailingByteLength, 12);
assert.equal(parsed.heights[7], Math.fround(120.07));
assert.equal(decodeMapTile(parsed.tiles[7]).isTileFull, true);
assert.equal(decodeMapTile(parsed.tiles[7]).tex1Dir, 7);
assert.equal(decodeMapTile(parsed.tiles[7]).tex1Idx, 7);

const heights = new Float32Array(25);
const set = (x, z, value) => { heights[x * 5 + z] = value; };

// even cell (0,0): slash diagonal, exercise both triangles
set(0, 0, 0);
set(0, 1, 10);
set(1, 0, 20);
set(1, 1, 40);

// odd cell (1,0): backslash diagonal, exercise both triangles
set(2, 0, 50);
set(2, 1, 80);
// (1,0)=20 and (1,1)=40 are shared from above.

const sampler = new N3TerrainSampler(5, heights);
assert.equal(sampler.getHeight(0, 0), 0);
assert.ok(Math.abs(sampler.getHeight(1, 3) - 15) < 1e-5); // even, dZ > dX
assert.ok(Math.abs(sampler.getHeight(3, 1) - 20) < 1e-5); // even, dZ <= dX
assert.ok(Math.abs(sampler.getHeight(7, 3) - 62.5) < 1e-5); // odd, dX+dZ > 1
assert.ok(Math.abs(sampler.getHeight(5, 1) - 32.5) < 1e-5); // odd, dX+dZ <= 1
assert.equal(sampler.getHeight(1000, 1000), NEGATIVE_FLT_MAX);

console.log('OldERA v2 terrain tests: OK');
