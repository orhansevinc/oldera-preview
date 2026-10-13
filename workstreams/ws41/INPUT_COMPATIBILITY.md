# WS41 — Keyboard / Mouse / Focus / Input Compatibility

## Scope

This workstream validates how the real OpenKO client input model reaches a browser build. It does **not** create a new gameplay input system. The authoritative path remains:

`Browser DOM -> SDL3 Emscripten video/input backend -> SDL_Scancode -> OpenKO SdlScancodeToDik() -> CLocalInput -> existing game/UI code`

## Sources inspected

Pinned client source used by `openko-browser-port`:

- OpenKO upstream: `luisfelipe18/old-school-openko`, branch `feature/port-posix`, commit `9f8cff7de8b9b2b7686d99265781060455775399`.
- `src/Client/WarFare/LocalInput.h`
- `src/Client/WarFare/LocalInput.cpp` (Windows DirectInput reference)
- `src/Client/WarFare/LocalInputSDL.cpp`
- `src/Client/WarFare/WarFareMain.cpp` (Win32 window/input reference)
- `src/Client/WarFare/WarFareMainSDL.cpp`
- Browser shell in this repository: `openko-web/index.html` and `tools/patch_openko_browser.py` from `openko-browser-port` commit `18282d0e70de7ccb30244a9f09e2b3bff3040155`.

SDL3 Emscripten backend behavior was checked against the current upstream implementation in `libsdl-org/SDL` (`src/video/emscripten/SDL_emscriptenevents.c`, `SDL_emscriptenvideo.c`). Production builds must keep their SDL version pinned/reviewed because this backend is part of the input contract.

## Compatibility contract

### 1. Keyboard identity: physical key, not produced character

OpenKO identifies keys using DirectInput `DIK_*` scancodes. `LocalInputSDL.cpp` deliberately maps `SDL_Scancode` values to those DIK values. SDL's Emscripten backend derives its scancode from DOM `KeyboardEvent.code` (for example `KeyW` -> `SDL_SCANCODE_W`), while `event.key` remains layout-dependent text.

Therefore:

- gameplay identity must follow the **physical key** (`code` / SDL scancode / DIK),
- text entry must follow SDL text input (`SDL_EVENT_TEXT_INPUT` / IME composition),
- JavaScript must not remap `event.key` characters to movement/hotkey DIKs.

This preserves the existing client behavior across QWERTY, Turkish, AZERTY and other layouts. A physical W-position key remains `DIK_W` even if the active layout emits another character.

### 2. Key down/up and stuck-key prevention

`CLocalInput::Tick()` samples SDL's current keyboard state each frame and derives press/release edges exactly like the DirectInput backend. SDL's Emscripten focus handler explicitly resets its keyboard state on browser blur because key-up can be lost during Alt+Tab/tab switching.

WS41 therefore does **not** synthesize keyboard events. The helper only clears its own diagnostic state on `window.blur` / hidden-document transitions.

One OpenKO-side issue remains: `CLocalInput::Tick()` returns immediately when `SDL_GetKeyboardFocus() == nullptr`, so its cached `m_byCurKeys` and mouse flags can remain stale until a focused tick. The integration patch clears OpenKO's cached input flags when SDL reports focus loss/gain. See `INTEGRATION_PATCH.md`.

### 3. Canvas focus and tab switching

The current browser shell already declares `<canvas tabindex="0">` and calls `canvas.focus()` at startup. WS41 adds the missing lifecycle rules:

- pointer-down on the canvas reclaims canvas focus,
- bare `Tab` is prevented from moving DOM focus away from the game canvas,
- `Ctrl+Tab` / browser tab switching is not blocked,
- on return from a hidden tab, canvas focus is restored only if the canvas owned focus before the tab was hidden,
- focus is not stolen from a real DOM input/textarea/select/contenteditable control.

### 4. Text input versus game hotkeys

The real client already separates character composition from physical key state:

- `SDL_EVENT_TEXT_INPUT` / `SDL_EVENT_TEXT_EDITING` feed `CN3UIEdit`,
- editing keys are routed with the physical SDL scancode,
- `SDL_StartTextInput()` and `SDL_StopTextInput()` are driven by the focused `CN3UIEdit`.

However SDL3 Emscripten's default keyboard binding element is `#window`, not `#canvas`. That means a future HTML login/search/input control can still leak physical key events into SDL unless the build pins the keyboard element.

Required production setting: `SDL_HINT_EMSCRIPTEN_KEYBOARD_ELEMENT = "#canvas"` before the SDL window is created. This is listed in `INTEGRATION_PATCH.md`. It keeps DOM text controls browser-owned while the canvas keeps the real SDL text-input path.

### 5. Mouse buttons and movement

The native SDL backend keeps existing KO semantics:

- left/middle/right button held/click/release flags,
- double-click detection,
- drag rectangles,
- current/previous pointer positions.

The browser helper does not synthesize or translate those buttons. It only:

- focuses the canvas on pointer-down,
- suppresses the browser context menu on the canvas so right-click remains usable by SDL,
- clears helper state on pointer cancel/focus loss.

OpenKO cached mouse flags are explicitly cleared by the integration patch on focus transitions to avoid a button remaining logically down after a tab switch where the browser never delivered its pointer-up.

### 6. Wheel

Win32 routes `WM_MOUSEWHEEL` to focused UI first, then camera zoom. The SDL port already receives `SDL_EVENT_MOUSE_WHEEL` and normalizes a notch to Windows' `WHEEL_DELTA` scale (`120`), but `WarFareMainSDL.cpp` still has a TODO for routing that event to UI/camera.

WS41 does not invent that gameplay/UI behavior. It only prevents the page itself from scrolling while the focused canvas receives the wheel and leaves event propagation intact for SDL. Finishing the existing wheel TODO belongs to the client integration owner, not this workstream.

### 7. Fullscreen

The current SDL client recognizes `Alt/Option+Enter` and `Cmd+Enter` (DIK Alt/GUI + Return) as the game fullscreen toggle. WS41 does not add a second Fullscreen API implementation.

Browser caveats:

- `F11` is browser fullscreen and remains browser-owned.
- Browser Fullscreen API transitions can require a trusted user gesture; the SDL/Emscripten implementation must be tested with the exact production SDL/browser combination.
- `Escape` is reserved by browsers to leave browser fullscreen/pointer lock and cannot be guaranteed to reach gameplay on that first press.

### 8. Escape

Outside browser fullscreen/pointer lock, Escape is left untouched and reaches the real client. The WS41 helper never prevents Escape. In browser fullscreen, the browser may consume Escape to leave fullscreen; the game receives subsequent Escape input normally.

### 9. Browser shortcut conflicts

| Shortcut | Owner | WS41 policy |
|---|---|---|
| Ctrl+Tab / Ctrl+Shift+Tab | Browser | Do not block; recover canvas focus on return |
| Ctrl/Cmd+L | Browser | Do not depend on it as game input |
| Ctrl/Cmd+W | Browser | Do not depend on it as game input |
| Ctrl/Cmd+T | Browser | Do not depend on it as game input |
| Ctrl/Cmd+R, F5 | Browser | Do not depend on it as game input |
| Alt+Left / Alt+Right | Browser | Do not depend on it as game input |
| F11 | Browser | Browser fullscreen; separate from SDL fullscreen |
| Cmd+Q | OS/browser app | Not portable game input |
| Alt/Option/Cmd+Enter | OpenKO | Preserve and pass to SDL |
| Escape | OpenKO + browser fullscreen escape | Never swallowed by WS41; first press may leave browser fullscreen |
| bare Tab | OpenKO canvas | Prevent DOM focus traversal while canvas owns game focus |

### 10. High-DPI coordinates

`WarFareMainSDL.cpp` keeps game/UI coordinates in logical window units and stores physical framebuffer density separately in `CN3Base::s_fPixelDensity`.

SDL's Emscripten pointer backend already rescales pointer coordinates using:

`logical = DOM target coordinate * (SDL window logical size / canvas CSS size)`

Therefore browser glue must **not** multiply mouse coordinates by `devicePixelRatio` or by the backing-store ratio a second time. The test harness deliberately uses a 1280x720 backing canvas displayed at 640x360 and verifies logical center coordinates remain 320x180 for a 640x360 logical window.

## Automated coverage

`node --test tests/browser-input/*.test.mjs` covers:

- physical-code tracking with layout-dependent `key` mismatch,
- key down/up and repeat behavior,
- focus-loss state reset,
- tab-switch focus recovery without stealing DOM text focus,
- Tab and Escape policies,
- right-click/context-menu behavior,
- wheel page-scroll suppression,
- fullscreen chord recognition,
- DOM text-control exclusion,
- high-DPI logical coordinate math,
- shortcut conflict classification.

`node tests/browser-input/run_browser_smoke.mjs` serves `harness.html` and runs the same boundary behavior in real headless Chromium/Chrome with no npm dependency.

## Result

The browser boundary is compatible with the real OpenKO physical-scancode input model. The remaining production changes are narrowly scoped integration changes outside WS41's write allowlist: bind SDL keyboard events to `#canvas`, install the WS41 browser helper in the generated shell, and clear OpenKO cached input flags on SDL focus transitions. No gameplay movement or mechanic was reimplemented.
