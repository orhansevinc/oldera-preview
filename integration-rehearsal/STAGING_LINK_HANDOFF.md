# WS50 — STAGING LINK HANDOFF

## Release decision

**STAGING LINK CANDIDATE: READY**

The latest WS50 staging-candidate rehearsal completed successfully after the canonical WS10 Moradon E2E PASS and now includes the WS09 public-smoke fix, the WS12 browser gateway-preflight hardening, the WS01 public-staging WebSocket compatibility bridge, and the WS03 development/staging world-character snapshot completion required by WS14 MYINFO.

## Canonical WS10 PASS

```text
WS10_PASS_RUN_ID=38505039290
WS10_PASS_RUN_NUMBER=26
WS10_PASS_HEAD_SHA=f0cadfb50b5d1a36d2bfe4e5bf0a68f7c3061f41
WS10_PASS_ARTIFACT_NAME=ws10-moradon-e2e-26
WS10_CLIENT_ARTIFACT_NAME=ws10-moradon-passing-client-26
```

Run 38505039290 completed SUCCESS and proves the real C++/Emscripten/WASM/WebGL2 path through login, character create/select, Moradon terrain/shapes/local-player render and non-black native GL framebuffer.

Passing client artifact identity:

```text
artifact_id=11867980473
artifact_digest=sha256:ff9fb679ad1b3caa184ad098cff81cfb5469b0698d5e5f3b76ef4fab2ea775b3
KnightOnLine.js=1493510 bytes
KnightOnLine.wasm=5631727 bytes
KnightOnLine.data=615930538 bytes
```

The three client binaries are consumed unchanged. The public wrapper may adapt only browser transport URL construction; no KO packet/protocol/gameplay logic is modified.

## Final WS50 staging revalidation

```text
WS50_STAGING_RUN_ID=38510205667
WS50_STAGING_RUN_NUMBER=36
WS50_STAGING_JOB_ID=115676728639
WS50_STAGING_RESULT=SUCCESS
WS50_STAGING_ARTIFACT_NAME=ws50-staging-candidate
WS50_STAGING_ARTIFACT_ID=11869626933
WS50_STAGING_ARTIFACT_SHA256=b9c7f1ca3a14097faa6af385c81fcc94ea2b92d205c458d5bb0abec93bb2e32f
CANDIDATE_TREE_SHA=d7aac0d6095d5b4eb82b352633e9988072d89a82
```

The run reported `all_required_contracts=true` and `blocker_owner=null`, rebuilt the integrated WS03+WS14 session-world image with the updated WS03 provider, and re-fetched every provider ref at run end with exact equality.

## Frozen provider set

```text
MAIN_SHA=5715c55abd9ecb36bb32a259d045ba9ad1dc9551
BROWSER_BASELINE_SHA=18282d0e70de7ccb30244a9f09e2b3bff3040155
WS01_SHA=57d0aa7c6a82810d5f126bda83a368e7eb7801bb
WS02_SHA=1738f60945b24e00bdd2266e6600b5c0cf3c64cf
WS03_SHA=237c4a613e94434baae656c1399cb449e7b78067
WS04_SHA=32616b1b7ccbdc3de41c0949f182a65e03450d18
WS05_SHA=0537c481383a69c534799b43810f35e7279c5578
WS09_SHA=b54e24956f73015df90ec68aeed50ddda9cd331e
WS10_SNAPSHOT_SHA=4a81c6cf7e11514ca01f0730ecc57010c9ea37fb
WS11_SHA=05562662d9d3f13a4b0500d0478e065fd802cfd0
WS12_SHA=121bb7bdb82c364bf9459111096f5ff007873a61
WS14_SHA=82cdcef40bed265ff4c4ce0fb7c8f6ad8cf2f52b
WS38_SHA=5f323f3cf055ba7f96d928605a2f2faf84e609cb
WS45_SHA=4a66338743553c2781c68ca84b866ff4e999c14e
OPENKO_SHA=97eb0ea20207afc0c360bfed6915113572711be3
KO_ASSETS_SHA=2055ee6ed77f1b5cfef23832dd5bc31909e14a66
EMSCRIPTEN_VERSION=6.0.12
```

## Public-only disconnect fix

The first public link used WS03's in-memory development repository, whose created character record stopped at basic select-screen fields. WS14's verified 1298 MYINFO encoder requires the full world snapshot after the client sends GAMESTART. The public client therefore could finish its local Moradon load/render, while the server composition threw on missing world fields and closed the game TCP/WebSocket session.

WS03 commit `237c4a613e94434baae656c1399cb449e7b78067` makes the development/staging character fixture protocol-complete (HP/MP, stats, rank/title, experience, loyalty, resistances, authority, item/skill tails, etc.) without changing client binaries or 1298 packet layout. WS03 CI run `38510142572` completed SUCCESS, and this WS50 staging candidate reran the integrated provider suites and container composition successfully.

## Public test contract

Single user entry:

```text
https://<temporary-host>/play-shell/
```

Same-origin browser transport:

```text
wss://<temporary-host>/auth
wss://<temporary-host>/game
```

Backend topology:

```text
/auth -> WS02 auth gateway -> WS03/WS14 integrated session-world auth TCP :15100
/game -> WS02 game gateway -> WS03/WS14 integrated session-world game TCP :15001
```

The canonical WS10 artifact was built for the local E2E topology and emits browser websocket URLs by KO server port. WS01 public wrapper commit `57d0aa7c6a82810d5f126bda83a368e7eb7801bb` installs a staging compatibility bridge before `KnightOnLine.js` loads:

```text
*:15100 -> same-origin wss://<temporary-host>/auth
*:15001 -> same-origin wss://<temporary-host>/game
```

The mapping is limited to those two known KO transport ports and leaves the exact WS10 KnightOnLine.js/.wasm/.data binaries untouched.

Static publication uses WS12 + WS38 and the exact passing WS10 client binaries. Required MIME contract:

```text
KnightOnLine.js   -> text/javascript; charset=utf-8
KnightOnLine.wasm -> application/wasm
KnightOnLine.data -> application/octet-stream
```

The WS12 browser launcher retries public WSS readiness, uses a 12-second probe timeout, and does not hard-block OYNA on a browser-only probe false negative when both same-origin gateway health endpoints are actually healthy. The real client performs the authoritative transport connection.

## WS09 dispatch values

```text
ws10_run_id=38505039290
ws10_head_sha=f0cadfb50b5d1a36d2bfe4e5bf0a68f7c3061f41
ws10_pass_artifact_name=ws10-moradon-e2e-26
ws10_client_artifact_name=ws10-moradon-passing-client-26
ws01_sha=57d0aa7c6a82810d5f126bda83a368e7eb7801bb
ws02_sha=1738f60945b24e00bdd2266e6600b5c0cf3c64cf
ws03_sha=237c4a613e94434baae656c1399cb449e7b78067
ws12_sha=121bb7bdb82c364bf9459111096f5ff007873a61
ws14_sha=82cdcef40bed265ff4c4ce0fb7c8f6ad8cf2f52b
ws38_sha=5f323f3cf055ba7f96d928605a2f2faf84e609cb
keepalive_minutes=45
```

`ws50_handoff_ref` is the exact commit containing this READY file and is supplied to WS09 after this update commit is created.

WS09 may expose `TEST_LINK=https://<temporary-host>/play-shell/` only after its actual public smoke gates pass, including `/healthz`, launcher/publication identity, gateway health, WebSocket 101 upgrades on `/auth` and `/game`, and WS12 strict content verification.

```text
DECISION=READY
BLOCKER_OWNER=NONE
PUBLIC_TEST_LINK=READY_FOR_WS09_EPHEMERAL_PUBLISHER
```
