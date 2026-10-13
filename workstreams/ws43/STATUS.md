WS43

# STATUS

## Workstream state

DURUM: TAMAMLANDI

BRANCH: `ws43-client-display-compat`

## Delivered

- `tools/ws43_display/display-compat.js`
  - real Emscripten canvas compatibility shim,
  - aspect-preserving viewport fit,
  - centered letterboxing,
  - resize / fullscreen / visual viewport listeners,
  - native canvas backing-store preservation,
  - diagnostic mouse coordinate mapping.
- `tests/display-compat/geometry.test.cjs`
  - deterministic 1024x768, 1280x720, 1366x768, 1920x1080 geometry checks,
  - portrait resize, DPI invariant, pointer alignment, invalid geometry checks.
- `tests/display-compat/display-compat.spec.cjs`
  - Playwright checks against the real `openko-web/index.html` Emscripten canvas,
  - high DPI, resize, fullscreen event path, screenshot/JSON artifact generation.
- `tests/display-compat/artifacts/README.md`
  - test artifact contract.
- `.github/workflows/ws43-display.yml`
  - unit + Chromium compatibility CI and artifact upload.
- `workstreams/ws43/DISPLAY_MATRIX.md`
  - compatibility and live-state matrix.
- `workstreams/ws43/INTEGRATION_PATCH.md`
  - minimal shared-source activation request.

## Test verdict

Overall: PARTIAL

- Pure geometry / pointer tests: PASS locally.
- JavaScript syntax validation: PASS locally.
- Playwright CI: supplied and designed to exercise the real Emscripten entry page; final remote CI execution is external to this commit operation.
- Login / nation / character / HUD / inventory / dialog state-specific visual validation: PENDING LIVE SESSION because those states require a live 1298 server/session.
- Actual browser-toolbar zoom and headed native fullscreen: integration acceptance checks; automation covers equivalent viewport behavior and fullscreen reflow path without claiming headless API behavior as production proof.

## Boundary compliance

- No classic KO UI was recreated in HTML.
- No modern UI was added.
- No UI asset was modified.
- No gameplay, admin, site, backend, renderer, or shared client source was modified.
- No main merge or force push.

## Integration status

ENTEGRASYON: Koşullu

Reason: production activation requires the shared `openko-web/index.html` owner to include the WS43 compatibility script as documented in `INTEGRATION_PATCH.md`, followed by the live-state acceptance run.
