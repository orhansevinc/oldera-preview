WS09

# STATUS — Ephemeral HTTPS/WSS Test-Link Publisher

## Decision

**EPHEMERAL STAGING PIPELINE: READY**

**EPHEMERAL TEST LINK: NOT LIVE — WAITING FOR EXACT WS10 PASS + FINAL WS50 READY HANDOFF**

Branch: `ws09-production-infra`
Publisher implementation validated at: `d952f5b5cb2987edbf8849c54bb673f911d1235e`.
Validation: `WS09 deployment config` run #31, run id `38504474693` — **SUCCESS**.

This is the existing WS09 control session. No new workstream was created.

## Implemented

### Fail-closed ephemeral publisher

`.github/workflows/ws09-ephemeral-staging.yml` accepts exact release identities only:

- successful WS10 Moradon E2E run id + exact head SHA;
- explicit WS10 PASS evidence artifact;
- exact frozen passing client artifact;
- exact WS50 commit containing `integration-rehearsal/STAGING_LINK_HANDOFF.md`;
- exact WS01/WS02/WS03/WS12/WS14/WS38 SHAs frozen by that handoff;
- bounded keepalive duration, 5–45 minutes.

It fails before publication if WS10 is not a completed `success`, an artifact is absent/stale, the handoff is still `READY_PENDING_WS10`, any frozen identity differs, or the handoff froze an older WS09 publisher than the code being executed.

### WS09 self-freeze validation

The exact WS50 handoff must contain `WS09_SHA=<40-char-sha>`. The workflow requires that SHA to be an ancestor of the running WS09 revision and rejects the release if publisher/infra code changed after it. Only WS09 status/dependency/runbook/request-file commits are allowed after the frozen publisher SHA.

This prevents the current pending WS50 handoff, which froze WS09 at `bac4f9d1338e385c8aff3989becaa8ed74037b38`, from being reused after WS09 intentionally completed more publisher code. The final WS50 READY handoff must re-freeze the completed publisher.

### Branch-native trigger — no main merge required

`workstreams/ws09/EPHEMERAL_REQUEST.example.json` defines the operational request schema. After exact WS10 PASS + final WS50 READY exist, create `workstreams/ws09/EPHEMERAL_REQUEST.json` with those exact values and push it to `ws09-production-infra`. The workflow watches that exact path and starts on the branch itself.

`workflow_dispatch` inputs are also retained for environments where GitHub exposes the workflow through manual dispatch from the default branch.

### Exact passing client; no provider rebuild

The publisher downloads the exact frozen WS10 `KnightOnLine.js`, `KnightOnLine.wasm`, and `KnightOnLine.data`. It does **not** rebuild or modify the passing client/provider code.

Provider slices are materialized from exact WS50-frozen commits into a disposable runner composition. WS02 is built as the WebSocket gateway; WS03 + WS14 are assembled into the existing integrated session/world topology expected by `docker-compose.ws09-staging.yml`.

### WS38 publication order

The frozen client is staged with the exact frozen WS38 tools in this order:

`immutable files -> manifest -> verify -> _complete -> verify -> latest.json last`

Strict MIME remains:

```text
.js/.mjs -> text/javascript; charset=utf-8
.wasm    -> application/wasm
.data    -> application/octet-stream
```

### Temporary HTTPS/WSS edge

The job downloads pinned `cloudflared 2026.10.0` linux-amd64 and verifies its SHA-256 before use. It opens a Cloudflare Quick Tunnel to the existing WS09 staging Nginx edge.

One temporary origin serves:

- `https://<temporary-host>/play-shell/`
- `wss://<temporary-host>/auth`
- `wss://<temporary-host>/game`

No `oldkoweb.com` purchase, production DNS, production certificate, repository secret, or main merge is required by this path.

### Public acceptance gates

`deploy/ephemeral-public-smoke.mjs` verifies over the actual temporary origin:

- `/healthz`;
- `/play-shell/` and launcher config;
- `latest.json`, manifest identity/hash, `_complete` marker;
- required immutable files have exact MIME/size/cache contract;
- auth/game gateway health;
- real WebSocket HTTP `101` upgrades on `/auth` and `/game` with the public HTTPS Origin.

Then the exact frozen WS12 launcher core runs full publication preflight, including required-file body/hash and strict MIME verification. The large client bodies are downloaded and hashed only once through the public tunnel; the edge smoke uses HEAD for those same large files.

Only after every gate passes does the job print:

`TEST_LINK=https://<temporary-host>/play-shell/`

The URL is ephemeral and stays live only while the workflow process remains alive for the requested bounded keepalive window.

## Verification

Latest code validation:

- workflow: `WS09 deployment config`
- run number: `31`
- run id: `38504474693`
- implementation head: `d952f5b5cb2987edbf8849c54bb673f911d1235e`
- conclusion: **SUCCESS**

Passing coverage includes static WS09 validation, fail-closed publisher-contract checks, production/staging Compose validation, Nginx local/staging/production syntax, and real staging WS38/WS12 strict MIME smoke.

## Current upstream state

- WS50 head: `8c4c1c71e3f7ecff2d4eb49240a813a4928e1bf7`.
- WS50 handoff now exists but is **`STAGING LINK CANDIDATE: READY_PENDING_WS10`**; its four exact WS10 release fields are still `REQUIRED`.
- That pending handoff froze WS09 before the final publisher changes, so its future `READY` revision must also re-freeze the completed WS09 publisher.
- WS10 run #25 (`38503397843`, head `419d52b363a73c8ab77ff8ad944a30968fda967d`) remains `in_progress` at this closure observation. Run #24 failed and is ineligible.

Therefore WS09 does **not** claim a live TEST_LINK. All WS09 implementation required to create one is ready; publication is deliberately blocked until exact successful WS10 PASS/client artifacts and a matching final WS50 READY handoff exist.

## Boundaries

- No merge to `main`.
- No force push.
- No new WS number.
- No provider/game/client implementation modified.
- No fake client or stale PASS/handoff accepted.
- No production DNS/certificate changed.
- No secret committed.

BU SOHBETE ARTIK GEREK VAR MI?: HAYIR
