# WS50 — STAGING LINK HANDOFF

## Release decision

**STAGING LINK CANDIDATE: READY_PENDING_WS10**

This is the single handoff from WS50 to WS09 for the temporary public HTTPS/WSS test link. The source/staging composition is validated. Publication is intentionally fail-closed because an exact successful WS10 Moradon artifact does not yet exist at this handoff revision.

**Single remaining blocker owner: WS10.**

Do not dispatch the WS09 ephemeral publisher while this file contains `READY_PENDING_WS10`. The WS09 workflow also enforces this rule itself.

## Exact WS09 dispatch fields

The following four values are the only missing release inputs. They must come from one exact completed **successful** `WS10 Moradon E2E Integration Gate` run and must not be guessed:

```text
WS10_PASS_RUN_ID=REQUIRED
WS10_PASS_HEAD_SHA=REQUIRED
WS10_PASS_ARTIFACT_NAME=REQUIRED
WS10_CLIENT_ARTIFACT_NAME=REQUIRED
```

After WS10 PASS, update this same handoff to `STAGING LINK CANDIDATE: READY` and replace every `REQUIRED` value above with the exact run/artifact identity. Do not create another workstream and do not rebuild the client.

At handoff preparation time the latest WS10 attempt is:

```text
WS10_CURRENT_RUN_ID=38503397843
WS10_CURRENT_HEAD_SHA=419d52b363a73c8ab77ff8ad944a30968fda967d
WS10_CURRENT_RUN_NUMBER=25
WS10_CURRENT_STATE=IN_PROGRESS
```

The latest completed run before it, run `38501204665` / #24, is a failure and is **not** eligible for publication.

## Frozen provider set

The exact source candidate proven by WS50 Actions run `38503488408`, staging job `115655569968`, is:

```text
MAIN_SHA=5715c55abd9ecb36bb32a259d045ba9ad1dc9551
BROWSER_BASELINE_SHA=18282d0e70de7ccb30244a9f09e2b3bff3040155
WS01_SHA=25c2fcd9c59e8f7a704f7d2ac0d5c331d0042ff9
WS02_SHA=1738f60945b24e00bdd2266e6600b5c0cf3c64cf
WS03_SHA=d634870bbcd2c541695516643d34e0ac119354d7
WS04_SHA=32616b1b7ccbdc3de41c0949f182a65e03450d18
WS05_SHA=0537c481383a69c534799b43810f35e7279c5578
WS09_SHA=bac4f9d1338e385c8aff3989becaa8ed74037b38
WS10_SNAPSHOT_SHA=419d52b363a73c8ab77ff8ad944a30968fda967d
WS11_SHA=05562662d9d3f13a4b0500d0478e065fd802cfd0
WS12_SHA=77f55b2949844e0fdd279526dab0fba4e8ab4f94
WS14_SHA=82cdcef40bed265ff4c4ce0fb7c8f6ad8cf2f52b
WS38_SHA=5f323f3cf055ba7f96d928605a2f2faf84e609cb
WS45_SHA=4a66338743553c2781c68ca84b866ff4e999c14e
OPENKO_SHA=97eb0ea20207afc0c360bfed6915113572711be3
KO_ASSETS_SHA=2055ee6ed77f1b5cfef23832dd5bc31909e14a66
EMSCRIPTEN_VERSION=6.0.12
CANDIDATE_TREE_SHA=300d7e41dfb7ca84baaef0db2cef8c8a9cc1cdd6
WS50_STAGING_RUN_ID=38503488408
WS50_STAGING_ARTIFACT_NAME=ws50-staging-candidate
WS50_STAGING_ARTIFACT_ID=11866703844
WS50_STAGING_ARTIFACT_SHA256=f6780a3ab98b5576727a420aa7c4dfaf9249221dd19e119dac6b44d9d6fadd1c
```

The WS50 run re-fetched every provider ref at the end and confirmed exact equality with the start snapshot.

`WS50_HANDOFF_REF` is the exact commit containing the final READY version of this file and is supplied to WS09 at dispatch time. The current pending file must not be used as a release ref.

## Client artifact rule — no rebuild

Once WS10 PASS exists, WS09 must download the exact PASS/client artifact(s) from `WS10_PASS_RUN_ID`. The client artifact must contain exactly one non-empty copy of each:

```text
KnightOnLine.js
KnightOnLine.wasm
KnightOnLine.data
```

Those three files are the passing build. WS50 and WS09 must not rebuild or substitute them after PASS.

If that WS10 artifact contains exactly one `index.html`, use it. Otherwise use the frozen WS01 `openko-web/index.html` as the package index, matching the current WS09 publisher contract.

## Static launcher and immutable publication

Expected public launcher entry:

```text
https://<temporary-host>/play-shell/
```

Expected same-origin browser routes:

```text
wss://<temporary-host>/auth
wss://<temporary-host>/game
```

WS12/WS38/WS09 publication order is fixed:

1. copy immutable client files to `/client-content/v1/<contentVersion>/`;
2. create `manifest.json`;
3. verify immutable files against the manifest;
4. create `_complete.json`;
5. verify again requiring the publication marker;
6. write `/latest.json` **last**;
7. run WS12 strict publication preflight.

Required edge MIME contract:

```text
KnightOnLine.js   -> text/javascript; charset=utf-8
KnightOnLine.wasm -> application/wasm
KnightOnLine.data -> application/octet-stream
```

`latest.json` must be `no-store`; versioned client files must be immutable-cacheable.

## Backend/session/world composition

The proven source candidate uses:

```text
WS02 gateway: packet-agnostic WebSocket <-> TCP
WS03 session: auth/game protocol entry
WS14 world: loaded by WS03 through ../ko1298-world
WS45: session-ownership contract validated in the candidate
```

The current WS09 ephemeral publisher materializes/builds the WS03+WS14 runtime image and separate WS02 gateway images. Its public route contract is:

```text
/auth -> auth gateway -> session-world:15100
/game -> game gateway -> session-world:15001
```

WS50 run 22 proved the integrated session/world auth and game TCP listeners are reachable and proved the exact WS09 staging compose renders successfully.

## One-shot WS09 publication/smoke recipe

Run the WS09 ephemeral workflow from the exact validated WS09 publisher revision (or re-freeze WS50 if WS09 has intentionally moved). Supply:

```text
ws10_run_id              = WS10_PASS_RUN_ID
ws10_head_sha             = WS10_PASS_HEAD_SHA
ws10_pass_artifact_name   = WS10_PASS_ARTIFACT_NAME
ws10_client_artifact_name = WS10_CLIENT_ARTIFACT_NAME
ws50_handoff_ref          = exact commit containing READY handoff
ws01_sha                  = 25c2fcd9c59e8f7a704f7d2ac0d5c331d0042ff9
ws02_sha                  = 1738f60945b24e00bdd2266e6600b5c0cf3c64cf
ws03_sha                  = d634870bbcd2c541695516643d34e0ac119354d7
ws12_sha                  = 77f55b2949844e0fdd279526dab0fba4e8ab4f94
ws14_sha                  = 82cdcef40bed265ff4c4ce0fb7c8f6ad8cf2f52b
ws38_sha                  = 5f323f3cf055ba7f96d928605a2f2faf84e609cb
keepalive_minutes         = 30
```

The publisher must fail closed unless the exact WS10 run is completed/successful, the named artifacts are live, and the READY WS50 handoff contains all supplied identities.

Before the URL is shared, require all one-shot public smoke checks:

- `/healthz` succeeds;
- `/play-shell/` loads and launcher config contains same-origin `/auth` + `/game`;
- `/latest.json` is no-store and cryptographically binds the manifest;
- `_complete.json` identity matches the manifest;
- every required immutable file has exact MIME, length and immutable cache policy;
- `/gateway-auth-healthz` and `/gateway-game-healthz` succeed;
- WebSocket upgrades on `/auth` and `/game` return HTTP `101`;
- WS12 strict preflight performs the full required-file download/hash validation once;
- the real browser path reaches login -> server list -> version 1298 -> nation/create -> character select -> Moradon and the required WS10 visual/world markers.

Only after all gates pass may WS09 expose the generated temporary URL as the real `TEST_LINK`.

## Current handoff state

The staging recipe, provider freeze, source candidate, backend composition, WSS routes, launcher publication order and one-shot WS09 smoke contract are complete.

The only missing input is the exact WS10 passing run/artifact identity. Until it exists:

```text
PUBLIC_TEST_LINK=NOT_RELEASED
BLOCKER_OWNER=WS10
DECISION=READY_PENDING_WS10
```
