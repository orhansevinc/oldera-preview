# OldERA v2 terrain core

This directory is the clean runtime line for OldERA. It intentionally does not depend on the legacy preview's Three.js scene or its hand-authored gameplay approximations.

## Milestone 1

- Read the KO 1298-era (N3 1264+) `.gtd` terrain header.
- Read the original `MAPDATA` grid as little-endian `float height + uint32 packed tile data` records.
- Reproduce `CN3Terrain::GetHeight(float x, float z)` semantics, including alternating tile diagonals and the original `-FLT_MAX` out-of-range sentinel.
- Provide a browser-only diagnostic page that accepts a local `.gtd`; client assets are not committed into this repository.
- Keep later `.gtd` sections unparsed for now and report their remaining byte count.

## Source-of-truth paths

Behavior is based on Open-KO/KnightOnline v1298 source, primarily:

- `src/Client/WarFare/N3Terrain.cpp` (`CN3Terrain::Load`, `CN3Terrain::GetHeight`)
- `src/Client/WarFare/N3TerrainDef.h` (`TILE_SIZE`, `MAPDATA`)

The next terrain milestone is to parse the remaining tile/texture sections and generate renderer-neutral terrain buffers from the same data. Rendering stays downstream of KO semantics.

## Test

```bash
cd v2
npm test
```
