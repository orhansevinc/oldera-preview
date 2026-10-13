# WS41 browser input compatibility helper

`input_compat.mjs` is a **browser-shell compatibility helper**, not a second game input engine.
It intentionally does not translate DOM keys into Knight Online actions and does not synthesize SDL events.
The real path remains:

`DOM event -> SDL3 Emscripten backend -> SDL_Scancode -> OpenKO DIK_* -> CLocalInput`

The helper owns only browser concerns that sit outside the game model: canvas focus, focus recovery,
browser-context-menu suppression, page-scroll suppression for wheel while the canvas is focused,
local pressed-state cleanup for diagnostics, and shortcut/DPI policy helpers.

Production integration steps that touch `openko-web/index.html` or generated OpenKO source are intentionally
not applied by this workstream. See `workstreams/ws41/INTEGRATION_PATCH.md`.
