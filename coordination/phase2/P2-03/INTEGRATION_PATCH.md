# P2-03 integration patch

P2-00 should consume this provider as a source patch in the reconciled real-client build. Do not copy an old `real1298` WASM artifact and do not edit website/admin assets.

## Pins

- Phase 2 base: `ws50-integration-rehearsal@50ecabec15bd358d222a01891ca31359f3a928b0`
- accepted OpenKO source: `luisfelipe18/old-school-openko@97eb0ea20207afc0c360bfed6915113572711be3`
- WS05 continuation inspected: `ws05-moradon-world@b55cab4e79a200d103472d16c231011cc1263548`
- WS43 display continuation inspected: `ws43-client-display-compat@8ccf0fcb643ec1ebb5f019e8f53c8d3d93f85e03`
- P2-10 handoff consumed: `phase2/10-client-ui@748a589872948388768d19be965e3264cd7cec2c`

## Build order

After P2-00 checks out the exact OpenKO pin, apply the canonical accepted WS04/WS05 browser/game patches in their existing order. Immediately after the WS05 base browser patch has created its Emscripten 1024x768 compatibility block, run:

```bash
python3 tools/p2_03_patch_openko_render.py openko
```

Then apply P2-10 and the remaining non-conflicting Phase 2 client patches and build `KnightOnLine.js/.wasm/.data` once from the reconciled source tree. The P2-03 script is fail-closed on changed anchors and idempotent after its own markers exist.

## Shared C++ delta requested from P2-00

The generated patch is intentionally limited to two accepted upstream files:

- `src/Client/WarFare/WarFareMainSDL.cpp`
  - remove only the browser-only forced `1024x768` logical resolution;
  - preserve accepted browser window-mode and software-cursor behavior;
  - choose initial logical size from `visualViewport`/window before SDL/UI initialization, then track resize/fullscreen changes;
  - set backing-store size separately using bounded render scale;
  - update logical D3D viewport and publish render/FPS/memory telemetry.
- `src/Client/WarFare/RHIDeviceGL.cpp`
  - refresh physical drawable dimensions from the Emscripten canvas before GL draws so viewport/scissor use current backing pixels;
  - retain logical D3D coordinates for UI/camera/picking;
  - expose texture/mipmap creation telemetry without substituting assets or overriding sampler art direction.

No loader HTML/CSS, P2-10 input source, final WASM/data/index, runtime composition, website/account, or admin file is owned by this patch.

## P2-10 merge rule

P2-10 requested one provider-owned viewport-to-game transform and no duplicate coordinate math. Consume `P2-03/render-coordinate-contract-v1` from `RENDER_CONTRACT.md`: pointer coordinates are logical CSS-space coordinates; backing/DPR scaling is render-only. Any input patch that multiplies picking coordinates by `renderScale` or `devicePixelRatio` conflicts with this contract.

P2-00/P2-10 should also smoke ALT+ENTER once after composition: P2-10 adds a physical-event fullscreen path while upstream still contains frame-loop ALT+ENTER polling. P2-03 does not own that input reconciliation.

## Acceptance commands

Static provider gate:

```bash
python3 -m py_compile tools/p2_03_patch_openko_render.py tests/p2-03/test_render_patch.py
python3 -m pytest -q tests/p2-03/test_render_patch.py
```

Integrated browser matrix after P2-00 builds the candidate:

```bash
npm install --no-save playwright@1.55.0
P2_03_URL=http://127.0.0.1:<candidate-port>/ P2_03_LABEL=after node tools/p2_03_render_probe.mjs
```

Repeat against the pinned pre-P2-03 candidate with `P2_03_LABEL=before` at the same game state/camera. The matrix is 2 resolutions x 3 scale factors x 2 modes = 12 cases. Final local/domain evidence belongs to P2-00/P2-13.