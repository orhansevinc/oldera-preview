WS43

# DISPLAY MATRIX — live fullscreen / widescreen acceptance

## Proven cause of the black bars

The current real browser client is native 4:3, not native widescreen.

Three independent pieces of repository evidence agree:

1. Canonical WS10 Moradon PASS run #26 measured the genuine native GL framebuffer as `1024x768`.
2. The current WS01 browser source preparation explicitly requires the Emscripten game options to contain `iViewWidth = 1024`, and the baseline browser patch sets `iViewHeight = 768` as well.
3. The current canonical `openko-web/index.html` creates a `1024x768` canvas and legacy `1024x768` stage.

Therefore a modern 16:9 viewport cannot be filled by this backing store without one of three things: preserve aspect and letterbox, stretch/distort, or crop. WS43 accepts only the first. Stretch/crop/fake HTML UI remain forbidden.

The latest public staging observation — real 1298 canvas centered with black side bars — is exactly consistent with this native 4:3 source surface; it is not evidence of a CSS-only defect.

## Reference geometry with current 1024x768 backing store

| Browser viewport | Aspect | Canvas CSS box | Unavoidable bars | Viewport coverage |
| --- | --- | --- | --- | --- |
| 1024x768 | 4:3 | 1024x768 @ (0, 0) | none | 100% |
| 1280x720 | 16:9 | 960x720 @ (160, 0) | 160 px left/right | 75% |
| 1366x768 | ~16:9 | 1024x768 @ (171, 0) | 171 px left/right | ~74.96% |
| 1600x900 | 16:9 | 1200x900 @ (200, 0) | 200 px left/right | 75% |
| 1920x1080 | 16:9 | 1440x1080 @ (240, 0) | 240 px left/right | 75% |
| 1440x900 | 16:10 | 1200x900 @ (120, 0) | 120 px left/right | 83.33% |

This is maximum viewport use possible from a 4:3 native image while preserving every source pixel and the classic KO aspect ratio.

## WS43 browser/display acceptance

| Case | Automated coverage | Status | Notes |
| --- | --- | --- | --- |
| 1024x768 | unit + Playwright | PASS target | No bars at native aspect. |
| 1280x720 | unit + Playwright | PASS target | Correct 4:3 letterbox. |
| 1366x768 | unit + Playwright | PASS target | Correct 4:3 letterbox. |
| 1600x900 | unit + Playwright | PASS target | Correct 4:3 letterbox. |
| 1920x1080 | unit + Playwright | PASS target | 240 px symmetric bars; 75% coverage. |
| 1440x900 16:10 | unit + Playwright | PASS target | 120 px symmetric bars. |
| DPR 2 | Playwright + invariant | PASS target | DPR does not mutate native backing dimensions. |
| Window resize | Playwright | PASS target | Legacy `#stage` transform is re-neutralized; no double CSS scaling. |
| `visualViewport` | runtime listener | PASS target | Offset/size are used when available. |
| Fullscreen enter/exit | Playwright API path | PASS target | Root fullscreen preserves native aspect; no canvas UA stretching dependency. |
| Pointer center + corners | unit + Playwright | PASS target | CSS-to-backing mapping stays aligned. |
| Matching native 16:9 backing | unit geometry | PASS target | Matching 1280x720 / 1366x768 / 1600x900 / 1920x1080 removes bars with scale=1. |
| Matching native 16:10 backing | unit geometry | PASS target | 1440x900 removes bars with scale=1. |

## Live acceptance sequence

After WS01 consumes the native backing-store contract, the integrated real-client acceptance is:

`login -> character -> Moradon HUD -> inventory/dialog -> edge clicks -> resize -> browser fullscreen -> exit fullscreen`

Required observations:

- the real native KO UI is present; no HTML replacement;
- Moradon world fills the native backing surface;
- inventory/dialog remains fully visible;
- center plus four edge/corner clicks land on the rendered native coordinates;
- resize/fullscreen never introduces non-uniform scale;
- fullscreen exit returns to the prior window geometry;
- `canvas.width/canvas.height`, SDL/native view size and GL default framebuffer agree after every native size change.

Until WS01 changes the native backing store, the correct acceptance result on widescreen is symmetric black bars, not a stretched or cropped fake widescreen image.
