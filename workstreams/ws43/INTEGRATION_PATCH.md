WS43

# INTEGRATION_PATCH

## Why an integration patch is required

The production real-client entry page is `openko-web/index.html`, but WS43 is not permitted to edit that shared source. Therefore the compatibility implementation is complete inside the WS43-owned area, while production activation is conditional on one shared-source include.

## Requested shared-source change

Serve `tools/ws43_display/display-compat.js` with the client and load it from `openko-web/index.html` after the page has created the real `#canvas` / `Module.canvas` reference. The shim can be loaded before or after `KnightOnLine.js`; it auto-installs on DOM readiness and watches canvas `width`/`height` attribute changes made later by Emscripten.

Example integration shape (path may change according to final static publication layout):

```html
<script src="../tools/ws43_display/display-compat.js"></script>
<script async type="text/javascript" src="KnightOnLine.js"></script>
```

No UI HTML, UIF assets, renderer code, gameplay code, or backing-store resolution should be replaced by this integration.

## Runtime behavior introduced by the shim

- Native `canvas.width` and `canvas.height` remain authoritative.
- Only CSS `left`, `top`, `width`, and `height` are used for viewport fitting.
- Aspect ratio is preserved; incompatible viewports receive centered black letterboxing.
- Reflow triggers: window resize, orientation change, fullscreen change, visual viewport resize/scroll, and native canvas width/height changes.
- The shim does not register pointer handlers that consume or rewrite Emscripten events.
- `mapPointer()` exists only as a diagnostic to verify CSS-to-backing coordinate alignment.

## Integration acceptance run

After the include is added by the owning integration workstream, run the WS43 CI plus one headed-browser session through:

1. login,
2. nation select,
3. character select,
4. in-game HUD,
5. inventory open/close,
6. at least one dialog,
7. visible button clicks near center and edges,
8. browser toolbar zoom in/out,
9. enter fullscreen and exit fullscreen.

Capture the generated geometry screenshots plus state screenshots. Do not replace missing real-client states with mock UI evidence.
