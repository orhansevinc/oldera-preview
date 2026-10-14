WS43

# STATUS — Live Fullscreen / Display Compatibility

## Decision

**DISPLAY FULLSCREEN: READY**

Branch: `ws43-client-display-compat`

WS43 does not claim true native widescreen pixels. It provides the correct fullscreen/browser presentation layer and an exact native backing-store contract to WS01.

## Black-bar root cause — confirmed

The black side bars are caused by the real client's native 4:3 backing surface, not by a missing CSS `width:100%` rule:

- canonical WS10 Moradon PASS run #26 captured a genuine native GL framebuffer of `1024x768`;
- current WS01 browser preparation verifies the Emscripten client still uses width `1024`;
- the baseline browser patch sets Emscripten view options to `1024x768`;
- the canonical WS01 entry page creates a `1024x768` canvas/stage;
- the latest public staging observation shows the expected centered 4:3 canvas with black side bars in a 16:9 viewport.

At 1920x1080, aspect-preserving maximum fit is exactly 1440x1080 with 240 px bars on both sides, using 75% of viewport area. Removing those bars while retaining a 1024x768 framebuffer would require distortion or crop, both forbidden.

## WS43 implementation

`tools/ws43_display/display-compat.js` now:

- preserves native `canvas.width` / `canvas.height` as the sole backing-store source of truth;
- neutralizes the canonical page's legacy `#stage` transform on every reflow, preventing double scaling after resize;
- fits the real Emscripten canvas maximally into `visualViewport`/window while preserving aspect;
- supports resize, orientation, fullscreen and visual viewport changes;
- keeps DPR out of native KO logical dimensions;
- leaves real Emscripten pointer events untouched and exposes diagnostic native-coordinate mapping;
- exposes root-document `requestFullscreen()` / `exitFullscreen()` so integration can enter fullscreen from a real user gesture without relying on fullscreen-UA stretching of the canvas.

No fake HUD, HTML recreation, renderer replacement, crop or stretch is introduced.

## Test coverage added

Unit/browser coverage now includes:

- 1024x768;
- 1280x720;
- 1366x768;
- 1600x900;
- 1920x1080;
- 1440x900 (16:10);
- DPR 2;
- resize after legacy stage scaling;
- fullscreen enter/exit event path;
- center and four-corner pointer mapping;
- exact 75% 1920x1080 coverage for fixed 1024x768 backing;
- zero-bar geometry for matching native 16:9 and 16:10 backing stores.

## WS01 exact handoff

Added `workstreams/ws43/WS01_WIDESCREEN_CONTRACT.md`.

The contract requires WS01 to replace the unconditional browser 1024x768 native view with a config-driven native backing path, while retaining 1024x768 fallback. Required true-widescreen matrix is `1280x720`, `1366x768`, `1600x900`, `1920x1080`.

Native invariants include:

- SDL window/drawable, Emscripten canvas backing, native view options and GL framebuffer agree;
- resize/fullscreen produces native SDL size events/state changes;
- GL viewport/scissor follows the new drawable size;
- authentic UIF layout and native hit testing remain aligned;
- WS43 JavaScript never mutates backing size to fake widescreen.

## Integrated live acceptance

Final post-WS01 acceptance remains:

`login -> character -> Moradon HUD -> inventory/dialog -> edge clicks -> resize -> fullscreen -> exit fullscreen`

The current public 1024x768 staging state is accepted only as correct 4:3 letterbox behavior. True zero-bar 16:9 acceptance is downstream of the WS01 native change and must be proven with a real native framebuffer at the new size.

## Boundaries

- no provider/game/network logic modified;
- no shared `openko-web/index.html` modified by WS43;
- no other workstream branch modified;
- no main merge;
- no force push;
- no new workstream number.

`DISPLAY FULLSCREEN: READY`

BU SOHBETE ARTIK GEREK VAR MI?: HAYIR
