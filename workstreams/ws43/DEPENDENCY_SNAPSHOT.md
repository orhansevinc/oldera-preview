WS43

# DEPENDENCY SNAPSHOT

## SELF

- workstream: WS43
- branch: `ws43-client-display-compat`
- starting head inspected: `3a83a46e5072cabd14d32762600efd025482277c`
- role: browser canvas layout / DPI / resize / fullscreen / pointer presentation compatibility

## CONTROL SOURCE

- main inspected: `e33ecc99cbb8f8d7285cb44fc62c496ce6991800`
- `coordination/inbox/WS43.md`: live fullscreen / 16:9 display acceptance
- `coordination/inbox/WS01.md`: true widescreen/native backing-store runtime owner
- `coordination/MASTER_CONTROL.md`, `BROADCAST.md`, `WORKSTREAM_REGISTRY.md`, `TASK_QUEUE.md` consumed

## UPSTREAM EVIDENCE

### WS10 — canonical real Moradon PASS

- branch: `ws10-qa-integration`
- canonical run: #26 / `38505039290`
- tested harness commit: `f0cadfb50b5d1a36d2bfe4e5bf0a68f7c3061f41`
- frozen passing client artifact: `ws10-moradon-passing-client-26`
- artifact id: `11867980473`
- genuine native GL framebuffer evidence: `1024x768`
- result: `MORADON E2E: PASS`

### WS50 — public staging candidate

- `integration-rehearsal/STAGING_LINK_HANDOFF.md` consumed from `ws50-integration-rehearsal`
- decision: `STAGING LINK CANDIDATE: READY`
- canonical WS10 PASS client binaries are consumed unchanged
- frozen staging provider set records WS01 `57d0aa7c6a82810d5f126bda83a368e7eb7801bb`

### WS01 — current browser runtime/display state

- branch inspected: `ws01-runtime-build`
- head inspected: `57d0aa7c6a82810d5f126bda83a368e7eb7801bb`
- `openko-web/index.html` creates fixed `1024x768` stage/canvas
- `tools/ws01_runtime/prepare_browser_source.py` verifies the browser viewport patch still forces width `1024`
- baseline `tools/patch_openko_browser.py` forces Emscripten `iViewWidth=1024`, `iViewHeight=768`
- owner of the newly assigned true-native widescreen change: WS01

## PUBLIC DISPLAY OBSERVATION

Latest supplied public staging observation: the real 1298 canvas is centered in a 16:9 browser viewport with black side bars. This exactly matches a 1024x768 native source fitted without distortion.

## DOWNSTREAM

- WS01 consumes `workstreams/ws43/WS01_WIDESCREEN_CONTRACT.md`.
- WS09/WS12/WS50 may consume WS43 presentation include after integration ownership decides publication order.
- WS10 remains the real native E2E evidence authority for final integrated widescreen acceptance.

## CONTRACTS

- no CSS non-uniform stretch
- no crop of native UI
- no fake HTML/Canvas2D/Three.js KO UI
- WS43 never mutates native canvas backing dimensions
- DPR does not silently alter KO logical coordinates
- pointer mapping must match CSS rect -> native backing coordinates
- fullscreen/resize reflow must preserve native aspect
- true bars-free 16:9 requires native backing dimensions supplied by WS01

## BLOCKERS

WS43-owned display compatibility has no implementation blocker.

External dependency for **true bars-free widescreen**: WS01 must replace the fixed Emscripten 1024x768 native view/backing-store assumption according to `WS01_WIDESCREEN_CONTRACT.md`.

## LAST SYNC

2026-10-14 — current main control assignment, WS10 PASS #26, WS50 READY handoff, WS01 fixed-1024x768 runtime evidence and public staging display observation consumed.
