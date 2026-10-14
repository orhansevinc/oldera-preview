WS01

# DEPENDENCY SNAPSHOT — True Widescreen Runtime

## SELF

- Workstream: `WS01`
- Branch: `ws01-runtime-build`
- Validated true-widescreen implementation: `bbafbcfa0ddfcae307d26ac39d4bc7ed4727038b`
- Previous validated public-WSS provider remains included.
- Role: authentic OpenKO/KO 1298 Emscripten/WebGL2 runtime, native browser display/backing store, package/build and browser transport boundary.

## CONTROL SOURCE

- `main` observed head: `c75118905217343d30d3e25cf24a1552a5dc82b1`.
- Read from `main`: `coordination/MASTER_CONTROL.md`, `coordination/BROADCAST.md`, `coordination/WORKSTREAM_REGISTRY.md`, `coordination/MORADON_CRITICAL_PATH.md`, `coordination/inbox/WS01.md`, `coordination/inbox/WS43.md`.
- Current assignment: remove the browser-only fixed `1024x768` native backing assumption, provide real native widescreen/resize/fullscreen geometry without UI stretch/crop, preserve input alignment and preserve same-origin public WSS `/auth` + `/game`.

## UPSTREAM / PEER CONTRACTS

### OpenKO browser baseline

- Browser baseline: `openko-browser-port` / `18282d0e70de7ccb30244a9f09e2b3bff3040155`.
- External OpenKO pin: `97eb0ea20207afc0c360bfed6915113572711be3`.
- Genuine KO 1298 assets pin: `2055ee6ed77f1b5cfef23832dd5bc31909e14a66`.
- Emscripten: `6.0.12`.
- Exact root fixed-resolution evidence: baseline `tools/patch_openko_browser.py` injected `CN3Base::s_Options.iViewWidth = 1024` / `iViewHeight = 768` for Emscripten. WS01 replaces that generated browser-only block; native desktop settings remain untouched.

### WS43 — display compatibility contract

- Branch: `ws43-client-display-compat`.
- Head consumed: `8ccf0fcb643ec1ebb5f019e8f53c8d3d93f85e03`.
- Decision consumed: `DISPLAY FULLSCREEN: READY` within WS43 ownership.
- Contract consumed: `workstreams/ws43/WS01_WIDESCREEN_CONTRACT.md`.
- Required native matrix: `1280x720`, `1366x768`, `1600x900`, `1920x1080`; retain `1024x768` classic fallback.
- Invariant: SDL logical size, Emscripten canvas/default framebuffer and RHI/WebGL viewport agree; DPR must not silently multiply the selected native target; no CSS stretch/crop/fake HUD; pointer coordinates remain native-aligned.

### WS10 — canonical Moradon PASS

- Branch: `ws10-qa-integration`.
- Snapshot head observed: `4a81c6cf7e11514ca01f0730ecc57010c9ea37fb`.
- Canonical PASS workflow run: `38505039290` (#26), tested harness commit `f0cadfb50b5d1a36d2bfe4e5bf0a68f7c3061f41`.
- Frozen passing client artifact: `ws10-moradon-passing-client-26`, artifact id `11867980473`, digest `sha256:ff9fb679ad1b3caa184ad098cff81cfb5469b0698d5e5f3b76ef4fab2ea775b3`.
- Canonical run proved real login/create/select/Moradon terrain/shapes/local-player and non-black native GL at its original `1024x768` framebuffer. WS01 does not rewrite that frozen artifact; it supplies the next runtime provider for a widescreen rebuild/integration pass.

### WS50 — staging composition

- Branch: `ws50-integration-rehearsal`.
- READY handoff head observed: `9e0fc1822351965755fc490c2d2abf34d40f430d`.
- `integration-rehearsal/STAGING_LINK_HANDOFF.md`: `STAGING LINK CANDIDATE: READY`.
- Narrow composition rule remains: do not blind-merge browser branches; copy WS01 runtime-owned slice and apply it after the established baseline/provider patches.

### WS09 — public HTTPS/WSS staging

- Branch head observed: `29575ef1ecd4150485b53553d73fdfd059be7c38`.
- Ephemeral run `38510331579`, job `115677506671`: public HTTPS publication, strict MIME, WSS `/auth` and `/game` smoke and WS12 publication preflight all completed SUCCESS before keepalive.
- Same-origin contract remains `wss://<temporary-host>/auth` and `wss://<temporary-host>/game`.

## IMPLEMENTED CONTRACTS

- Default browser display mode: `viewport` / native viewport-sized SDL logical and canvas/default framebuffer.
- Explicit `classic` mode: native `1024x768` fallback.
- Explicit `fixed` mode supported for a selected native size such as `1920x1080`.
- Initial browser dimensions are selected before SDL window / renderer / UI initialization.
- Runtime resize/fullscreen changes flow through `SDL_SetWindowSize`, update `CN3Base::s_Options`, and reset the full D3D/RHI viewport.
- RHIDeviceGL refreshes default-framebuffer geometry before draw-state application and after present so viewport/scissor do not use stale dimensions.
- Emscripten browser window creation disables SDL high-pixel-density backing multiplication; native desktop keeps upstream `SDL_WINDOW_HIGH_PIXEL_DENSITY` behavior.
- CSS presentation only performs uniform fit of the native canvas; no non-uniform stretch or crop.
- Pointer diagnostic mapping remains consistent with SDL logical coordinates.
- Public transport remains config-driven: server port `15100` -> auth endpoint, `15001` -> game endpoint; HTTPS uses same-origin WSS; local HTTP may use WS; native desktop TCP remains unchanged.

## VALIDATION

- Validated implementation commit: `bbafbcfa0ddfcae307d26ac39d4bc7ed4727038b`.
- Workflow: `WS01 Runtime Build`.
- Run: `38513332857` (#12).
- Job: `115686662234` — **SUCCESS**.
- Evidence artifact: `ws01-runtime-evidence`, id `11870948283`.
- Digest: `sha256:d93e427d5ddeed22b18af3af548c5ea42482d2ded543ac540b43cd28cffe5878`.
- Transport tests: 9/9 PASS.
- Display contract tests: 8/8 PASS.
- Real pinned Emscripten configure/build: PASS.
- Real Chromium WebGL2/OpenGL runtime smoke at `devicePixelRatio=2`: PASS.
- Native matrix: `1280x720`, `1366x768`, `1600x900`, `1920x1080`: PASS.
- Classic native `1024x768` fallback: PASS.
- Canvas/default framebuffer, RHI viewport, WebGL viewport and pointer-center alignment: PASS.
- Fullscreen-change resize path: PASS in browser event-path automation.

## DOWNSTREAM

- WS43 can consume the native backing dimensions for live fullscreen presentation and headed edge-click acceptance.
- WS10/integration should rebuild/run the canonical Moradon flow with this WS01 provider to add state-specific HUD/inventory/dialog visual evidence at widescreen; this is downstream acceptance, not a remaining WS01 native backing-store blocker.
- WS50/WS09 must re-freeze this new WS01 provider before publishing it; the previously live/passing public candidate proves transport topology but contains the older WS01 provider.

## BLOCKERS

- WS01 native true-widescreen/backing-store blocker: **none**.
- No claim is made that the old frozen WS10 PASS binary magically became widescreen; it remains immutable evidence for the prior `1024x768` canonical pass.

## LAST_SYNC

Repository and dependency evidence checked on `2026-10-14`; latest WS01 implementation validation is run `38513332857`.
