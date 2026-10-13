# WS01 Integration Patch

WS01 did **not** modify shared runtime/build files outside its allowed ownership. The following mainline changes are required when this workstream is integrated.

## 1. `.github/workflows/openko-browser-port.yml`

The shared browser-port workflow currently uses mutable build inputs. Pin them to the versions validated by WS01:

- OpenKO checkout: `luisfelipe18/old-school-openko` at `97eb0ea20207afc0c360bfed6915113572711be3` instead of `feature/port-posix`.
- KO 1298 assets: `ko4life-net/ko-assets` at `2055ee6ed77f1b5cfef23832dd5bc31909e14a66` instead of the mutable `1298` branch ref.
- Emscripten: `6.0.12` instead of `latest`.
- Prefer the exact action SHAs used by `ws01-runtime.yml` for checkout/setup/upload actions.

This is required for a reproducible browser build: the same OldKOWeb commit must not silently compile against a newer upstream client, asset revision, or Emscripten toolchain.

## 2. `.github/workflows/openko-browser-port.yml` publication step

The shared workflow currently recreates `openko-web/index.html` from an inline heredoc every time it publishes a proven package. That would overwrite the WS01 bootstrap hardening in `openko-web/index.html` after integration.

Change the publication step so it preserves/uses the repository's canonical `openko-web/index.html` instead of regenerating a different copy inline. The generated `KnightOnLine.js`, `KnightOnLine.wasm`, and `KnightOnLine.data` may still be copied into `openko-web/` after the runtime gates pass.

## 3. Shared OpenKO browser patch — non-blocking follow-up

Current Chromium runs emit:

`emscripten_set_main_loop_timing: Cannot set timing mode for main loop since a main loop does not exist!`

The client is currently linked with `-sASYNCIFY` and continues to render through WebGL2 successfully, so WS01 treats this as a known non-fatal warning rather than a release blocker. A future shared runtime patch should convert the Emscripten entry point to a real browser main-loop/callback model instead of the native blocking `while` loop + `SDL_Delay`. That change belongs in the shared browser-port patch/upstream client integration, not in WS01-owned files.
