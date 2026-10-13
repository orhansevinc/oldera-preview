# WS41 Integration Patch

WS41 is not allowed to edit the real client/browser output files directly. Apply the following changes in the client integration branch after review.

## 1. Bind SDL Emscripten keyboard input to the game canvas

Target: generated upstream `src/Client/WarFare/WarFareMainSDL.cpp` (normally modified through `tools/patch_openko_browser.py`).

Before `SDL_Init(SDL_INIT_VIDEO)` / before the SDL window is created, set:

```cpp
#ifdef __EMSCRIPTEN__
SDL_SetHint(SDL_HINT_EMSCRIPTEN_KEYBOARD_ELEMENT, "#canvas");
#endif
```

Why: SDL3 Emscripten defaults its keyboard element to `#window`. Binding to `#canvas` prevents physical game hotkeys from leaking through while a separate HTML input/textarea owns focus, while preserving SDL text input inside the game canvas.

## 2. Clear OpenKO cached input on SDL focus transitions

`LocalInputSDL.cpp` caches `m_byCurKeys` / mouse flags and returns early while SDL keyboard focus is null. SDL itself resets keyboard state on browser blur, but the OpenKO cache can remain stale and mouse-up may be lost across a tab switch.

Use the already-public clearing APIs in `CLocalInput` when focus changes. Minimal shape:

```diff
-void HandleEvent(const SDL_Event& event)
+void HandleEvent(const SDL_Event& event, CLocalInput& localInput)
 {
     switch (event.type)
     {
         case SDL_EVENT_WINDOW_FOCUS_GAINED:
             g_bWindowInFocus = true;
+            localInput.KeyboardClearInput();
+            localInput.MouseRemoveFlag();
+            CGameProcedure::s_bIsWindowInFocus = true;
             break;
 
         case SDL_EVENT_WINDOW_FOCUS_LOST:
             g_bWindowInFocus = false;
+            localInput.KeyboardClearInput();
+            localInput.MouseRemoveFlag();
+            CGameProcedure::s_bIsWindowInFocus = false;
             break;
     }
 }
```

And in the event pump:

```diff
 while (SDL_PollEvent(&event))
-    HandleEvent(event);
+    HandleEvent(event, localInput);
```

For the Emscripten main-loop patch, make the equivalent change in the event pump created by `tools/patch_openko_browser.py`.

Do **not** copy the Win32 behavior that immediately quits when a fullscreen window loses focus. Browser tab switching routinely causes blur, so quitting would turn a normal browser lifecycle action into a disconnect. The focus flag is preserved; only the desktop-exclusive fullscreen quit side effect is intentionally not carried to web.

## 3. Install the WS41 browser-shell helper

Target: generated `openko-web/index.html` (or its generation template).

The integration build should copy:

`tools/ws41_input/input_compat.mjs`

to the browser publication directory and install it after the canvas element exists, before normal user interaction:

```html
<script type="module">
  import { installBrowserInputCompatibility } from './input_compat.mjs';
  const canvas = document.getElementById('canvas');
  window.__oldkoInputCompatibility = installBrowserInputCompatibility({
    canvas,
    focusOnInstall: true
  });
</script>
```

The current shell already has `tabindex="0"` and calls `canvas.focus()`. Keep those; the helper adds pointer refocus, lifecycle recovery, context-menu suppression and wheel page-scroll suppression.

## 4. Do not add JavaScript gameplay key maps

Do not add WASD/skill mappings in JS. Do not translate `event.key` to actions. The authoritative mapping is already:

`KeyboardEvent.code -> SDL_Scancode -> SdlScancodeToDik() -> DIK_*`.

## 5. Wheel TODO remains a separate native client integration

`WarFareMainSDL.cpp` already has a wheel event and the Win32 reference documents UI-first/camera-second routing. WS41 deliberately does not implement this gameplay/UI behavior. The integration owner can port the existing Win32 `WM_MOUSEWHEEL` branch using the real game objects when that client TODO is scheduled.

## Acceptance after integration

Run:

```bash
node --test tests/browser-input/*.test.mjs
node tests/browser-input/run_browser_smoke.mjs
```

Then exercise the real WASM client manually:

1. Hold a movement/action key, switch tabs before releasing it, return: no held/stuck key.
2. Hold left/right mouse, switch tabs, return: no stuck mouse-down state.
3. Type Turkish/other-layout text into `CN3UIEdit`: text follows layout, physical game hotkeys remain scancode-based.
4. Focus any HTML input outside the canvas: game hotkeys do not fire.
5. Right-click canvas: no browser context menu; SDL receives right mouse.
6. Wheel over focused canvas: page does not scroll; SDL wheel event still arrives.
7. Alt/Option/Cmd+Enter: test SDL fullscreen in Chrome/Firefox/Safari as applicable.
8. Escape in normal mode reaches client; Escape in browser fullscreen may first exit fullscreen.
9. Retina/HiDPI: pointer hit testing matches logical UI at 1x/1.5x/2x density.
