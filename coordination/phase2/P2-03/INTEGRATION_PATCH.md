# P2-03 integration patch

P2-00 should consume this provider as a source patch in the reconciled real-client build. Do not copy an old `real1298` WASM artifact and do not edit website/admin assets.

## Pins

- Phase 2 base: `ws50-integration-rehearsal@50ecabec15bd358d222a01891ca31359f3a928b0`
- accepted OpenKO source: `luisfelipe18/old-school-openko@97eb0ea20207afc0c360bfed6915113572711be3`
- WS05 continuation inspected: `ws05-moradon-world@b55cab4e79a200d103472d16c231011cc1263548`
- WS43 display continuation inspected: `ws43-client-display-compat@8ccf0fcb643ec1ebb5f019e8f53c8d3d93f85e03`

## Build order

After P2-00 checks out the exact OpenKO pin, apply the canonical accepted WS04/WS05 browser/game patches in their existing order. Immediately after the WS05 base browser patch has created its Emscripten 1024x768 compatibility block, run:

```bash
python3 tools/p2_03_patch_openko_render.py openko
```

Then apply the remaining non-conflicting Phase 2 owner patches and build `KnightOnLine.js/.wasm/.data` once from the reconciled source tree.

The script is fail-closed: its anchors must match exactly once and it is idempotent after its own markers exist.

## Shared C++ delta requested from P2-00

The generated patch is intentionally limited to two accepted upstream files:

- `src/Client/WarFare/WarFareMainSDL.cpp`
  - remove browser-only forced `1024x768` logical resolution and forced window mode;
  - preserve browser software cursor choice;
  - derive logical size from the live canvas CSS rectangle;
  - set backing-store size separately using bounded render scale;
  - update logical D3D viewport on resize/fullscreen/scale changes;
  - expose render/FPS/memory metrics.
- `src/Client/WarFare/RHIDeviceGL.cpp`
  - refresh physical drawable dimensions from the Emscripten canvas before GL draws so viewport/scissor use current backing pixels;
  - retain logical D3D coordinates for UI/camera/picking;
  - expose texture/mipmap creation telemetry without substituting assets or overriding sampler art direction.

No loader HTML, CSS, P2-10 input source, final WASM/data/index, runtime composition, website, account, or admin file is owned by this patch.

## P2-10 merge rule

Consume `P2-03/render-coordinate-contract-v1` from `RENDER_CONTRACT.md`. Pointer coordinates are logical CSS-space coordinates; backing/DPR scaling is render-only. Any P2-10 patch that multiplies picking coordinates by `renderScale` or `devicePixelRatio` conflicts with this contract.

## Acceptance commands

Static provider gate:

```bash
python3 -m py_compile tools/p2_03_patch_openko_render.py tests/p2-03/test_render_patch.py
python3 -m pytest -q tests/p2-03/test_render_patch.py
```

Integrated browser matrix after P2-00 builds the candidate:

```bash
npm install --no-save playwright@1.55.0
P2_03_URL=http://127.0.0.1:<candidate-port>/ P2_03_LABEL=after node qa/p2-03/render_probe.mjs
```

Repeat against the pinned pre-P2-03 candidate with `P2_03_LABEL=before` at the same camera/state for before/after evidence. Final PC/domain evidence belongs to P2-00/P2-13.