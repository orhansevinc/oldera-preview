# WS50 — STAGING LINK HANDOFF

## Release decision

**STAGING LINK CANDIDATE: READY**

The latest WS50 staging-candidate rehearsal completed successfully after the canonical WS10 Moradon E2E PASS and now includes both the WS09 public-smoke fix and the WS12 browser gateway-preflight hardening. This handoff freezes the exact passing client identity and the current publication provider set for WS09's ephemeral HTTPS/WSS publisher.

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

The client must be consumed unchanged. WS50/WS09 must not rebuild or substitute it.

## Final WS50 staging revalidation

```text
WS50_STAGING_RUN_ID=38507795217
WS50_STAGING_RUN_NUMBER=31
WS50_STAGING_JOB_ID=115669179445
WS50_STAGING_RESULT=SUCCESS
WS50_STAGING_ARTIFACT_NAME=ws50-staging-candidate
WS50_STAGING_ARTIFACT_ID=11868522345
WS50_STAGING_ARTIFACT_SHA256=153b5653d29aff31ce14a900310278bc65ec9b862912a1e023276890c2e96d06
CANDIDATE_TREE_SHA=c1188f5ce2a9fb22b977ae88c1c8504353f21642
```

The run reported `all_required_contracts=true` and `blocker_owner=null`, and re-fetched every provider ref at run end with exact equality.

## Frozen provider set

```text
MAIN_SHA=5715c55abd9ecb36bb32a259d045ba9ad1dc9551
BROWSER_BASELINE_SHA=18282d0e70de7ccb30244a9f09e2b3bff3040155
WS01_SHA=25c2fcd9c59e8f7a704f7d2ac0d5c331d0042ff9
WS02_SHA=1738f60945b24e00bdd2266e6600b5c0cf3c64cf
WS03_SHA=d634870bbcd2c541695516643d34e0ac119354d7
WS04_SHA=32616b1b7ccbdc3de41c0949f182a65e03450d18
WS05_SHA=0537c481383a69c534799b43810f35e7279c5578
WS09_SHA=d8dd7e61fc5715d9a47ccfec695ee8e437e28067
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

Static publication uses WS12 + WS38 and the exact passing WS10 client. Order:

1. immutable client files under `/client-content/v1/<contentVersion>/`;
2. `manifest.json`;
3. remote verification;
4. `_complete.json`;
5. verification;
6. `latest.json` last;
7. WS12 strict publication preflight.

Required MIME contract:

```text
KnightOnLine.js   -> text/javascript; charset=utf-8
KnightOnLine.wasm -> application/wasm
KnightOnLine.data -> application/octet-stream
```

The WS12 browser launcher now retries public WSS readiness, uses a 12-second probe timeout, and does not hard-block OYNA on a browser-only probe false negative when both same-origin gateway health endpoints are actually healthy. The real client still performs the authoritative WSS connection.

## WS09 dispatch values

Use the exact WS09 publisher revision frozen above, or a descendant changing only WS09 request/status/runbook metadata.

```text
ws10_run_id=38505039290
ws10_head_sha=f0cadfb50b5d1a36d2bfe4e5bf0a68f7c3061f41
ws10_pass_artifact_name=ws10-moradon-e2e-26
ws10_client_artifact_name=ws10-moradon-passing-client-26
ws01_sha=25c2fcd9c59e8f7a704f7d2ac0d5c331d0042ff9
ws02_sha=1738f60945b24e00bdd2266e6600b5c0cf3c64cf
ws03_sha=d634870bbcd2c541695516643d34e0ac119354d7
ws12_sha=121bb7bdb82c364bf9459111096f5ff007873a61
ws14_sha=82cdcef40bed265ff4c4ce0fb7c8f6ad8cf2f52b
ws38_sha=5f323f3cf055ba7f96d928605a2f2faf84e609cb
keepalive_minutes=30
```

`ws50_handoff_ref` is the exact commit containing this READY file and is supplied to WS09 after this update commit is created.

WS09 may expose `TEST_LINK=https://<temporary-host>/play-shell/` only after its actual public smoke gates pass, including `/healthz`, launcher/publication identity, gateway health, WebSocket 101 upgrades on `/auth` and `/game`, and WS12 strict content verification.

```text
DECISION=READY
BLOCKER_OWNER=NONE
PUBLIC_TEST_LINK=READY_FOR_WS09_EPHEMERAL_PUBLISHER
```
