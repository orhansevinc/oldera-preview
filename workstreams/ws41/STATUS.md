# WS41 Status

## State

**Implementation complete in WS41 scope; production integration is conditional on the documented client patch.**

- Branch: `ws41-browser-input`
- Base: `openko-browser-port`
- Base commit SHA inspected: `18282d0e70de7ccb30244a9f09e2b3bff3040155` (tree `3066bcb1d60e7da75fde69e79ae32dda6be608de`)
- Upstream OpenKO reference: `luisfelipe18/old-school-openko@9f8cff7de8b9b2b7686d99265781060455775399`

## Delivered

- `tools/ws41_input/input_compat.mjs` — browser-shell focus/lifecycle helper; no gameplay remapping.
- `tools/ws41_input/README.md` — boundary/ownership note.
- `tests/browser-input/input_compat.test.mjs` — deterministic Node tests.
- `tests/browser-input/harness.html` + `harness.mjs` — real browser harness.
- `tests/browser-input/run_browser_smoke.mjs` — dependency-free headless Chrome/Chromium runner.
- `workstreams/ws41/INPUT_COMPATIBILITY.md` — compatibility research/report.
- `workstreams/ws41/INTEGRATION_PATCH.md` — exact changes required outside the WS41 write allowlist.
- `.github/workflows/ws41-input.yml` — CI for unit + browser smoke.

## Findings

1. OpenKO's input contract is physical DIK scancodes, not locale characters.
2. SDL3 Emscripten maps DOM `KeyboardEvent.code` to SDL scancodes, matching that contract.
3. SDL3 Emscripten resets keyboard state on browser blur, addressing lost key-up at the SDL layer.
4. OpenKO's own cached input arrays/mouse flags should still be cleared on SDL focus transitions; patch documented, not directly applied.
5. SDL3 Emscripten defaults keyboard capture to `#window`; production browser build should explicitly bind it to `#canvas` to isolate HTML text controls.
6. SDL3 already rescales DOM pointer coordinates from canvas CSS size to SDL logical window size; no extra `devicePixelRatio` conversion is allowed in WS41 glue.
7. Existing OpenKO wheel routing in the SDL entry point is still TODO; WS41 only preserves browser delivery and prevents page scroll, without inventing camera/UI mechanics.
8. Existing game fullscreen chord is Alt/Option/Cmd+Enter; F11 stays browser-owned and Escape may be consumed once to leave browser fullscreen.

## Test status

Local execution before commit:

- `node --test tests/browser-input/*.test.mjs` -> **14/14 PASS**.
- JavaScript syntax checks for helper/harness/runner -> **PASS**.
- `run_browser_smoke.mjs` was exercised in the build container; its installed Debian Chromium could not finish headless startup (DBus/runtime limitation before page navigation), so the runner correctly treats that environment as a local **SKIP**. GitHub Actions runs the same smoke test in strict mode (`WS41_REQUIRE_BROWSER=1`) so browser failure cannot be hidden in CI.

Commands:

```bash
node --test tests/browser-input/*.test.mjs
node tests/browser-input/run_browser_smoke.mjs
```

## Integration status

**Koşullu.** The WS41-owned compatibility layer and tests are ready. The production WASM client still needs the three allowlist-external integration steps in `INTEGRATION_PATCH.md` before the real game can claim end-to-end input compatibility.
