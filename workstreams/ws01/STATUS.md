WS01

# STATUS — Public WSS Transport Control

## Decision

**PUBLIC WSS TRANSPORT: READY**

Branch: `ws01-runtime-build`
Validated implementation commit: `41097de4e6204b93da7b0c6ef3ef229fc41120c4`

This control session is the existing WS01 workstream from `coordination/inbox/WS01.md`; no new workstream was created.

## Problem closed

WS50 isolated staging rehearsal proved that the real Emscripten/OpenKO browser transport still generated only:

```text
ws://<server-host>:<port>
```

That could not satisfy WS09's public HTTPS staging topology, which publishes packet-agnostic gateways at same-origin:

```text
wss://<temporary-host>/auth
wss://<temporary-host>/game
```

WS12 could resolve and probe those endpoints but intentionally did not rewrite native C++ `CAPISocket` transport. WS01 therefore owned the remaining structural browser transport blocker.

The WS01 implementation now removes that hardcoded browser URL while retaining the real KO C++ packet/framing/cryption path.

## Implementation

### Browser transport selection

`tools/ws01_runtime/prepare_browser_source.py` still runs after the existing `openko-browser-port` patches. It now additionally patches only the generated Emscripten `CAPISocket` source so that:

- native desktop builds keep the original Asio/TCP `CAPISocket` path unchanged;
- Emscripten builds call `OldKOWebResolveWebSocketUrl(serverHost, serverPort)` before creating the browser WebSocket;
- a missing or invalid mapping returns `-1` and fails closed;
- the old generated `const std::string url = "ws://" + szIP + ":" + ...` anchor is explicitly rejected by CI.

The KO send/receive framing, cryption and binary WebSocket forwarding remain in the existing C++ `CAPISocket` implementation. No JavaScript packet parser, fake login response or gameplay/network protocol implementation was added.

### Config-driven public endpoint contract

`tools/ws01_runtime/browser_transport_pre.js` is linked into the generated Emscripten JS with `--pre-js`. It performs endpoint selection only; it does not send or receive KO packets.

The canonical bootstrap exposes this default domain-independent contract:

```js
Module.oldkoTransport = {
  routes: {
    auth: { serverPorts: [15100], endpoint: '/auth' },
    game: { serverPorts: [15001], endpoint: '/game' }
  }
};
```

An embedding launcher/staging page may provide `window.__OLDKO_TRANSPORT_CONFIG__` before the canonical bootstrap executes to override those routes without rebuilding C++.

Deterministic resolution rules:

- server target `*:15100` -> configured `auth` route;
- server target `*:15001` -> configured `game` route;
- relative `/auth` or `/game` on an HTTP page -> same-origin `ws://...`;
- relative `/auth` or `/game` on an HTTPS page -> same-origin `wss://...`;
- explicit `ws://` remains valid for local HTTP testing;
- explicit insecure `ws://` from an HTTPS page is rejected;
- missing config, malformed endpoint, unknown target port or ambiguous port mapping is rejected instead of guessed.

The server-provided host and port still enter the real `CAPISocket::Connect` call. For the browser staging boundary, the fixed KO target port deterministically selects the public auth/game gateway route while the public origin comes from the configured endpoint/page origin. Native desktop builds continue to connect directly to the server-provided host/port over TCP.

## Dependency evidence consumed

- `main` observed during control: `692c780451782310669646859a4dac4ec937661c`.
- browser baseline `openko-browser-port`: `18282d0e70de7ccb30244a9f09e2b3bff3040155`.
- WS02 packet-agnostic gateway: `1738f60945b24e00bdd2266e6600b5c0cf3c64cf`.
- WS09 staging/deployment current head: `2d4ec8ab89637d08b1f37c12dde0c93b89f8dc70`; its strict MIME follow-up is now READY.
- WS12 launcher: `77f55b2949844e0fdd279526dab0fba4e8ab4f94`.
- WS50 integration rehearsal: `94715058fdedc0a4fbab3a5f5c2ab29602fe747b`.
- pinned OpenKO source: `97eb0ea20207afc0c360bfed6915113572711be3`.
- pinned genuine KO 1298 assets: `2055ee6ed77f1b5cfef23832dd5bc31909e14a66`.
- Emscripten: `6.0.12`.

Full dependency handoff is recorded in `workstreams/ws01/DEPENDENCY_SNAPSHOT.md`.

## Verification actually run

GitHub Actions:

- workflow: `WS01 Runtime Build`
- run: `38496614280` (run 3)
- job: `runtime-build` / `115633714791`
- implementation head: `41097de4e6204b93da7b0c6ef3ef229fc41120c4`
- result: **SUCCESS**
- evidence artifact: `ws01-runtime-evidence` / `11864182177`
- artifact digest: `sha256:89e775de0cb059fbbb95c556de57aba579d85bf75b111afa5cfc35584f0d64f7`

Passing evidence includes:

- pinned OpenKO source verification: PASS
- pinned genuine KO 1298 asset slice verification: PASS
- transport mapping unit tests: **9/9 PASS**
- committed browser package verification: PASS
- real browser patch application + hardcoded `ws://host:port` absence gate: PASS
- pinned Emscripten `6.0.12` setup/toolchain check: PASS
- real WarFare Emscripten configure: PASS
- real WarFare WASM build: PASS
- rebuilt package verification: PASS
- real Chromium WebGL2/OpenGL runtime bootstrap smoke: PASS
- runtime evidence upload: PASS

## WS50 handoff

WS50's existing narrow composition rule remains valid: copy WS01 `openko-web/index.html` and `tools/ws01_runtime/**`, apply the browser baseline patches first, then run `python3 tools/ws01_runtime/prepare_browser_source.py` at the established point in the build order.

No full merge of divergent browser branches is required. No WS02, WS09, WS12 or WS50 provider code change is required to consume this fix.

The exact WS50 integration instructions and acceptance checks are in `workstreams/ws01/INTEGRATION_PATCH.md`.

## Remaining gates outside WS01

There is no remaining WS01 structural public-WSS blocker.

Project publication still depends on downstream integration/acceptance gates owned elsewhere, including a current WS10 native browser/Moradon E2E PASS against the selected provider set and a WS50 rerun proving the composed staging candidate. WS01 does not claim those downstream gates here.

## Boundaries

- no merge to `main`
- no force push
- no other workstream branch modified
- no WS02 gateway behavior modified
- no WS09 infrastructure modified
- no WS12 launcher implementation modified
- no fake JS/HTML KO protocol implementation added
- no production domain, DNS, certificate or secret assumed

BU SOHBETE ARTIK GEREK VAR MI?: HAYIR
