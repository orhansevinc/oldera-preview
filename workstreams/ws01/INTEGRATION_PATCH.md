WS01

# INTEGRATION PATCH — True Widescreen / Native Backing Runtime

## Provider decision

**TRUE WIDESCREEN RUNTIME: READY**

Validated implementation commit:

```text
bbafbcfa0ddfcae307d26ac39d4bc7ed4727038b
```

Validation:

```text
workflow  WS01 Runtime Build
run       38513332857 (#12)
job       115686662234
result    SUCCESS
artifact  11870948283 (ws01-runtime-evidence)
digest    sha256:d93e427d5ddeed22b18af3af548c5ea42482d2ded543ac540b43cd28cffe5878
```

This is a narrow provider handoff. It does not authorize a full browser-branch merge.

## Exact blocker removed

The established browser baseline injected this Emscripten-only override into `WarFareMainSDL.cpp`:

```cpp
CN3Base::s_Options.iViewWidth  = 1024;
CN3Base::s_Options.iViewHeight = 768;
```

That made the native SDL/canvas/default framebuffer `1024x768`; correct aspect-preserving browser presentation therefore had unavoidable side bars on 16:9 screens.

WS01 now replaces the fixed generated block with a browser display resolver and native SDL resize path. No CSS stretch, crop, Canvas2D/Three.js renderer or HTML KO HUD was introduced.

## Native display contract

Canonical browser configuration is available before `KnightOnLine.js` starts:

```js
window.__OLDKO_DISPLAY_CONFIG__ = {
  mode: 'viewport'
};
```

Supported modes:

```text
viewport  -> native SDL/canvas/default framebuffer follows browser viewport
classic   -> native 1024x768 fallback
fixed     -> explicit native width/height, e.g. 1920x1080
```

Required matrix validated by WS01:

```text
1280x720
1366x768
1600x900
1920x1080
```

`devicePixelRatio` is deliberately not a render-resolution multiplier. The real Chromium acceptance run executes at DPR=2 and requires the selected logical size, canvas backing, default framebuffer and WebGL/RHI full viewport to remain the exact selected native dimensions.

Native desktop builds keep upstream high-pixel-density behavior and native TCP behavior.

## Resize / fullscreen runtime path

For Emscripten:

1. `browser_display_pre.js` resolves the desired native browser size.
2. `OldKOWebApplyInitialBrowserDisplayOptions()` establishes the initial `CN3Base::s_Options` size before window/renderer/UI initialization.
3. `OldKOWebSyncBrowserDisplay()` uses `SDL_SetWindowSize()` for browser viewport/fullscreen changes.
4. The same function synchronizes `s_Options.iViewWidth/iViewHeight`, pixel-density bookkeeping and a full-surface D3D/RHI viewport.
5. `RHIDeviceGL` refreshes default framebuffer geometry before fixed state/viewport/scissor application and after present.
6. Browser fullscreen itself is requested from a genuine browser key/user event; native code does not fake browser fullscreen.

The runtime does not resize offscreen render targets opportunistically. Their explicit dimensions stay owned by their creators; only the default browser framebuffer follows the native window/canvas contract.

## UI and pointer invariants

- Genuine N3/UIF UI remains the only KO UI.
- No UI texture is non-uniformly scaled by WS01.
- The canvas CSS layer preserves the native backing aspect ratio and only performs uniform viewport fit when source and viewport differ.
- SDL mouse input stays in logical window coordinates.
- WS01 diagnostics compare browser client coordinates against native logical coordinates and require center alignment within one logical pixel.
- The matrix smoke checks backing aspect versus CSS aspect and rejects distortion.

The remaining live state-specific acceptance requested by WS43 (HUD/inventory/dialog edge controls through real Moradon) should be executed downstream with this provider. It is not a native backing-store implementation blocker.

## Public WSS contract retained

This provider still includes the previously validated browser transport resolver:

```text
*:15100 -> auth route -> same-origin /auth
*:15001 -> game route -> same-origin /game
HTTP page  -> ws://
HTTPS page -> wss://
```

Unknown/ambiguous/insecure mappings fail closed. Native desktop TCP is unchanged. Run `38513332857` reran the 9/9 transport contract tests successfully.

Latest public staging evidence observed from WS09 run `38510331579` / job `115677506671` shows the existing frozen candidate passed public HTTPS publication, strict MIME, actual WSS `/auth` + `/game` upgrade smoke and WS12 publication preflight. That candidate predates this new widescreen provider and must be re-frozen before it can represent the widescreen build.

## Narrow composition order

WS50 / WS10 disposable browser builds should retain the established order and consume the WS01 provider-owned slice from the validated commit:

```text
openko-web/index.html
tools/ws01_runtime/**
```

After the established browser/provider patches, run:

```bash
python3 tools/ws01_runtime/prepare_browser_source.py
python3 tools/ws01_runtime/normalize_generated_browser_source.py
```

The normalizer is required: in addition to normalizing the generated GL-resize block, it enforces Emscripten-only DPR-independent backing while preserving desktop `SDL_WINDOW_HIGH_PIXEL_DENSITY` behavior.

Do not copy generated patched OpenKO source from a CI workspace as a new source-of-truth; reproduce it with the provider scripts.

## Downstream acceptance

For a new canonical widescreen Moradon artifact, compose this WS01 provider with the current WS02/WS03/WS05/WS14 providers and rerun the real WS10 flow. Add headed/live checks for:

```text
login -> character -> Moradon HUD -> inventory/dialog
center + corner/edge controls
resize
browser fullscreen enter/exit
```

Required geometry at matching 16:9 viewport/native sizes is zero-bar, with canvas/default framebuffer/RHI viewport matching the selected native target.

## Files delivered by this WS01 control

```text
.github/workflows/ws01-runtime.yml
openko-web/index.html
tools/ws01_runtime/browser_display_pre.js
tools/ws01_runtime/display_config.test.cjs
tools/ws01_runtime/prepare_browser_source.py
tools/ws01_runtime/normalize_generated_browser_source.py
tools/ws01_runtime/runtime_smoke.cjs
# existing public WSS runtime files remain part of the provider slice
workstreams/ws01/DEPENDENCY_SNAPSHOT.md
workstreams/ws01/INTEGRATION_PATCH.md
workstreams/ws01/STATUS.md
```

No main merge, force push or other workstream branch modification was performed.
