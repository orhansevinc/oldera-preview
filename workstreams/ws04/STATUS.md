WS04

# STATUS — Native GL Capture Control

## Scope

- Workstream: existing WS04 Character Select/Create client workstream; no new WS number.
- Branch: `ws04-character-client`.
- Inbox: `coordination/inbox/WS04.md` from `main`, plus the referenced central control files and current WS05/WS10/WS50 Moradon evidence were reviewed before the change.
- Implementation baseline before this control pass: `fffbd9372b67c2aaef600f7e50595bec7e23fe88`.
- Native capture fix commits:
  - `0bcc2517b3a6712bedc4211ed77b239b31c1bf9a` — Present-starvation service path.
  - `6dfbf1203c58fd3ab474a32cdf81a5bbca527aea` — generated C++ indentation correction; this is the tested implementation commit.

## Root cause proven from the corrected Moradon run

WS50 corrected run `38490102763` / job `115625184048` (artifact `11862962736`) proves the native Moradon frame reaches the WS05 render markers in one run: `moradon-zone-begin`, `moradon-assets-loaded`, `moradon-terrain-rendered`, `moradon-shapes-rendered`, and `moradon-local-player-rendered`. The run then times out waiting for `WS04_GL_CAPTURE id=1010 ok=1`.

The evidence timeline shows that WS10 writes `globalThis.WS04_CAPTURE_REQUEST=1010` after the Moradon render markers, while the browser remains alive and later native/session callbacks continue, but no later `RHIDeviceGL::Present()` consumes the request. Therefore the failing path is not a request-name mismatch, MEMFS export mismatch, synthetic screenshot issue, or failed native scene render. It is Present-only polling starvation in the browser/main-scene lifecycle.

WS05 and WS10 both use the same contract already owned by WS04:

- request: `globalThis.WS04_CAPTURE_REQUEST = <id>`
- completion: `globalThis.WS04_CAPTURE_READY === <id>`
- native file: `/ws04-frame-<id>.ppm`
- log marker: `WS04_GL_CAPTURE id=<id> ok=1`

No consumer contract change is required.

## Fix

`tools/ws04_character/patch_frame_capture.py` still captures only the genuine `RHIDeviceGL` framebuffer via `DumpFramePPM()`.

The service behavior is now:

1. `RHIDeviceGL::Present()` remains the preferred path and services a pending request immediately before `SDL_GL_SwapWindow()`.
2. Emscripten installs a 50 ms browser interval owned by the GL device.
3. The timer is a starvation-only path: the same request must remain pending for 10 timer ticks (about 500 ms) before it can capture. This preserves normal Character Select/Create pre-swap behavior.
4. Present and timer share one `WS04ServiceCaptureRequest()` implementation.
5. `globalThis.WS04_CAPTURE_INFLIGHT` atomically claims the request on the single browser thread so a resumed Present cannot duplicate a timer capture.
6. Success writes the same PPM path, sets `WS04_CAPTURE_READY`, clears the matching request/inflight id, and emits the existing marker with an additional diagnostic `source=present|browser-timer` field.
7. The interval is cleared in `RHIDeviceGL` destruction.
8. `FS` remains exported through Emscripten for Playwright artifact collection.

No render/game semantics, packet semantics, DOM/Canvas2D/Three.js renderer, fake screenshot, or synthetic success marker was added.

## Validation

Corrected WS04 CI run: `38497667882`, job `115637059193`, tested commit `6dfbf1203c58fd3ab474a32cdf81a5bbca527aea`.

Task-specific results from the real WarFare/WebGL2 build and browser run:

- OpenKO checkout: `97eb0ea20207afc0c360bfed6915113572711be3`.
- KO 1298 assets checkout: `2055ee6ed77f1b5cfef23832dd5bc31909e14a66`.
- Emscripten: 6.0.12.
- Patch application: PASS.
- CMake configure: PASS.
- Real `WarFare` WASM build: PASS, including `RHIDeviceGL.cpp` with the new lifecycle hook.
- Character Select native capture: `WS04_GL_CAPTURE id=1 ok=1 ... source=present`; 1024x768; non-black ratio `0.8169`.
- Character Create native capture: `WS04_GL_CAPTURE id=2 ok=1 ... source=present`; 1024x768; non-black ratio `0.6529`.
- Create-ready capture itself: `WS04_GL_CAPTURE id=3 ok=1 ... source=present`; PPM production still succeeds.
- Artifact: `11864965704`, zip SHA256 `4a74afe129b362e75c57ce8850a904953b79535ddf602d7ae8f2714573c34448`.

The workflow conclusion is failure only after those capture checks because the existing sparse asset fixture lacks `/data/item/upc_el_rm_*.n3cpart`; consequently the create-model inspection region remains black (`0.0000`). This is the pre-existing Character Create model-asset gate and is not a regression in native frame capture. Character Select/Create capture behavior required by this inbox remains proven.

The previous control attempt, run `38497208056`, exposed only a mechanical raw-string indentation error in generated C++; it is superseded by `6dfbf120...` and the successful build above.

## Integrated Moradon status

The implementation is ready for the corrected Moradon harness, but the exact integrated proof is blocked by one dependency synchronization step outside WS04 ownership:

- current WS05 head: `6ca101f3390e0a0f6b056afea99b45ec8d4f67be`
- final tested WS04 implementation: `6dfbf1203c58fd3ab474a32cdf81a5bbca527aea`
- their merge base is the old WS04 baseline `fffbd9372b67c2aaef600f7e50595bec7e23fe88`; the branches are diverged.
- WS10's tested E2E workflow reads `tools/ws04_character/patch_frame_capture.py` from the WS05 provider worktree and explicitly requires the resolved WS04 SHA to be an ancestor of WS05.

Therefore WS05 must consume the final WS04 branch/commit with ancestry preserved, then WS10/WS50 must rerun the corrected Moradon E2E. A cherry-pick alone is insufficient for the existing WS10 ancestry gate because it changes the commit identity.

## Closure

`NATIVE MORADON FRAME CAPTURE: BLOCKED ONLY ON WS05 DEPENDENCY SYNC + CORRECTED WS10/WS50 RERUN`

No `main` merge, no other workstream branch push, and no force-push was performed by WS04.
