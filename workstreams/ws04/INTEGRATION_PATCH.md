WS04

# INTEGRATION PATCH — Native Moradon Capture Lifecycle

## Provider

- Workstream/branch: `WS04` / `ws04-character-client`.
- Tested implementation commit: `6dfbf1203c58fd3ab474a32cdf81a5bbca527aea`.
- Owned implementation: `tools/ws04_character/patch_frame_capture.py`.
- Existing consumer contract is unchanged:
  - request: `globalThis.WS04_CAPTURE_REQUEST = <id>`
  - completion: `globalThis.WS04_CAPTURE_READY === <id>`
  - file: `/ws04-frame-<id>.ppm`
  - marker: `WS04_GL_CAPTURE id=<id> ok=1`

## Runtime behavior supplied by WS04

1. A pending request is serviced from `RHIDeviceGL::Present()` immediately before `SDL_GL_SwapWindow()` whenever Present continues normally.
2. An Emscripten 50 ms interval observes the same request contract without changing game or render state.
3. The interval may capture only after the identical request remains pending for 10 ticks (about 500 ms), making it a Present-starvation fallback rather than the normal path.
4. Both paths invoke the same native `RHIDeviceGL::DumpFramePPM()` readback against the real GL backbuffer.
5. `globalThis.WS04_CAPTURE_INFLIGHT` claims the request before readback so a resumed Present cannot duplicate the timer capture.
6. Success writes the same PPM, updates `WS04_CAPTURE_READY`, clears the matching request/inflight id, and emits the compatible marker plus `source=present` or `source=browser-timer` diagnostics.
7. Emscripten `FS` remains exported for evidence collection.

There is no DOM screenshot, Canvas2D/Three.js render path, fake PPM, or synthetic success marker.

## Required provider synchronization before integrated rerun

Current WS05 head is `6ca101f3390e0a0f6b056afea99b45ec8d4f67be`. Final tested WS04 implementation is `6dfbf1203c58fd3ab474a32cdf81a5bbca527aea`. Their merge base is the older WS04 baseline `fffbd9372b67c2aaef600f7e50595bec7e23fe88`; therefore the branches are currently diverged.

The exact WS10 Moradon workflow used by the corrected WS50 rehearsal resolves WS04 and WS05 provider SHAs, requires the WS04 SHA to be an ancestor of WS05, and executes `tools/ws04_character/patch_frame_capture.py` from the WS05 provider worktree. Consequently:

- WS05 must consume the final WS04 branch/commit while preserving ancestry (merge or equivalent integration where `6dfbf120...` becomes an ancestor of WS05).
- A stand-alone cherry-pick of the patch is not sufficient for that existing WS10 ancestry gate because the commit identity changes.
- WS04 does not push to the WS05 branch; this handoff is deliberately documented instead.

## Corrected Moradon rerun acceptance

After WS05 dependency synchronization, run the corrected WS10/WS50 native Moradon E2E using the resolved provider refs. The same run must prove:

- `zone=21 native_zone=210`
- `moradon-assets-loaded`
- `moradon-terrain-rendered`
- `moradon-shapes-rendered`
- `moradon-local-player-rendered`
- the WS10 request id is issued (`1010` in the current harness)
- `WS04_GL_CAPTURE id=1010 ok=1 ... source=present|browser-timer`
- `globalThis.WS04_CAPTURE_READY === 1010`
- `/ws04-frame-1010.ppm` is readable from Emscripten FS and has the native framebuffer dimensions
- the PPM passes the existing non-black threshold
- no fatal WebGL/GL error invalidates the evidence

In the starvation case proven by the previous WS50 artifact, `source=browser-timer` is the expected diagnostic. `source=present` is also valid if the main-scene lifecycle produces another Present before the fallback threshold.

## Regression evidence

WS04 CI run `38497667882`, job `115637059193`, built the real WarFare WASM client with the final hook and produced:

- Character Select: `WS04_GL_CAPTURE id=1 ok=1 ... source=present`, non-black ratio `0.8169`.
- Character Create: `WS04_GL_CAPTURE id=2 ok=1 ... source=present`, non-black ratio `0.6529`.
- Create-ready: `WS04_GL_CAPTURE id=3 ok=1 ... source=present`; native PPM generation also succeeded.

Artifact `11864965704`, zip SHA256 `4a74afe129b362e75c57ce8850a904953b79535ddf602d7ae8f2714573c34448` preserves the logs/screenshots. The job later fails on the existing sparse-fixture absence of `/data/item/upc_el_rm_*.n3cpart`, which makes the character-model inspection region black; this occurs after the capture hook has already succeeded and is unrelated to the Moradon capture fix.

## Handoff state

`WS04 IMPLEMENTATION: READY`

`INTEGRATED NATIVE MORADON PROOF: BLOCKED ONLY ON WS05 DEPENDENCY SYNC + CORRECTED WS10/WS50 RERUN`
