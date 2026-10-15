'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');

const { createVerified1298ZoneRegistry } = require('./zone-registry');

const CELL_MAIN_DIVIDE = 4;
const CELL_SUB_SIZE = 4;
const CELL_MAIN_SIZE = CELL_MAIN_DIVIDE * CELL_SUB_SIZE;
const SHAPE_RAY_ORIGIN_Y = 5000.0;
const TRIANGLE_EPSILON = 0.0001;

const HEIGHT_STATUS = Object.freeze({
  AUTHORITATIVE: 'authoritative',
  UNRESOLVED: 'unresolved',
  INVALID: 'invalid',
});

const MORADON_HEIGHT_AUTHORITY = Object.freeze({
  zoneId: 21,
  serverMap: 'moradon_0826.smd',
  sourceRepository: 'Open-KO/KnightOnline',
  sourceCommit: '7d6cf81093e142c928c2ac9510512b2b182178b5',
  gitBlobSha1: 'cf47772b8e42a8bad71032419f47978c8bbd6142',
  byteLength: 786000,
  zoneCatalogSource: 'WS31 zone 21 / ZONE_INFO -> moradon_0826.smd',
  xzOnlyPolicy: 'max(terrain, highest-shape)',
});

class BinaryReader {
  constructor(buffer) {
    if (!Buffer.isBuffer(buffer)) throw new TypeError('SMD parser requires a Buffer');
    this.buffer = buffer;
    this.offset = 0;
  }

  ensure(size, label) {
    if (!Number.isInteger(size) || size < 0 || this.offset + size > this.buffer.length) {
      throw new Error(`truncated SMD while reading ${label} at offset ${this.offset}`);
    }
  }

  i32(label) {
    this.ensure(4, label);
    const value = this.buffer.readInt32LE(this.offset);
    this.offset += 4;
    return value;
  }

  u16(label) {
    this.ensure(2, label);
    const value = this.buffer.readUInt16LE(this.offset);
    this.offset += 2;
    return value;
  }

  u32(label) {
    this.ensure(4, label);
    const value = this.buffer.readUInt32LE(this.offset);
    this.offset += 4;
    return value;
  }

  f32(label) {
    this.ensure(4, label);
    const value = this.buffer.readFloatLE(this.offset);
    this.offset += 4;
    if (!Number.isFinite(value)) throw new Error(`non-finite float in ${label} at offset ${this.offset - 4}`);
    return value;
  }
}

class SmdHeightMap {
  constructor(buffer, { source = null } = {}) {
    this.source = source;
    this.byteLength = buffer.length;
    this.gitBlobSha1 = gitBlobSha1(buffer);

    const reader = new BinaryReader(buffer);
    this.mapSize = reader.i32('terrain mapSize');
    this.unitDist = reader.f32('terrain unitDist');
    if (!Number.isInteger(this.mapSize) || this.mapSize < 2 || this.mapSize > 4097) {
      throw new Error(`invalid SMD terrain mapSize ${this.mapSize}`);
    }
    if (!(this.unitDist > 0)) throw new Error(`invalid SMD terrain unitDist ${this.unitDist}`);

    const terrainCount = this.mapSize * this.mapSize;
    reader.ensure(terrainCount * 4, 'terrain height matrix');
    this.terrain = new Float32Array(terrainCount);
    for (let z = 0; z < this.mapSize; z += 1) {
      for (let x = 0; x < this.mapSize; x += 1) {
        this.terrain[x * this.mapSize + z] = reader.f32(`terrain[${x}][${z}]`);
      }
    }

    this.mapWidth = (this.mapSize - 1) * this.unitDist;
    this.mapLength = this.mapWidth;

    this.shapeWidth = reader.f32('shape map width');
    this.shapeLength = reader.f32('shape map length');
    if (this.shapeWidth !== this.mapWidth || this.shapeLength !== this.mapLength) {
      throw new Error(`SMD terrain/shape dimension mismatch terrain=${this.mapWidth}x${this.mapLength} shape=${this.shapeWidth}x${this.shapeLength}`);
    }

    this.collisionFaceCount = reader.i32('shape collision face count');
    if (this.collisionFaceCount < 0) throw new Error(`invalid collision face count ${this.collisionFaceCount}`);
    const vertexCount = this.collisionFaceCount * 3;
    reader.ensure(vertexCount * 12, 'shape collision vertices');
    this.collisionVertices = new Float32Array(vertexCount * 3);
    for (let i = 0; i < vertexCount; i += 1) {
      this.collisionVertices[i * 3] = reader.f32(`collision vertex ${i}.x`);
      this.collisionVertices[i * 3 + 1] = reader.f32(`collision vertex ${i}.y`);
      this.collisionVertices[i * 3 + 2] = reader.f32(`collision vertex ${i}.z`);
    }

    this.mainCellCountX = Math.trunc(this.shapeWidth / CELL_MAIN_SIZE);
    this.mainCellCountZ = Math.trunc(this.shapeLength / CELL_MAIN_SIZE);
    this.mainCells = new Array(this.mainCellCountX * this.mainCellCountZ).fill(null);

    for (let z = 0; z < this.mainCellCountZ; z += 1) {
      for (let x = 0; x < this.mainCellCountX; x += 1) {
        const exists = reader.i32(`shape main cell ${x},${z} exists`);
        if (exists === 0) continue;
        this.mainCells[z * this.mainCellCountX + x] = readMainCell(reader, vertexCount, x, z);
      }
    }
    this.shapeSectionEndOffset = reader.offset;
    Object.freeze(this.mainCells);
  }

  inBounds(x, z) {
    return Number.isFinite(x) && Number.isFinite(z)
      && x >= 0 && z >= 0 && x < this.mapWidth && z < this.mapLength;
  }

  terrainHeightAt(x, z) {
    if (!this.inBounds(x, z)) return null;
    const iX = Math.trunc(x / this.unitDist);
    const iZ = Math.trunc(z / this.unitDist);
    const dX = (x - iX * this.unitDist) / this.unitDist;
    const dZ = (z - iZ * this.unitDist) / this.unitDist;
    if (!(dX >= 0 && dZ >= 0 && dX < 1 && dZ < 1)) return null;

    const h = (xx, zz) => this.terrain[xx * this.mapSize + zz];
    let h1;
    let h2;
    let h3;

    if ((iX + iZ) % 2 === 1) {
      if (dX + dZ < 1) {
        h1 = h(iX, iZ + 1);
        h2 = h(iX + 1, iZ);
        h3 = h(iX, iZ);
        const h12 = h1 + (h2 - h1) * dX;
        const h32 = h3 + (h2 - h3) * dX;
        return h32 + (h12 - h32) * (dZ / (1 - dX));
      }
      h1 = h(iX, iZ + 1);
      h2 = h(iX + 1, iZ);
      h3 = h(iX + 1, iZ + 1);
      if (dX === 0) return h1;
      const h12 = h1 + (h2 - h1) * dX;
      const h13 = h1 + (h3 - h1) * dX;
      return h13 + (h12 - h13) * ((1 - dZ) / dX);
    }

    if (dZ > dX) {
      h1 = h(iX, iZ + 1);
      h2 = h(iX + 1, iZ + 1);
      h3 = h(iX, iZ);
      const h12 = h1 + (h2 - h1) * dX;
      const h32 = h3 + (h2 - h3) * dX;
      return h12 + (h32 - h12) * ((1 - dZ) / (1 - dX));
    }

    h1 = h(iX, iZ);
    h2 = h(iX + 1, iZ);
    h3 = h(iX + 1, iZ + 1);
    if (dX === 0) return h1;
    const h12 = h1 + (h2 - h1) * dX;
    const h13 = h1 + (h3 - h1) * dX;
    return h12 + (h13 - h12) * (dZ / dX);
  }

  shapeHeightsAt(x, z) {
    if (!this.inBounds(x, z)) return [];
    const cell = this.#subCellAt(x, z);
    if (!cell || cell.length === 0) return [];
    const heights = [];
    for (let i = 0; i < cell.length; i += 3) {
      const y = intersectDownwardTriangle(
        x,
        z,
        this.collisionVertices,
        cell[i],
        cell[i + 1],
        cell[i + 2],
      );
      if (y !== null) heights.push(y);
    }
    return heights;
  }

  resolve(x, z, { yHint } = {}) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      return Object.freeze({ status: HEIGHT_STATUS.INVALID, reason: 'invalid-coordinate' });
    }
    if (!this.inBounds(x, z)) {
      return Object.freeze({ status: HEIGHT_STATUS.INVALID, reason: 'outside-map' });
    }

    const terrainHeight = this.terrainHeightAt(x, z);
    if (!Number.isFinite(terrainHeight)) {
      return Object.freeze({ status: HEIGHT_STATUS.UNRESOLVED, reason: 'terrain-height-unavailable' });
    }

    const shapeHeights = this.shapeHeightsAt(x, z);
    if (yHint !== undefined && yHint !== null) {
      if (!Number.isFinite(yHint)) {
        return Object.freeze({ status: HEIGHT_STATUS.INVALID, reason: 'invalid-y-hint' });
      }
      const shapeHeight = nearestHeight(shapeHeights, yHint);
      const useShape = Number.isFinite(shapeHeight) && shapeHeight > terrainHeight;
      return authoritative(useShape ? shapeHeight : terrainHeight, useShape ? 'shape' : 'terrain', {
        terrainHeight,
        shapeHeight: Number.isFinite(shapeHeight) ? shapeHeight : null,
        policy: 'server-nearest-shape-with-y-hint',
        yHint,
      });
    }

    // Exact X/Z-only 1.298 policy: the client WIZ_WARP path compares terrain
    // with GetHeightWithShape(x,z), whose shape manager returns the highest
    // intersected collision surface. No synthetic Y seed is required.
    const shapeHeight = highestHeight(shapeHeights);
    const useShape = Number.isFinite(shapeHeight) && shapeHeight > terrainHeight;
    return authoritative(useShape ? shapeHeight : terrainHeight, useShape ? 'shape' : 'terrain', {
      terrainHeight,
      shapeHeight: Number.isFinite(shapeHeight) ? shapeHeight : null,
      policy: 'xz-max-terrain-highest-shape',
    });
  }

  #subCellAt(x, z) {
    const mainX = Math.trunc(x / CELL_MAIN_SIZE);
    const mainZ = Math.trunc(z / CELL_MAIN_SIZE);
    if (mainX < 0 || mainZ < 0 || mainX >= this.mainCellCountX || mainZ >= this.mainCellCountZ) return null;
    const main = this.mainCells[mainZ * this.mainCellCountX + mainX];
    if (!main) return null;
    const subX = (Math.trunc(x) % CELL_MAIN_SIZE) >> 2;
    const subZ = (Math.trunc(z) % CELL_MAIN_SIZE) >> 2;
    return main[subZ * CELL_MAIN_DIVIDE + subX] || null;
  }
}

class SmdHeightResolver {
  constructor({ zoneRegistry = createVerified1298ZoneRegistry(), zoneAssets = {}, readFile = fs.readFileSync } = {}) {
    if (!zoneRegistry || typeof zoneRegistry.get !== 'function') throw new TypeError('zoneRegistry.get is required');
    if (typeof readFile !== 'function') throw new TypeError('readFile must be a function');
    this.zoneRegistry = zoneRegistry;
    this.zoneAssets = new Map();
    for (const [rawZoneId, rawAsset] of Object.entries(zoneAssets)) {
      const zoneId = Number(rawZoneId);
      if (!Number.isInteger(zoneId)) throw new TypeError(`invalid zone asset key ${rawZoneId}`);
      const asset = typeof rawAsset === 'string' ? { path: rawAsset } : { ...rawAsset };
      if (!asset.path || typeof asset.path !== 'string') throw new TypeError(`zone ${zoneId} asset path is required`);
      this.zoneAssets.set(zoneId, Object.freeze(asset));
    }
    this.readFile = readFile;
    this.cache = new Map();
  }

  preload(zoneId) {
    const zone = this.zoneRegistry.get(zoneId);
    if (!zone) throw new Error(`unknown zone ${zoneId}`);
    const asset = this.zoneAssets.get(zoneId);
    if (!asset) throw new Error(`height asset unavailable for known zone ${zoneId}`);
    if (this.cache.has(zoneId)) return this.cache.get(zoneId);
    const buffer = this.readFile(asset.path);
    validateAssetIdentity(buffer, asset, zoneId);
    const map = new SmdHeightMap(buffer, { source: asset.source || asset.path });
    this.cache.set(zoneId, map);
    return map;
  }

  resolveHeight(zoneId, x, z, options = {}) {
    if (!Number.isInteger(zoneId)) {
      return Object.freeze({ status: HEIGHT_STATUS.INVALID, reason: 'invalid-zone-id', zoneId });
    }
    const zone = this.zoneRegistry.get(zoneId);
    if (!zone) return Object.freeze({ status: HEIGHT_STATUS.INVALID, reason: 'unknown-zone', zoneId });
    if (!this.zoneAssets.has(zoneId)) {
      return Object.freeze({ status: HEIGHT_STATUS.UNRESOLVED, reason: 'zone-height-asset-unavailable', zoneId });
    }
    let map;
    try {
      map = this.preload(zoneId);
    } catch (error) {
      return Object.freeze({
        status: HEIGHT_STATUS.UNRESOLVED,
        reason: 'zone-height-asset-invalid',
        zoneId,
        error: error.message,
      });
    }
    return Object.freeze({ zoneId, ...map.resolve(x, z, options) });
  }

  get cacheSize() {
    return this.cache.size;
  }
}

function createMoradonHeightResolver({ smdPath, zoneRegistry = createVerified1298ZoneRegistry(), readFile } = {}) {
  const zoneAssets = smdPath ? {
    [MORADON_HEIGHT_AUTHORITY.zoneId]: {
      path: smdPath,
      expectedByteLength: MORADON_HEIGHT_AUTHORITY.byteLength,
      expectedGitBlobSha1: MORADON_HEIGHT_AUTHORITY.gitBlobSha1,
      source: `${MORADON_HEIGHT_AUTHORITY.sourceRepository}@${MORADON_HEIGHT_AUTHORITY.sourceCommit}:${MORADON_HEIGHT_AUTHORITY.serverMap}`,
    },
  } : {};
  return new SmdHeightResolver({ zoneRegistry, zoneAssets, ...(readFile ? { readFile } : {}) });
}

function authoritative(height, surface, details) {
  return Object.freeze({
    status: HEIGHT_STATUS.AUTHORITATIVE,
    height,
    surface,
    ...details,
  });
}

function nearestHeight(heights, yHint) {
  let nearest = null;
  let distance = Infinity;
  for (const height of heights) {
    const current = Math.abs(height - yHint);
    if (current < distance) {
      distance = current;
      nearest = height;
    }
  }
  return nearest;
}

function highestHeight(heights) {
  let highest = null;
  for (const height of heights) {
    if (highest === null || height > highest) highest = height;
  }
  return highest;
}

function readMainCell(reader, vertexCount, mainX, mainZ) {
  const shapeCount = reader.i32(`shape count ${mainX},${mainZ}`);
  if (shapeCount < 0) throw new Error(`negative shape count at ${mainX},${mainZ}`);
  reader.ensure(shapeCount * 2, `shape indices ${mainX},${mainZ}`);
  for (let i = 0; i < shapeCount; i += 1) reader.u16(`shape index ${mainX},${mainZ},${i}`);

  const subCells = new Array(CELL_MAIN_DIVIDE * CELL_MAIN_DIVIDE);
  for (let z = 0; z < CELL_MAIN_DIVIDE; z += 1) {
    for (let x = 0; x < CELL_MAIN_DIVIDE; x += 1) {
      const count = reader.i32(`collision polygon count ${mainX},${mainZ}/${x},${z}`);
      if (count < 0) throw new Error(`negative collision polygon count at ${mainX},${mainZ}/${x},${z}`);
      reader.ensure(count * 3 * 4, `collision polygon indices ${mainX},${mainZ}/${x},${z}`);
      const indices = new Uint32Array(count * 3);
      for (let i = 0; i < indices.length; i += 1) {
        const index = reader.u32(`collision vertex index ${mainX},${mainZ}/${x},${z}/${i}`);
        if (index >= vertexCount) throw new Error(`collision vertex index ${index} out of range ${vertexCount}`);
        indices[i] = index;
      }
      subCells[z * CELL_MAIN_DIVIDE + x] = indices;
    }
  }
  return Object.freeze(subCells);
}

function intersectDownwardTriangle(x, z, vertices, index0, index1, index2) {
  const v0 = vertex(vertices, index0);
  const v1 = vertex(vertices, index1);
  const v2 = vertex(vertices, index2);
  const edge1 = sub(v1, v0);
  const edge2 = sub(v2, v0);

  let p = cross(edge1, edge2);
  let det = dot(p, { x: 0, y: -1, z: 0 });
  if (det > -TRIANGLE_EPSILON) return null;

  p = cross({ x: 0, y: -1, z: 0 }, edge2);
  det = dot(edge1, p);
  if (det < TRIANGLE_EPSILON) return null;

  const tVec = { x: x - v0.x, y: SHAPE_RAY_ORIGIN_Y - v0.y, z: z - v0.z };
  const u = dot(tVec, p);
  if (u < 0 || u > det) return null;
  const q = cross(tVec, edge1);
  const v = dot({ x: 0, y: -1, z: 0 }, q);
  if (v < 0 || u + v > det) return null;

  const t = dot(edge2, q) / det;
  if (t < 0) return null;
  return SHAPE_RAY_ORIGIN_Y - t;
}

function vertex(vertices, index) {
  const base = index * 3;
  return { x: vertices[base], y: vertices[base + 1], z: vertices[base + 2] };
}

function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function gitBlobSha1(buffer) {
  return crypto.createHash('sha1').update(`blob ${buffer.length}\0`).update(buffer).digest('hex');
}

function validateAssetIdentity(buffer, asset, zoneId) {
  if (asset.expectedByteLength != null && buffer.length !== asset.expectedByteLength) {
    throw new Error(`zone ${zoneId} SMD byte length mismatch expected=${asset.expectedByteLength} actual=${buffer.length}`);
  }
  if (asset.expectedGitBlobSha1) {
    const actual = gitBlobSha1(buffer);
    if (actual !== asset.expectedGitBlobSha1) {
      throw new Error(`zone ${zoneId} SMD git blob mismatch expected=${asset.expectedGitBlobSha1} actual=${actual}`);
    }
  }
}

module.exports = {
  HEIGHT_STATUS,
  MORADON_HEIGHT_AUTHORITY,
  SmdHeightMap,
  SmdHeightResolver,
  createMoradonHeightResolver,
  gitBlobSha1,
};
