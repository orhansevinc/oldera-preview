# WS01 Dependency Snapshot

## SELF

- Workstream: `WS01`
- Branch: `ws01-runtime-build`
- Pre-control head: `5545df2273cda795055a611618c91b948063624f`
- Role: real OpenKO/KO 1298 WASM, Emscripten, WebGL2 runtime/build and browser transport integration boundary.

## CONTROL SOURCE

- `main` observed head: `692c780451782310669646859a4dac4ec937661c`
- Read from `main`: `coordination/inbox/WS01.md`, `coordination/MASTER_CONTROL.md`, `coordination/BROADCAST.md`, `coordination/WORKSTREAM_REGISTRY.md`, `coordination/TASK_QUEUE.md`, and `coordination/MORADON_CRITICAL_PATH.md`.
- Current assignment: remove WS50's public-staging blocker by making the real Emscripten `CAPISocket` transport use a config-driven WebSocket endpoint contract with HTTPS/WSS and distinct auth/game routes, without changing KO packet semantics or native desktop TCP behavior.

## UPSTREAM / PEER CONTRACTS

### Browser baseline

- Branch: `openko-browser-port`
- Head: `18282d0e70de7ccb30244a9f09e2b3bff3040155`
- External OpenKO pin consumed by WS01: `97eb0ea20207afc0c360bfed6915113572711be3`
- Browser baseline script: `tools/patch_openko_browser_gateway.py` converts only the Emscripten transport to the Emscripten WebSocket C API while retaining C++ KO framing/cryption. Its current generated URL is hardcoded `ws://<server-host>:<port>` and is the provider defect WS01 layers over during `prepare_browser_source.py`.

### WS02 — WebSocket/TCP gateway

- Branch: `ws02-websocket-gateway`
- Head: `1738f60945b24e00bdd2266e6600b5c0cf3c64cf`
- Status: complete provider contract.
- Contract used: packet-agnostic binary WebSocket forwarding; separate `GATEWAY_MODE=auth|game`; default WebSocket paths `/auth` and `/game`; TLS terminates at the public reverse proxy; local upstream TCP targets remain auth `15100` and game `15001` in the current staging topology.

### WS09 — staging edge / deployment

- Branch: `ws09-production-infra`
- Head: `2d4ec8ab89637d08b1f37c12dde0c93b89f8dc70`
- Status: `STAGING MIME CONTRACT: READY`.
- Contract used: same public origin routes `/auth` and `/game`; HTTP local test may use `ws://`; Internet-facing HTTPS test uses `wss://`; native auth/game TCP listeners stay private.
- WS09 has already resolved the WS12/WS38 strict JS/WASM/DATA MIME mismatch; no WS09 MIME blocker remains for this task.

### WS12 — launcher

- Branch: `ws12-browser-launcher`
- Head: `77f55b2949844e0fdd279526dab0fba4e8ab4f94`
- Status: staging launcher preparation ready.
- Contract used: launcher resolves/probes same-origin `/auth` and `/game`, but explicitly does not rewrite the real native C++ `CAPISocket` transport. The real WASM package must itself support the published transport endpoints.

### WS50 — isolated integration rehearsal

- Branch: `ws50-integration-rehearsal`
- Head: `94715058fdedc0a4fbab3a5f5c2ab29602fe747b`
- Current decision consumed: staging candidate blocked by WS01 browser-native transport only.
- Successful rehearsal evidence: workflow run `38494620556`, job `115627453667`, disposable candidate tree `72a72d5565b7945c9dcf8f54b4148acec31b5876`.
- WS50 composition rule used: do not full-merge divergent browser branches; apply WS01 `tools/ws01_runtime/**` after the baseline browser patches.

## DOWNSTREAM

- WS50 must rerun the isolated staging candidate after this WS01 provider change to remove its recorded structural transport blocker.
- WS09 public staging consumes the resulting real WASM client behind its HTTPS/WSS edge.
- WS12 publishes/launches the real client package but remains only a readiness/publication consumer.
- WS10 remains the authority for the separate full native browser/Moradon E2E gate; WS01 does not claim that gate here.

## CONTRACTS RELIED ON

- Browser auth target port `15100` maps to the configured `auth` WebSocket endpoint.
- Browser game target port `15001` maps to the configured `game` WebSocket endpoint.
- Default domain-independent staging endpoints are same-origin `/auth` and `/game`.
- Relative endpoint resolution is page-origin based: HTTP -> `ws://`, HTTPS -> `wss://`.
- Explicit local `ws://` remains supported on HTTP pages.
- HTTPS refuses explicit insecure `ws://` endpoints.
- Missing, unknown, ambiguous, or malformed endpoint configuration fails closed rather than guessing.
- Server-provided host/port still reaches `CAPISocket::Connect`; the browser-only mapping selects the public WebSocket route from the server port while preserving native desktop TCP behavior and all KO framing/cryption in C++.

## BLOCKERS

- No implementation blocker identified inside WS01 after consuming the current WS02/WS09/WS12/WS50 contracts.
- Project-level WS10 Moradon evidence acceptance remains a separate downstream gate and is not owned by WS01.

## LAST_SYNC

Repository evidence checked on `2026-10-14` before the WS01 public-WSS implementation commit.
