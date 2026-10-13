WS43

# DISPLAY_MATRIX

## Scope and compatibility contract

WS43 targets only the real Emscripten canvas exposed by `openko-web/index.html` and loaded by `KnightOnLine.js`. It does not use or modify HTML/Three.js reconstructions of the KO interface.

The compatibility rule is intentionally conservative:

1. Preserve the native canvas backing-store (`canvas.width` x `canvas.height`) selected by the real client.
2. Fit that backing-store into the browser viewport with the same aspect ratio.
3. Center the fitted canvas and use black letterboxing when viewport and client aspect ratios differ.
4. Never multiply the backing-store by `devicePixelRatio`; DPI changes physical pixels, not the N3/UIF coordinate system.
5. Keep mouse mapping proportional to the visible CSS rectangle so the displayed button and the backing-store hit coordinate stay aligned.

The runtime shim dynamically reads the actual backing-store. The 1024x768 values below are a reference calculation for the classic 4:3 client surface, not a forced replacement resolution.

## Reference 1024x768 backing-store geometry

| Browser viewport | Canvas CSS box | Letterbox | Automated geometry |
| --- | --- | --- | --- |
| 1024x768 | 1024x768 @ (0, 0) | none | PASS |
| 1280x720 | 960x720 @ (160, 0) | 160 px left/right | PASS |
| 1366x768 | 1024x768 @ (171, 0) | 171 px left/right | PASS |
| 1920x1080 | 1440x1080 @ (240, 0) | 240 px left/right | PASS |

## Compatibility matrix

| Case | Automated coverage | Status | Notes |
| --- | --- | --- | --- |
| 1024x768 | unit + Playwright | PASS | Native aspect is preserved. |
| 1280x720 | unit + Playwright | PASS | Horizontal letterboxing for 4:3 backing-store. |
| 1366x768 | unit + Playwright | PASS | Horizontal letterboxing for 4:3 backing-store. |
| 1920x1080 | unit + Playwright | PASS | Horizontal letterboxing for 4:3 backing-store. |
| High DPI (DPR 2) | Playwright + invariant | PASS | CSS fit ignores DPR and does not mutate backing-store size. |
| Browser zoom | reduced CSS viewport simulation | PARTIAL | Layout behavior is covered; Chromium toolbar Ctrl+/Ctrl- zoom must be checked manually in an integrated build. |
| Window resize | Playwright | PASS | `resize` / `visualViewport.resize` reflow while preserving aspect. |
| Fullscreen | Playwright event path + optional API attempt | PARTIAL | Event/reflow path is covered. Headless browser may reject native fullscreen; integrated headed run remains required. |
| Fullscreen exit | Playwright event path | PASS | Reflow is reversible and state returns to non-fullscreen. |
| Canvas aspect ratio | unit + Playwright | PASS | CSS aspect tracks native backing-store aspect. |
| Letterboxing | unit + Playwright | PASS | Centered black bars; no stretch/crop. |
| Mouse coordinate alignment | unit + Playwright center mapping | PASS | Client coordinates derive from visible CSS rect and native backing size. |

## Real UI state checks

These states require a live 1298 session/server path to reach the actual rendered screens. WS43 does not fabricate state screenshots or substitute DOM mockups.

| UI state | Geometry protection | Visual/state-specific verdict |
| --- | --- | --- |
| Login UI | compatibility shim applies | PENDING LIVE SESSION |
| Nation select | compatibility shim applies | PENDING LIVE SESSION |
| Character select | compatibility shim applies | PENDING LIVE SESSION |
| In-game HUD | compatibility shim applies | PENDING LIVE SESSION |
| Inventory UI accessibility | compatibility shim applies | PENDING LIVE SESSION |
| Dialog clipping | compatibility shim applies | PENDING LIVE SESSION |
| Button image/hitbox match | pointer math covered | PENDING LIVE SESSION |

## Evidence

`tests/display-compat/display-compat.spec.cjs` always opens `openko-web/index.html`, asserts `#canvas` and the `KnightOnLine.js` script are present, injects only the WS43 compatibility shim, and produces PNG/JSON evidence under `tests/display-compat/artifacts/`.
