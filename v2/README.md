# OldERA v2

Clean browser runtime experiment for Knight Online 1298.

Principles:
- one 1024x768 logical WebGL2 canvas
- uniform letterbox scaling only
- no Three.js
- no DOM gameplay UI
- state-machine ownership of runtime lifecycle
- original 1298 asset formats remain the source of truth
- source-derived behavior will move into isolated KO core / WASM modules incrementally

Current vertical slice: original Moradon GTD + TCT + nearby OPD/N3PMesh/Object textures rendered directly with WebGL2.
