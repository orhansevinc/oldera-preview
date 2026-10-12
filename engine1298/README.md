# OldERA 1298 engine port

This branch replaces the old prototype's hand-written gameplay logic. Rendering may use a web renderer, but game behavior must live outside the renderer and be translated from the 1298-compatible KO client source.

## Rules

1. `worldv36.js` and earlier prototype runtimes are not the engine baseline.
2. No camera-relative WASD movement. Player movement follows `GameProcMain.cpp` / `PlayerMySelf.cpp`.
3. No non-uniform 1024x768 UI stretching. The virtual screen is uniformly letterboxed.
4. Terrain sampling follows `CN3Terrain::GetHeight()` triangle parity, not bilinear interpolation.
5. Collision order follows `CPlayerMySelf::CheckCollision()`; renderer raycasts are adapters, not the gameplay definition.
6. 1298 assets remain the visual source: GTD/TCT/OPD/N3/UIF/DXT/TBL/CHR.
7. Newer KO4Life content/systems are not imported.

## Source mapping

- `engine1298/terrain.js`
  - `src/game/N3Terrain.cpp::GetHeight`
  - `src/game/N3Terrain.cpp::GetNormal`
  - `src/game/N3Terrain.cpp::IsInTerrain`
- `engine1298/player.js`
  - `src/game/GameProcMain.cpp` keyboard movement order
  - `src/game/PlayerMySelf.cpp::RotAdd`
  - `src/game/PlayerMySelf.cpp::MoveSpeedCalculationAndCheckCollision`
  - `src/game/PlayerMySelf.cpp::CheckCollision`
  - `src/game/GameDef.h` movement constants
- `engine1298/viewport.js`
  - Browser adapter for the original fixed UI coordinate space. This prevents the distorted X/Y scaling visible in the rejected v38 test.

## Next integration gate

A browser build is not promoted to `main` until all of these pass together:

- launcher -> login -> server -> character -> Moradon flow
- original 1298 UI at correct aspect ratio
- UI buttons receive clicks without leaking input to the world
- forward/back + rotation use source-derived behavior
- terrain height and boundary logic use the engine port
- character remains grounded on ramps
- shape collision blocks walls without blocking walkable floor/steps
- no prototype HUD layers are automatically shown

The public `main` branch stays on the last known preview while this branch is developed.
