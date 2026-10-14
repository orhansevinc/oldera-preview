WS01

# INTEGRATION PATCH — WS50 Public WSS Blocker Handoff

## Provider decision

**PUBLIC WSS TRANSPORT: READY** at WS01 implementation commit:

```text
41097de4e6204b93da7b0c6ef3ef229fc41120c4
```

Validated by `WS01 Runtime Build` run `38496614280`, job `115633714791`: **SUCCESS**.

This note is the narrow integration handoff requested by `coordination/inbox/WS01.md`. It does not authorize a full branch merge.

## Why WS50 was blocked

The baseline browser transport patch in `openko-browser-port` correctly moved the Emscripten build away from synchronous browser TCP and onto Emscripten's WebSocket C API, while preserving C++ KO framing/cryption. Its browser URL selection, however, remained hardcoded to:

```cpp
const std::string url = "ws://" + szIP + ":" + std::to_string(dwPort);
```

That could not consume WS09's HTTPS staging edge:

```text
wss://<temporary-host>/auth
wss://<temporary-host>/game
```

WS12 readiness probes cannot and must not rewrite this native C++ transport URL.

## Narrow composition for WS50

Keep WS50's established browser composition order. Do not full-merge WS01, WS04 or WS05.

From the frozen browser baseline, apply:

```bash
python3 tools/patch_openko_browser.py
python3 tools/patch_openko_browser_gateway.py
python3 tools/fix_browser_server_ini_case.py
python3 tools/patch_openko_browser_serverlist_probe.py
python3 tools/patch_openko_browser_auth_probe.py
# WS04 / WS05 browser provider patches at their existing positions
python3 tools/ws01_runtime/prepare_browser_source.py
```

WS50 should consume these WS01-owned paths from the validated WS01 provider commit:

```text
openko-web/index.html
tools/ws01_runtime/**
```

The shared baseline `tools/patch_openko_browser_gateway.py` itself is intentionally not rewritten by WS01 in this control task. WS01 layers the provider correction afterward in `prepare_browser_source.py`, matching WS50's existing narrow-copy rule.

## Generated OpenKO change

After the baseline gateway patch has injected the Emscripten WebSocket transport, `prepare_browser_source.py` modifies only the Emscripten browser URL-selection boundary:

1. Adds an `EM_JS` bridge named `OldKOWebResolveWebSocketUrl`.
2. Calls the generated Emscripten Module resolver with the real `serverHost` and `serverPort` received by `CAPISocket::Connect`.
3. Requires a non-empty resolved WebSocket URL; otherwise `Connect` returns failure.
4. Removes the hardcoded `ws://<host>:<port>` construction.
5. Adds `tools/ws01_runtime/browser_transport_pre.js` as Emscripten `--pre-js`.

The native `#else` Asio/TCP path is unchanged. Existing C++ packet framing, encryption/decryption, queueing and Emscripten binary WebSocket send/receive callbacks are unchanged.

## Runtime config contract

Canonical `openko-web/index.html` now provides a domain-independent default:

```js
{
  routes: {
    auth: { serverPorts: [15100], endpoint: '/auth' },
    game: { serverPorts: [15001], endpoint: '/game' }
  }
}
```

If a staging environment needs a different mapping, define `window.__OLDKO_TRANSPORT_CONFIG__` before the canonical bootstrap executes. Shape:

```js
window.__OLDKO_TRANSPORT_CONFIG__ = {
  routes: {
    auth: {
      serverPorts: [15100],
      endpoint: '/auth'
    },
    game: {
      serverPorts: [15001],
      endpoint: '/game'
    }
  }
};
```

Endpoints may also be explicit `ws://`, `wss://`, `http://` or `https://` URLs. `http(s)` schemes are normalized to `ws(s)` by the resolver. Relative endpoints resolve against the page origin.

### Deterministic public-origin mapping

For current KO 1298 staging ports:

```text
serverHost:any + serverPort:15100 -> auth endpoint
serverHost:any + serverPort:15001 -> game endpoint
```

The public WebSocket authority/path comes from the configured endpoint. With the default same-origin routes:

```text
http://127.0.0.1:8000/index.html
  auth -> ws://127.0.0.1:8000/auth
  game -> ws://127.0.0.1:8000/game

https://temporary-staging.example/real1298/index.html
  auth -> wss://temporary-staging.example/auth
  game -> wss://temporary-staging.example/game
```

This is intentional: a browser on a public HTTPS origin must not attempt to connect directly to a private server-advertised TCP host. The real host/port values still enter `CAPISocket::Connect`; the browser-only adapter maps the known KO target port to the configured public gateway route. Desktop/native TCP continues to use the exact server-provided host/port.

## Fail-closed rules

WS50/public staging should treat any resolver error as a client transport failure. The resolver rejects:

- missing configuration;
- missing auth or game route;
- invalid server target port;
- unknown target port;
- the same port assigned to more than one role;
- empty/malformed endpoint;
- unsupported endpoint protocol;
- endpoint credentials/fragments;
- explicit insecure `ws://` when the page itself is HTTPS.

No fallback to guessed host/port is performed.

## Provider validation evidence

Validated implementation commit:

```text
41097de4e6204b93da7b0c6ef3ef229fc41120c4
```

GitHub Actions evidence:

```text
workflow  WS01 Runtime Build
run       38496614280
job       115633714791
result    SUCCESS
artifact  11864182177 (ws01-runtime-evidence)
digest    sha256:89e775de0cb059fbbb95c556de57aba579d85bf75b111afa5cfc35584f0d64f7
```

Provider-side checks that passed:

- `node --test tools/ws01_runtime/transport_config.test.cjs`: 9/9 PASS
- hardcoded browser `ws://host:port` absence gate: PASS
- real OpenKO source patch application: PASS
- pinned Emscripten 6.0.12 configure: PASS
- real WarFare WASM compile: PASS
- rebuilt package validation: PASS
- real Chromium WebGL2/OpenGL runtime bootstrap: PASS

## WS50 acceptance checks after consuming this handoff

WS50 should rerun its isolated staging-candidate rehearsal with the new WS01 SHA and verify at minimum:

```text
browser_transport_hardcoded_plain_ws_host_port = false
browser_transport_explicit_wss_support = true
browser_transport_auth_game_path_support = true
```

For a real public HTTPS candidate, browser evidence must show that the real WASM client opens the WS09 edge routes as WSS `/auth` and `/game`; health/readiness probes alone are not sufficient.

The separate WS10 Moradon E2E acceptance gate remains outside WS01 ownership.

## Files owned/changed by this provider control

```text
.github/workflows/ws01-runtime.yml
openko-web/index.html
tools/ws01_runtime/browser_transport_pre.js
tools/ws01_runtime/transport_config.test.cjs
tools/ws01_runtime/prepare_browser_source.py
workstreams/ws01/DEPENDENCY_SNAPSHOT.md
workstreams/ws01/INTEGRATION_PATCH.md
workstreams/ws01/STATUS.md
```

No other workstream implementation path needs to be copied from WS01.
