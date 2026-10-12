// OldERA 1298 engine port — terrain behavior translated from ko4life-net/ko src/game/N3Terrain.cpp
// Renderer independent: no THREE / DOM dependency.
export const TILE_SIZE = 4;
export const EDGE_MARGIN = 30;

export class N3Terrain1298 {
  constructor(gtd) {
    if (!gtd || !Number.isInteger(gtd.n) || !gtd.h) throw new Error('Invalid 1298 GTD terrain');
    this.n = gtd.n;
    this.h = gtd.h;
  }

  getHeight(x, z) {
    const ix = Math.trunc(x) / TILE_SIZE | 0;
    const iz = Math.trunc(z) / TILE_SIZE | 0;
    if (ix < 0 || ix > this.n - 2 || iz < 0 || iz > this.n - 2) return -Number.MAX_VALUE;

    const dX = (x - ix * TILE_SIZE) / TILE_SIZE;
    const dZ = (z - iz * TILE_SIZE) / TILE_SIZE;
    let h1, h2, h3, h12, h13;

    // Exact diagonal parity used by CN3Terrain::GetHeight().
    if (((ix + iz) & 1) === 0) {
      h1 = this.h[ix][iz];
      h3 = this.h[ix + 1][iz + 1];
      if (dZ > dX) {
        h2 = this.h[ix][iz + 1];
        h12 = h1 + (h2 - h1) * dZ;
        h13 = h1 + (h3 - h1) * dZ;
        return dZ === 0 ? h1 : h12 + (h13 - h12) * (dX / dZ);
      }
      if (dX === 0) return h1;
      h2 = this.h[ix + 1][iz];
      h12 = h1 + (h2 - h1) * dX;
      h13 = h1 + (h3 - h1) * dX;
      return h12 + (h13 - h12) * (dZ / dX);
    }

    h1 = this.h[ix + 1][iz];
    h3 = this.h[ix][iz + 1];
    if (dX + dZ > 1) {
      if (dZ === 0) return h1;
      h2 = this.h[ix + 1][iz + 1];
      h12 = h1 + (h2 - h1) * dZ;
      h13 = h1 + (h3 - h1) * dZ;
      return h12 + (h13 - h12) * ((1 - dX) / dZ);
    }
    if (dX === 1) return h1;
    h2 = this.h[ix][iz];
    h12 = h2 + (h1 - h2) * dX;
    h13 = h3 + (h1 - h3) * dX;
    return h12 + (h13 - h12) * (dZ / (1 - dX));
  }

  isInTerrain(x, z) {
    const max = (this.n - 1) * TILE_SIZE;
    return !(x < EDGE_MARGIN || x > max - EDGE_MARGIN || z < EDGE_MARGIN || z > max - EDGE_MARGIN);
  }

  getNormal(x, z) {
    const max = (this.n - 1) * TILE_SIZE;
    if (x < 10 || x > max - 10 || z < 10 || z > max - 10) return {x:0,y:1,z:0};
    const ix = Math.trunc(x) / TILE_SIZE | 0;
    const iz = Math.trunc(z) / TILE_SIZE | 0;
    const dX = (x - ix * TILE_SIZE) / TILE_SIZE;
    const dZ = (z - iz * TILE_SIZE) / TILE_SIZE;
    let a,b;
    if (((ix + iz) & 1) === 1) {
      if (dX + dZ < 1) {
        a = {x:0, y:this.h[ix][iz+1]-this.h[ix][iz], z:TILE_SIZE};
        b = {x:TILE_SIZE, y:this.h[ix+1][iz]-this.h[ix][iz], z:0};
      } else {
        a = {x:0, y:this.h[ix+1][iz]-this.h[ix+1][iz+1], z:-TILE_SIZE};
        b = {x:-TILE_SIZE, y:this.h[ix][iz+1]-this.h[ix+1][iz+1], z:0};
      }
    } else {
      if (dZ > dX) {
        a = {x:0, y:this.h[ix][iz+1]-this.h[ix][iz], z:TILE_SIZE};
        b = {x:TILE_SIZE, y:this.h[ix+1][iz+1]-this.h[ix][iz+1], z:0};
      } else {
        a = {x:TILE_SIZE, y:this.h[ix+1][iz]-this.h[ix][iz], z:0};
        b = {x:0, y:this.h[ix+1][iz+1]-this.h[ix+1][iz], z:TILE_SIZE};
      }
    }
    const n = {x:a.y*b.z-a.z*b.y, y:a.z*b.x-a.x*b.z, z:a.x*b.y-a.y*b.x};
    const m = Math.hypot(n.x,n.y,n.z) || 1;
    return {x:n.x/m,y:n.y/m,z:n.z/m};
  }
}
