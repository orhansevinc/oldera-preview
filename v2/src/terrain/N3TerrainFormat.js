import { BinaryReader } from '../core/BinaryReader.js';

export const N3_TERRAIN_LIMITS = Object.freeze({
  maxTerrainVersion: 2,
  maxNameLength: 30,
  maxMapSpan: 4096,
  mapDataBytes: 8,
});

export function decodeMapTile(packed) {
  const value = packed >>> 0;
  return {
    isTileFull: Boolean(value & 0x1),
    tex1Dir: (value >>> 1) & 0x1f,
    tex2Dir: (value >>> 6) & 0x1f,
    tex1Idx: (value >>> 11) & 0x3ff,
    tex2Idx: (value >>> 21) & 0x3ff,
  };
}

/**
 * Parses the leading terrain section used by KO 1298-era (1264+) .gtd files.
 *
 * Source behavior mirrored from CN3Terrain::Load:
 *   int terrainVersion
 *   int nameLength
 *   byte[nameLength] name
 *   int mapSize
 *   MAPDATA[mapSize * mapSize]
 *
 * Later terrain sections are intentionally left untouched for the first v2
 * milestone. Their byte count is reported as trailingByteLength.
 */
export function parseN3Terrain1298(input) {
  const reader = new BinaryReader(input);
  const { maxTerrainVersion, maxNameLength, maxMapSpan, mapDataBytes } = N3_TERRAIN_LIMITS;

  const terrainVersion = reader.readInt32();
  if (terrainVersion < 0 || terrainVersion > maxTerrainVersion) {
    throw new Error(`Invalid N3 terrain version: ${terrainVersion}`);
  }

  const nameLength = reader.readInt32();
  if (nameLength < 0 || nameLength > maxNameLength) {
    throw new Error(`Invalid N3 terrain name length: ${nameLength}`);
  }

  const name = nameLength > 0 ? reader.readByteString(nameLength) : '';
  const mapSize = reader.readInt32();

  if (mapSize <= 0 || (mapSize - 1) > maxMapSpan) {
    throw new Error(`Invalid N3 terrain map size: ${mapSize}`);
  }
  if (((mapSize - 1) % 4) !== 0) {
    throw new Error(`Invalid N3 terrain map size ${mapSize}: (mapSize - 1) must be divisible by 4`);
  }

  const pointCount = mapSize * mapSize;
  const mapDataByteLength = pointCount * mapDataBytes;
  reader.ensure(mapDataByteLength, 'MAPDATA array');

  const heights = new Float32Array(pointCount);
  const tiles = new Uint32Array(pointCount);

  for (let i = 0; i < pointCount; i += 1) {
    heights[i] = reader.readFloat32();
    tiles[i] = reader.readUint32();
  }

  return Object.freeze({
    fileFamily: 'N3Terrain-1264+',
    terrainVersion,
    name,
    mapSize,
    pointCount,
    heights,
    tiles,
    mapDataEndOffset: reader.offset,
    trailingByteLength: reader.remaining,
  });
}
