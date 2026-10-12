export const TILE_SIZE = 4.0;
export const NEGATIVE_FLT_MAX = -3.4028234663852886e38;

const f32 = Math.fround;

function cppGridIndex(value) {
  // C++ source casts float -> int, then performs integer division.
  return Math.trunc(Math.trunc(value) / Math.trunc(TILE_SIZE));
}

function mixFloat(a, b, t) {
  return f32(f32(a) + f32(f32(f32(b) - f32(a)) * f32(t)));
}

export class N3TerrainSampler {
  constructor(mapSize, heights) {
    if (!Number.isInteger(mapSize) || mapSize < 2) throw new Error('mapSize must be an integer >= 2');
    if (!(heights instanceof Float32Array)) throw new TypeError('heights must be a Float32Array');
    if (heights.length !== mapSize * mapSize) {
      throw new Error(`height count mismatch: expected ${mapSize * mapSize}, got ${heights.length}`);
    }
    this.mapSize = mapSize;
    this.heights = heights;
  }

  static fromTerrain(terrain) {
    return new N3TerrainSampler(terrain.mapSize, terrain.heights);
  }

  heightAtGrid(x, z) {
    return this.heights[x * this.mapSize + z];
  }

  getHeight(x, z) {
    x = f32(x);
    z = f32(z);

    const ix = cppGridIndex(x);
    const iz = cppGridIndex(z);

    if (ix < 0 || ix > this.mapSize - 2) return NEGATIVE_FLT_MAX;
    if (iz < 0 || iz > this.mapSize - 2) return NEGATIVE_FLT_MAX;

    const dX = f32(f32(x - f32(ix * TILE_SIZE)) / TILE_SIZE);
    const dZ = f32(f32(z - f32(iz * TILE_SIZE)) / TILE_SIZE);

    let h1;
    let h2;
    let h3;
    let h12;
    let h13;

    if (((ix + iz) % 2) === 0) {
      h1 = this.heightAtGrid(ix, iz);
      h3 = this.heightAtGrid(ix + 1, iz + 1);

      if (dZ > dX) {
        h2 = this.heightAtGrid(ix, iz + 1);
        h12 = mixFloat(h1, h2, dZ);
        h13 = mixFloat(h1, h3, dZ);
        return mixFloat(h12, h13, f32(dX / dZ));
      }

      if (dX === 0.0) return h1;
      h2 = this.heightAtGrid(ix + 1, iz);
      h12 = mixFloat(h1, h2, dX);
      h13 = mixFloat(h1, h3, dX);
      return mixFloat(h12, h13, f32(dZ / dX));
    }

    h1 = this.heightAtGrid(ix + 1, iz);
    h3 = this.heightAtGrid(ix, iz + 1);

    if (f32(dX + dZ) > 1.0) {
      if (dZ === 0.0) return h1;
      h2 = this.heightAtGrid(ix + 1, iz + 1);
      h12 = mixFloat(h1, h2, dZ);
      h13 = mixFloat(h1, h3, dZ);
      return mixFloat(h12, h13, f32(f32(1.0 - dX) / dZ));
    }

    if (dX === 1.0) return h1;
    h2 = this.heightAtGrid(ix, iz);
    h12 = mixFloat(h2, h1, dX);
    h13 = mixFloat(h3, h1, dX);
    return mixFloat(h12, h13, f32(dZ / f32(1.0 - dX)));
  }
}
