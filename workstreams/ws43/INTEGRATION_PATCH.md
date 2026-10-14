WS43

# INTEGRATION PATCH

## Decision

**DISPLAY FULLSCREEN: READY** inside the WS43 ownership boundary.

True bars-free widescreen is intentionally handed to WS01 as a native runtime/backing-store change; it is not simulated here.

## Current 4:3 activation request

The production real-client entry page is `openko-web/index.html`, which is owned outside WS43. Serve `tools/ws43_display/display-compat.js` with the client and load it after the real `#canvas` exists. It may load before or after `KnightOnLine.js`; it watches later canvas backing-size changes.

Example integration shape:

```html
<script src="../tools/ws43_display/display-compat.js"></script>
<script async type="text/javascript" src="KnightOnLine.js"></script>
```

No UI HTML, UIF assets, renderer code, gameplay code or backing-store dimensions are replaced by this include.

## Important canonical-page interaction

The current WS01 page has a legacy `#stage` transform that scales a fixed `1024x768` wrapper. WS43 now neutralizes that wrapper every display reflow before positioning the canvas. This avoids ancestor-transform double scaling after resize/fullscreen while keeping the real canvas DOM node and `Module.canvas` identity unchanged.

Runtime behavior:

- `canvas.width` / `canvas.height` remain native-authoritative;
- only CSS position/size is used for presentation fit;
- non-uniform stretch is impossible;
- no crop is used;
- reflow triggers: resize, orientation, fullscreen and `visualViewport` resize/scroll;
- native backing attribute changes trigger reflow;
- DPR is diagnostic only and never multiplies native logical size;
- pointer events are not consumed/re-written;
- `requestFullscreen()` and `exitFullscreen()` are exposed for a launcher/user-gesture integration; fullscreen targets the document root so browser UA canvas stretching is not relied upon.

A launcher may call:

```js
await window.__WS43_DISPLAY_COMPAT__.requestFullscreen();
```

from an actual user gesture. Browser F11/native browser fullscreen also works through the same resize/fullscreen listeners.

## Exact WS01 handoff

WS01 must consume:

`workstreams/ws43/WS01_WIDESCREEN_CONTRACT.md`

Key non-negotiable points:

- canonical target native backing: `1920x1080`;
- required native matrix: `1280x720`, `1366x768`, `1600x900`, `1920x1080`;
- retain `1024x768` fallback;
- backing size, SDL native view size and GL default framebuffer must agree;
- resize/fullscreen goes through SDL/Emscripten native resize events, not WS43 JS backing mutation;
- GL viewport/scissor must update to the new drawable size;
- real UIF rendering and native hit testing must remain aligned;
- no CSS stretch/crop/HTML HUD workaround.

## Integrated live acceptance

After WS01 true-native widescreen is available, run one real browser session through:

1. login;
2. character select/create as needed;
3. Moradon HUD;
4. inventory open/close;
5. real dialog;
6. center and edge/corner clicks;
7. window resize;
8. fullscreen enter;
9. fullscreen exit.

Capture WS43 geometry diagnostics plus WS04/WS10 native framebuffer evidence. The passing result must show matching native backing/framebuffer dimensions and zero bars on matching 16:9 viewport/backing pairs.

Until that WS01 change exists, symmetric bars are the correct 4:3 behavior and must remain visible.
