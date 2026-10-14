WS09

# STATUS — Ephemeral HTTPS/WSS Test-Link Publisher

## Decision

**EPHEMERAL STAGING PIPELINE: READY**

**EPHEMERAL TEST LINK: NOT LIVE — WAITING FOR EXACT WS10 PASS + WS50 READY HANDOFF**

Branch: `ws09-production-infra`
Branch-native publisher implementation validated at: `75078d2d6f1251ac3e5b0160769de84088ff1d4e`.
Validation: `WS09 deployment config` run #27, run id `38504031520` — **SUCCESS**.

This is the existing WS09 control session. No new workstream was created.

## What is implemented

### Fail-closed ephemeral publisher

`.github/workflows/ws09-ephemeral-staging.yml` accepts exact release identities and refuses stale or incomplete inputs:

- successful WS10 Moradon E2E run id + exact head SHA;
- explicit WS10 PASS evidence artifact name;
- exact frozen passing client artifact name;
- exact WS50 commit containing `integration-rehearsal/STAGING_LINK_HANDOFF.md`;
- exact WS01/WS02/WS03/WS12/WS14/WS38 SHAs frozen by that handoff;
- bounded keepalive duration, 5–45 minutes.

It fails before publication if any identity is stale/missing/mismatched, if WS10 did not complete with `conclusion=success`, or if WS50 is still `READY_PENDING_WS10`.

### Branch-native trigger — no main merge required

`workstreams/ws09/EPHEMERAL_REQUEST.example.json` defines the exact operational request schema.

When WS10 PASS + WS50 READY arrive, copy/fill it as `workstreams/ws09/EPHEMERAL_REQUEST.json` and push that file to `ws09-production-infra`. The publisher watches that exact path and starts on the branch itself, so production-domain work and a main merge are not prerequisites for the test link.

`workflow_dispatch` inputs remain available for environments where GitHub exposes this workflow through manual dispatch from the repository default branch.

### Exact passing client, no provider rebuild

The publisher downloads the exact frozen WS10 `KnightOnLine.js`, `KnightOnLine.wasm`, and `KnightOnLine.data`. It does **not** rebuild or modify the passing client/provider code.

Provider slices are materialized from exact WS50-frozen commits into a disposable runner composition. WS02 is built as the WebSocket gateway; WS03 + WS14 are assembled into the existing integrated session/world topology expected by `docker-compose.ws09-staging.yml`.

### WS38 publication order

The frozen client is staged using the exact WS38 tools from the handoff SHA, in this order:

`immutable files -> manifest -> verify -> _complete -> verify -> latest.json last`

Strict MIME remains:

```text
.js/.mjs -> text/javascript; charset=utf-8
.wasm    -> application/wasm
.data    -> application/octet-stream
```

### Temporary HTTPS/WSS edge

The job downloads pinned `cloudflared 2026.10.0` linux-amd64 and verifies its SHA-256 before use. It opens a Cloudflare Quick Tunnel to the existing WS09 staging Nginx edge.

One temporary HTTPS origin serves:

- `https://<temporary-host>/play-shell/`
- `wss://<temporary-host>/auth`
- `wss://<temporary-host>/game`

No `oldkoweb.com` purchase, production DNS, production certificate, repository secret, or main merge is required by the branch-native path.

### Public acceptance gates

`deploy/ephemeral-public-smoke.mjs` verifies over the actual temporary origin:

- `/healthz`;
- `/play-shell/` and staging launcher config;
- `latest.json`, manifest identity/hash, `_complete` marker;
- required immutable files are public with exact MIME/size/cache contract;
- auth/game gateway health;
- real WebSocket HTTP `101` upgrades on `/auth` and `/game` with the public HTTPS Origin.

After that, the exact WS12 launcher core from the frozen WS12 SHA runs full publication preflight, including required-file body/hash and strict MIME verification. The large client bodies are therefore downloaded and hashed only once through the public tunnel; the edge smoke uses HEAD for the same large files.

Only after all gates pass does the job print:

`TEST_LINK=https://<temporary-host>/play-shell/`

The link is ephemeral and lives only while the workflow process stays alive for the requested bounded keepalive window.

## Reproducibility

`workstreams/ws09/RUNBOOK.md` documents both the branch-native request-file trigger and optional manual dispatch.

`workstreams/ws09/DEPENDENCY_SNAPSHOT.md` records the current upstream state and exact acceptance boundaries.

## Verification

GitHub Actions validated the branch-native publisher implementation:

- workflow: `WS09 deployment config`
- run number: `27`
- run id: `38504031520`
- implementation head: `75078d2d6f1251ac3e5b0160769de84088ff1d4e`
- conclusion: **SUCCESS**

Passing coverage includes:

- static WS09 config validation;
- ephemeral publisher fail-closed contract assertions;
- production compose validation;
- staging compose validation;
- Nginx local/staging/production template syntax;
- real staging WS38/WS12 strict MIME smoke.

## Current upstream state at closure

- WS01 current checked head: `25c2fcd9c59e8f7a704f7d2ac0d5c331d0042ff9`; public WSS transport is ready.
- WS12 current checked head: `77f55b2949844e0fdd279526dab0fba4e8ab4f94`.
- WS38 current checked head: `5f323f3cf055ba7f96d928605a2f2faf84e609cb`.
- WS50 current checked head: `bfedd39a085494f229f6d602b4bb427ce4bbc288`; `integration-rehearsal/STAGING_LINK_HANDOFF.md` is not present at the closure observation point.
- WS10 run #25 (`38503397843`, head `419d52b363a73c8ab77ff8ad944a30968fda967d`) is still `in_progress` at the closure observation point. Previous run #24 failed and is explicitly ineligible for publication.

Therefore WS09 does **not** claim a live TEST_LINK yet. The pipeline is ready to publish as soon as WS10 supplies the exact successful PASS/frozen-client artifact and WS50 supplies the matching READY handoff.

## Boundaries

- No merge to `main`.
- No force push.
- No new WS number.
- No provider/game/client implementation modified.
- No fake client or stale PASS artifact accepted.
- No production DNS/certificate changed.
- No secret committed.

BU SOHBETE ARTIK GEREK VAR MI?: HAYIR
