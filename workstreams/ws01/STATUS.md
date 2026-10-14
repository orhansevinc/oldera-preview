WS01

# STATUS — True Widescreen / Native Backing-Store Runtime

## Decision

**TRUE WIDESCREEN RUNTIME: READY**

Branch: `ws01-runtime-build`
Validated implementation commit: `bbafbcfa0ddfcae307d26ac39d4bc7ed4727038b`

This is the existing WS01 control session. No new workstream was created.

## Problem closed

The real OpenKO/Emscripten browser baseline forced the native client to `1024x768` inside generated `WarFareMainSDL.cpp`. The canonical WS10 Moradon PASS therefore rendered a genuine `1024x768` framebuffer; preserving aspect ratio on a 16:9 browser correctly produced side bars.

WS01 now removes that unconditional browser-only `1024x768` backing assumption and supplies a config-driven native SDL/Emscripten/WebGL2 display path. This is not CSS stretch and does not recreate the game UI in HTML.

## Delivered runtime behavior

### Native resolution modes

- default `viewport`: native SDL logical size and Emscripten canvas/default framebuffer follow the browser viewport;
- `classic`: authentic `1024x768` native fallback;
- `fixed`: explicit native dimensions such as `1920x1080`.

Validated widescreen matrix:

```text
1280x720
1366x768
1600x900
1920x1080
```

### Native backing, not presentation scaling

Initial dimensions are resolved before SDL window/renderer/UI initialization. Runtime viewport/fullscreen changes use `SDL_SetWindowSize()` and synchronize:

- `CN3Base::s_Options.iViewWidth/iViewHeight`;
- Emscripten canvas/default framebuffer dimensions;
- full D3D/RHI viewport;
- RHIDeviceGL cached framebuffer dimensions and pixel-density bookkeeping.

`RHIDeviceGL` refreshes the browser default-framebuffer size before draw state/viewport/scissor application as well as after present, preventing a stale one-frame `1024x768` geometry after resize.

### DPR invariant

WS43 requires browser `devicePixelRatio` not to silently multiply the selected native resolution. WS01 therefore disables `SDL_WINDOW_HIGH_PIXEL_DENSITY` only for the Emscripten browser window. Native desktop builds preserve upstream high-DPI behavior.

The final real Chromium smoke runs at `devicePixelRatio=2` and requires the selected logical size, canvas backing, default framebuffer and WebGL/RHI viewport to remain exactly the target size. `1920x1080` therefore stays native `1920x1080`, not `3840x2160`.

### UI / input / fullscreen

- genuine KO UIF/N3 UI is retained;
- no Three.js, Canvas2D or fake HTML HUD was added;
- no non-uniform canvas/UI stretch or crop is used;
- CSS only performs aspect-preserving presentation fit when needed;
- SDL mouse coordinates remain logical-window coordinates;
- browser diagnostic mapping verifies native pointer alignment;
- browser resize and `fullscreenchange` feed the same native display resolver/sync path;
- browser fullscreen entry/exit is delegated to a genuine browser input event rather than a fake native fullscreen mode switch.

### Public WSS retained

The existing config-driven browser transport remains intact:

```text
server target *:15100 -> same-origin auth endpoint /auth
server target *:15001 -> same-origin game endpoint /game
HTTPS -> wss://
local HTTP -> ws://
```

Native desktop TCP remains unchanged. The final validation reran the public transport tests: **9/9 PASS**.

## Dependency evidence consumed

- `main` observed: `c75118905217343d30d3e25cf24a1552a5dc82b1`.
- browser baseline: `18282d0e70de7ccb30244a9f09e2b3bff3040155`.
- pinned OpenKO: `97eb0ea20207afc0c360bfed6915113572711be3`.
- pinned genuine KO 1298 assets: `2055ee6ed77f1b5cfef23832dd5bc31909e14a66`.
- Emscripten: `6.0.12`.
- WS43 exact display contract head: `8ccf0fcb643ec1ebb5f019e8f53c8d3d93f85e03`.
- canonical WS10 Moradon PASS: run `38505039290` (#26), tested harness commit `f0cadfb50b5d1a36d2bfe4e5bf0a68f7c3061f41`, frozen client artifact `11867980473`.
- WS50 READY handoff head observed: `9e0fc1822351965755fc490c2d2abf34d40f430d`.
- WS09 public ephemeral evidence: run `38510331579`, job `115677506671`; HTTPS publication, strict MIME, WSS `/auth` + `/game` smoke and WS12 preflight passed before keepalive.

Full dependency detail is in `workstreams/ws01/DEPENDENCY_SNAPSHOT.md`.

## Verification actually run

GitHub Actions:

```text
workflow  WS01 Runtime Build
run       38513332857 (#12)
job       115686662234
head      bbafbcfa0ddfcae307d26ac39d4bc7ed4727038b
result    SUCCESS
artifact  ws01-runtime-evidence / 11870948283
digest    sha256:d93e427d5ddeed22b18af3af548c5ea42482d2ded543ac540b43cd28cffe5878
```

Passing gates include:

- pinned OpenKO and authentic 1298 asset verification: PASS;
- public WebSocket transport tests: **9/9 PASS**;
- native browser display contract tests: **8/8 PASS**;
- fixed Emscripten `1024x768` override absence gate: PASS;
- generated browser resize/DPR guard source validation: PASS;
- real Emscripten 6.0.12 configure: PASS;
- real WarFare WASM build: PASS;
- rebuilt package validation: PASS;
- real Chromium WebGL2/OpenGL login bootstrap: PASS;
- real Chromium native resize matrix at DPR=2: PASS;
- `1280x720`, `1366x768`, `1600x900`, `1920x1080`: PASS;
- classic native `1024x768` fallback: PASS;
- canvas/default framebuffer/RHI/WebGL full viewport agreement: PASS;
- pointer-center alignment and aspect-distortion rejection: PASS;
- fullscreen-change native resize path: PASS;
- runtime evidence upload: PASS.

## Canonical WS10 relation

The frozen WS10 PASS artifact remains immutable proof of the previous real `1024x768` Moradon path. WS01 did not alter that artifact or claim it became widescreen.

A new downstream WS10/WS43 integration acceptance should rebuild/compose the client with this WS01 provider and capture Moradon HUD/inventory/dialog plus edge/corner clicks and real headed fullscreen at widescreen. That is a downstream live-state acceptance step, not a remaining WS01 native backing-store blocker.

## WS50 / staging handoff

Use the narrow composition documented in `workstreams/ws01/INTEGRATION_PATCH.md`: consume `openko-web/index.html` and `tools/ws01_runtime/**`, apply the established browser/provider patches first, then run both:

```bash
python3 tools/ws01_runtime/prepare_browser_source.py
python3 tools/ws01_runtime/normalize_generated_browser_source.py
```

WS50/WS09 must re-freeze this new provider before any public link is described as the widescreen build. Existing public staging proves the WSS/publication topology but contains the older WS01 provider.

## Boundaries

- no merge to `main`;
- no force push;
- no other workstream branch modified;
- no WS02/WS09/WS12 provider implementation modified;
- no fake KO renderer/UI added;
- no production DNS/domain/certificate assumption introduced.

BU SOHBETE ARTIK GEREK VAR MI?: HAYIR
