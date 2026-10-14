# WS01 Dependency Snapshot

## SELF

- Workstream: `WS01`
- Branch: `ws01-runtime-build`
- Pre-control head: `5545df2273cda795055a611618c91b948063624f`
- Validated public-WSS implementation: `41097de4e6204b93da7b0c6ef3ef229fc41120c4`
- Role: real OpenKO/KO 1298 WASM, Emscripten, WebGL2 runtime/build and browser transport integration boundary.

## CONTROL SOURCE

- `main` observed head: `692c780451782310669646859a4dac4ec937661c`
- Read from `main`: `coordination/inbox/WS01.md`, `coordination/MASTER_CONTROL.md`, `coordination/BROADCAST.md`, `coordination/WORKSTREAM_REGISTRY.md`, `coordination/TASK_QUEUE.md`, and `coordination/MORADON_CRITICAL_PATH.md`.
- Assignment completed: make the real Emscripten `CAPISocket` transport consume a config-driven WebSocket endpoint contract with HTTPS/WSS and distinct auth/game routes without changing KO packet semantics or native desktop TCP behavior.

## UPSTREAM / PEER CONTRACTS

### Browser baseline

- Branch: `openko-browser-port`
- Head: `18282d0e70de7ccb30244a9f09e2b3bff3040155`
- External OpenKO pin consumed by WS01: `97eb0ea20207afc0c360bfed6915113572711be3`
- Baseline contract: `tools/patch_openko_browser_gateway.py` converts only the Emscripten transport to the Emscripten WebSocket C API while retaining C++ KO framing/cryption. WS01 now layers config-driven URL selection afterward in `prepare_browser_source.py`.

### WS02 — WebSocket/TCP gateway

- Branch: `ws02-websocket-gateway`
- Head: `1738f60945b24e00bdd2266e6600b5c0cf3c64cf`
- Contract consumed: packet-agnostic binary WebSocket forwarding; separate `GATEWAY_MODE=auth|game`; default public paths `/auth` and `/game`; TLS terminates at the edge; current staging upstream TCP ports are auth `15100` and game `15001`.

### WS09 — staging edge / deployment

- Branch: `ws09-production-infra`
- Head: `2d4ec8ab89637d08b1f37c12dde0c93b89f8dc70`
- Status consumed: `STAGING MIME CONTRACT: READY`.
- Contract consumed: same public origin routes `/auth` and `/game`; local HTTP may use `ws://`; Internet-facing HTTPS uses `wss://`; native auth/game TCP listeners stay private.
- WS09 resolved the earlier WS12/WS38 JS MIME follow-up; no MIME blocker remains for this WS01 task.

### WS12 — launcher

- Branch: `ws12-browser-launcher`
- Head: `77f55b2949844e0fdd279526dab0fba4e8ab4f94`
- Status consumed: staging launcher preparation ready.
- Contract consumed: launcher resolves/probes same-origin `/auth` and `/game`, but does not rewrite the real C++ `CAPISocket` transport. The real WASM package itself must support the published endpoints.

### WS50 — isolated integration rehearsal

- Branch: `ws50-integration-rehearsal`
- Head: `94715058fdedc0a4fbab3a5f5c2ab29602fe747b`
- Decision consumed: staging candidate had one structural provider blocker owned by WS01: hardcoded plain `ws://host:port` browser transport.
- Successful prior rehearsal evidence: run `38494620556`, job `115627453667`, disposable candidate tree `72a72d5565b7945c9dcf8f54b4148acec31b5876`.
- Composition rule consumed: do not full-merge divergent browser branches; apply WS01 `tools/ws01_runtime/**` after the baseline browser patches.

## DOWNSTREAM

- WS50 should rerun isolated staging integration with WS01 `41097de4e6204b93da7b0c6ef3ef229fc41120c4` and consume the handoff in `workstreams/ws01/INTEGRATION_PATCH.md`.
- WS09 public staging consumes the resulting real WASM client behind its HTTPS/WSS edge.
- WS12 publishes/launches the real client package and remains a readiness/publication consumer.
- WS10 remains authority for the separate native browser/Moradon E2E acceptance gate; WS01 does not claim that gate.

## CONTRACTS

- Browser target port `15100` maps to configured `auth` endpoint.
- Browser target port `15001` maps to configured `game` endpoint.
- Domain-independent defaults are same-origin `/auth` and `/game`.
- Relative endpoints: HTTP -> `ws://`, HTTPS -> `wss://`.
- Explicit local `ws://` remains supported from an HTTP page.
- HTTPS refuses explicit insecure `ws://`.
- Missing, unknown, ambiguous or malformed mapping fails closed.
- Server host/port still enters the real `CAPISocket::Connect`; browser-only public routing uses the target port to select the configured gateway role. Native desktop TCP still uses the exact host/port.
- KO framing/cryption remains in C++; the JS pre-link resolver performs URL selection only.

## VALIDATION

- WS01 implementation: `41097de4e6204b93da7b0c6ef3ef229fc41120c4`
- Workflow run: `38496614280`
- Job: `115633714791`
- Result: **SUCCESS**
- Transport mapping tests: **9/9 PASS**
- Real Emscripten configure/build: PASS
- Real Chromium WebGL2/OpenGL bootstrap smoke: PASS
- Evidence artifact: `11864182177`
- Digest: `sha256:89e775de0cb059fbbb95c556de57aba579d85bf75b111afa5cfc35584f0d64f7`

## BLOCKERS

- WS01 public-WSS structural blocker: **none**.
- Project-level WS10 Moradon acceptance remains a separate downstream gate.
- WS50 still needs to consume this provider SHA and rerun its composed staging candidate before project publication can be declared.

## LAST_SYNC

Repository/dependency evidence checked on `2026-10-14`; WS01 implementation validation completed in GitHub Actions run `38496614280`.
