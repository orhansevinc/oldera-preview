WS43

# WS01 TRUE WIDESCREEN / NATIVE BACKING-STORE CONTRACT

Consumer: **WS01 / `ws01-runtime-build`**
Provider: **WS43 / `ws43-client-display-compat`**

## Problem statement

WS43 can make the browser presentation correct, fullscreen-safe and pointer-aligned, but it cannot create additional native game pixels. The canonical Moradon PASS framebuffer is `1024x768`; the browser patch and canonical entry page also force/create `1024x768`. A 4:3 backing store therefore requires side bars in a 16:9 viewport when distortion and crop are forbidden.

True bars-free widescreen must originate in the real C++/SDL/Emscripten/WebGL2 runtime owned by WS01.

## Required source-of-truth change

WS01 must make the **native render/backing resolution** configurable instead of unconditionally forcing Emscripten to `1024x768`.

Minimum required modes:

- `classic-4x3`: `1024x768` fallback, unchanged authentic behavior;
- `viewport-native`: native backing width/height match the selected browser CSS viewport dimensions for supported desktop sizes.

Required widescreen acceptance sizes:

- `1280x720`
- `1366x768`
- `1600x900`
- `1920x1080` — canonical desktop target

WS43 additionally validates `1440x900` (16:10) presentation. If WS01 supports general viewport-native sizing, it should use a matching `1440x900` backing there; otherwise aspect-preserving bars are acceptable for 16:10 and must not be hidden by stretching.

`devicePixelRatio` MUST NOT silently multiply these logical/native dimensions. A DPR=2 1920x1080 CSS viewport is still a 1920x1080 native logical target unless WS01 later introduces an explicit high-DPI renderer mode with matching input transforms.

## SDL / Emscripten resize path

WS01 owns the backing store. WS43 will only read `canvas.width` / `canvas.height`.

For each initial size or runtime resize/fullscreen transition WS01 must ensure one coherent path updates all of these to the same native dimensions:

1. SDL window/drawable size;
2. Emscripten `Module.canvas.width` / `Module.canvas.height` backing store;
3. `CN3Base::s_Options.iViewWidth` / `iViewHeight` or the equivalent authoritative native view dimensions;
4. the renderer's default framebuffer assumptions;
5. camera/projection/UI layout state that depends on the view dimensions.

Preferred invariant: use the SDL/Emscripten window-size path so the engine receives `SDL_WINDOWEVENT_SIZE_CHANGED` / `SDL_WINDOWEVENT_RESIZED` and handles the new dimensions natively. Do not have WS43 JavaScript mutate the backing store behind SDL's state.

Initial dimensions must be established before renderer/UI initialization. Fullscreen entry must resize through the same path; fullscreen exit must restore the prior window dimensions through the same path.

## WebGL viewport / scissor contract

After context creation and after every native size change:

- default framebuffer dimensions equal the selected native backing dimensions;
- `glViewport` (or the RHI equivalent) covers `(0, 0, drawableWidth, drawableHeight)`;
- any enabled full-surface scissor is updated to the same drawable dimensions;
- no stale `1024x768` viewport/scissor remains in the world or UI render path;
- WS04/WS10 native framebuffer capture must report the new dimensions and remain non-black.

CSS sizing is not a substitute for this. A `1024x768` framebuffer scaled to `1920x1080` is a FAIL because it distorts the classic image.

## Native KO UI invariant

The KO UI must remain the real native UIF/N3 UI. No HTML HUD, Canvas2D recreation, crop or stretched texture is allowed.

WS01 must let the authentic native engine consume the new view dimensions. If an upstream UI component contains an unresolvable `1024x768` assumption, report that exact native source blocker rather than masking it in JavaScript.

Acceptance requires the real HUD, inventory and dialog to remain fully visible at every required resolution.

## Pointer / coordinate invariant

WS43 does not consume or rewrite pointer events. Its diagnostic mapping is the acceptance oracle:

```text
nativeX = (clientX - canvasRect.left) * canvas.width  / canvasRect.width
nativeY = (clientY - canvasRect.top)  * canvas.height / canvasRect.height
```

The SDL/Emscripten mouse coordinates used by native KO hit testing must agree with that mapping within 1 native pixel at:

- center;
- top-left;
- top-right;
- bottom-left;
- bottom-right;
- representative HUD/inventory/dialog edge controls.

If WS01 adds any native UI logical transform, the inverse pointer transform must live in the same native runtime layer. Do not implement it in WS43 HTML/JS.

## Browser presentation contract consumed from WS43

Once WS01 exposes a new `canvas.width/canvas.height`, WS43 will:

- neutralize the legacy `#stage` transform;
- preserve the native aspect ratio;
- fit the canvas to `visualViewport`/window without crop;
- center only when source and viewport aspects differ;
- preserve DPI and pointer alignment;
- reflow on resize/orientation/fullscreen changes;
- expose `requestFullscreen()` / `exitFullscreen()` without changing backing-store dimensions itself.

For a 1920x1080 native backing in a 1920x1080 viewport, WS43 geometry is exactly `1920x1080 @ (0,0)` with zero bars and scale=1.

## WS01 acceptance gate

`TRUE WIDESCREEN RUNTIME: READY` requires one real-client run per required widescreen size proving:

- requested native view size equals canvas backing size;
- GL framebuffer/viewport equals that size;
- real login/character/Moradon render remains non-black;
- real HUD + inventory + dialog are unclipped;
- pointer center/edge hit alignment passes;
- resize and fullscreen enter/exit preserve those invariants;
- `classic-4x3` 1024x768 fallback still passes;
- public HTTPS -> same-origin WSS transport remains unchanged.

Anything less should remain an explicit WS01 native blocker. WS43 must not fake the missing pixels.
