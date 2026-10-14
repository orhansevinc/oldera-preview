# WS50 — Staging Apply Order

This is the reproducible apply/build order for the Moradon public-test candidate. It is a rehearsal recipe, **not** a merge plan into `main`.

## 0. Freeze first

Resolve every moving provider branch once, record the exact commit SHA, and use only those SHAs afterward. Do not compose from live branch names after the freeze.

Successful WS50 rehearsal snapshot:

```text
CONTROL_BASE 3aeaaa3de81c8094b47de44f2c24f3c455e7fd3d
BROWSER_BASELINE 18282d0e70de7ccb30244a9f09e2b3bff3040155
WS01 5545df2273cda795055a611618c91b948063624f
WS02 1738f60945b24e00bdd2266e6600b5c0cf3c64cf
WS03 d634870bbcd2c541695516643d34e0ac119354d7
WS04 fffbd9372b67c2aaef600f7e50595bec7e23fe88
WS05 6ca101f3390e0a0f6b056afea99b45ec8d4f67be
WS09 afca7e7e578a81b8b5852f8a1b3d15a233348847
WS10 34c551518aad87a9fd03d392f193d354483c95a0
WS12 77f55b2949844e0fdd279526dab0fba4e8ab4f94
WS14 82cdcef40bed265ff4c4ce0fb7c8f6ad8cf2f52b
WS38 5f323f3cf055ba7f96d928605a2f2faf84e609cb
OPENKO 97eb0ea20207afc0c360bfed6915113572711be3
KO_ASSETS 2055ee6ed77f1b5cfef23832dd5bc31909e14a66
EMSCRIPTEN 6.0.12
```

If WS05 moves while applying this recipe, re-fetch it before any READY/PUBLISH decision and restart the freeze with the new exact provider set.

## 1. Create a disposable integration tree

Start from the exact WS50 control base in a detached worktree/clone. Do not merge or push from the provider branches.

Copy/check out only these provider-owned paths at their frozen SHAs:

```text
openko-browser-port:
  tools/patch_openko_browser.py
  tools/patch_openko_browser_gateway.py
  tools/fix_browser_server_ini_case.py
  tools/patch_openko_browser_serverlist_probe.py
  tools/patch_openko_browser_auth_probe.py

WS01:
  openko-web/index.html
  tools/ws01_runtime/**

WS38:
  content-pipeline/**
  tools/ws38_content/**
  tests/content-pipeline/**

WS12:
  play-shell/**
  tools/ws12_launcher/**
  tests/ws12-launcher/**

WS02:
  services/ko-gateway/**
  tests/ko-gateway/**

WS03:
  services/ko1298-session/**
  tests/ko1298-session/**

WS04:
  tools/ws04_character/**

WS14:
  services/ko1298-world/**
  tests/ko1298-world/**

WS05:
  tools/ws05_moradon/**

WS10 integration-only:
  qa/**
  tests/e2e/**
```

WS09 remains read-only input for compose/Nginx/publication contracts.

Do **not** full-merge WS01, WS04 or WS05. Their branch ancestry is intentionally divergent; the browser build must use the narrow provider scripts/inputs above.

## 2. Verify the source tree before building

Run the static/unit gates in this order:

```bash
git diff --cached --check
node tools/ws12_launcher/check-config.cjs
node --test tests/ws12-launcher/launcher-core.test.cjs
node --test tests/ko-gateway/gateway.test.js
node --test tests/ko1298-session/session.test.js
node --test tests/ko1298-world/protocol-boundary.test.js tests/ko1298-world/world-session.test.js
python3 -m unittest discover -s tests/content-pipeline -p 'test_*.py' -v
python3 tools/ws05_moradon/test_moradon_gate.py
node --check qa/moradon/integration-server.cjs
node --check qa/moradon/browser-e2e.cjs
```

Then verify the integrated CommonJS sibling boundary, not only the two services independently:

```text
services/ko1298-session/server.js
        require('../ko1298-world')
services/ko1298-world/index.js
        exports WorldSessionService
```

The WS50 successful rehearsal verified this runtime load directly.

## 3. Prepare the real browser client checkout

Use the immutable external source/assets pins:

```text
OpenKO:   97eb0ea20207afc0c360bfed6915113572711be3
ko-assets: 2055ee6ed77f1b5cfef23832dd5bc31909e14a66
```

Apply browser changes to that temporary checkout in this order:

```bash
python3 tools/patch_openko_browser.py
python3 tools/patch_openko_browser_gateway.py
python3 tools/fix_browser_server_ini_case.py
python3 tools/patch_openko_browser_serverlist_probe.py
python3 tools/patch_openko_browser_auth_probe.py
python3 tools/ws04_character/patch_character_client.py
python3 tools/ws04_character/patch_frame_capture.py
python3 tools/ws05_moradon/patch_moradon_client.py
python3 tools/ws01_runtime/prepare_browser_source.py --source openko --assets ko-assets
```

`openko-web/index.html` from WS01 remains the canonical package index; do not replace it with a launcher mock or Three.js client.

### Blocking prerequisite before public build

The current `patch_openko_browser_gateway.py` must first be corrected by **WS01** so the actual native `CAPISocket` can consume staging-safe `wss://` auth/game endpoints. The current injected URL is `ws://<host>:<port>` only. WS50 must not implement that provider change.

## 4. Build the real Emscripten client

Use Emscripten `6.0.12` and WS01's established build contract:

```bash
emcmake cmake -S openko -B build-web -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_C_FLAGS='-DBOOST_HAS_PTHREADS=1' \
  -DCMAKE_CXX_FLAGS='-DBOOST_HAS_PTHREADS=1 -DASIO_DISABLE_THREADS=1 -fexceptions' \
  -DCMAKE_EXE_LINKER_FLAGS='-fexceptions' \
  -DOPENKO_BUILD_CLIENT=ON \
  -DOPENKO_CLIENT_POSIX_EXPERIMENTAL=ON \
  -DOPENKO_BUILD_CLIENT_TOOLS=OFF \
  -DOPENKO_BUILD_TOOLS=OFF \
  -DOPENKO_BUILD_SERVERS=OFF \
  -DOPENKO_BUILD_TESTS=OFF \
  -DOPENKO_FETCH_CLIENT_ASSETS=OFF \
  -DOPENKO_COMPILE_WARNINGS_AS_ERROR=OFF

cmake --build build-web --target WarFare -j2
```

Require non-empty:

```text
KnightOnLine.js
KnightOnLine.wasm
KnightOnLine.data
index.html
```

## 5. Publish client content through WS38

Generate/verify the versioned WS38 release, checksum manifest, `latest.json` pointer and completion marker using the frozen WS38 tools. Do not publish a partial version directory as complete.

The staging launcher should consume the WS12 staging configuration pattern:

```text
publication.latestUrl = /latest.json
publication.requirePublicationMarker = true
publication.verifyRequiredFiles = true
publication.strictContentType = true
gateway endpoints = /auth, /game
```

Before enabling strict publication, align the WS09 edge MIME contract with the WS38 profile for `KnightOnLine.js` (`text/javascript; charset=utf-8`). This is a WS09 deployment follow-up and must not be silently rewritten by WS50.

## 6. Build server-side images

### WS02 gateway

Build from repository-root context so its checked-in Dockerfile can copy `services/ko-gateway/**` correctly:

```bash
docker build -f services/ko-gateway/Dockerfile -t <immutable-gateway-image> .
```

### Integrated WS03 + WS14 runtime

The staging server image must contain both sibling service directories in the same filesystem because WS03 loads WS14 with `require('../ko1298-world')`.

Integration-only Docker layout:

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY services/ko1298-session /app/services/ko1298-session
COPY services/ko1298-world /app/services/ko1298-world
CMD ["node","services/ko1298-session/server.js"]
```

Do not build an image containing only `services/ko1298-session`; that would lose the intended world-session provider at runtime.

WS50 rehearsal proved both auth/game TCP listeners from this combined image.

## 7. Render WS09 staging deployment

Consume frozen WS09 deployment files read-only and supply immutable image references:

```text
GATEWAY_IMAGE=<immutable WS02 image>
KO_SESSION_WORLD_IMAGE=<immutable integrated WS03+WS14 image>
```

Validate before deployment:

```bash
docker compose -f docker-compose.ws09-staging.yml config
```

The public edge is expected to expose:

```text
https://<temporary-staging-host>/play-shell/
wss://<temporary-staging-host>/auth
wss://<temporary-staging-host>/game
```

No purchased production domain is assumed.

## 8. Final gates before a public test link

A public staging publish is allowed only after all of the following are true:

1. WS10 Moradon native E2E is a current PASS against the same frozen WS05/browser provider set.
2. WS01 native C++/Emscripten transport supports the WS09 WSS auth/game staging contract.
3. WS09/WS38/WS12 strict content-type contract is aligned.
4. the exact client package published by WS38 is the one exercised by the launcher.
5. WS02 `/auth` and `/game` gateways reach the integrated WS03+WS14 server image.
6. the public HTTPS page performs a real create -> refresh -> select -> Moradon session; HTTP health/readiness probes alone do not count.

### Current upstream PASS state

The corrected-WS05 rerun reached native Moradon zone/assets/terrain/shapes/local-player markers but failed waiting for `WS04_GL_CAPTURE id=1010 ok=1`. Thus the WS10 PASS prerequisite is still open.

## 9. Reproducibility marker

For the successful WS50 rehearsal, the exact composed Git tree was:

```text
72a72d5565b7945c9dcf8f54b4148acec31b5876
```

Any provider SHA change invalidates that tree hash and requires a new freeze/rehearsal.
