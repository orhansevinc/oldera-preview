WS09

# Dependency Snapshot — Ephemeral HTTPS/WSS Test Link

## SELF

- Workstream: `WS09`
- Branch: `ws09-production-infra`
- Current publisher implementation: `d952f5b5cb2987edbf8849c54bb673f911d1235e`.
- Validation: `WS09 deployment config` run #31 / `38504474693` — **SUCCESS**.
- Owned surfaces used: `infra/**`, `deploy/**`, `workstreams/ws09/**`, `.github/workflows/ws09-*.yml`, existing `docker-compose.ws09-staging.yml`.
- No provider/game/client implementation was modified.

## UPSTREAM

### WS01 — browser WSS transport

- Frozen by current WS50 pending handoff as `25c2fcd9c59e8f7a704f7d2ac0d5c331d0042ff9`.
- Public browser transport is same-origin `/auth` and `/game`; legacy TCP ports remain backend-only.

### WS10 — real Moradon acceptance + frozen passing client

- Latest observed attempt: `WS10 Moradon E2E Integration Gate` run #25, run id `38503397843`, head `419d52b363a73c8ab77ff8ad944a30968fda967d` — still `in_progress` at this snapshot.
- Previous run #24 (`38501204665`, head `b11929915d881e046ff50aa34695c9da70a5480a`) failed and is ineligible for publication.
- The publisher requires one exact **completed successful** WS10 run, exact head SHA, explicit Moradon PASS evidence artifact, and exact frozen client artifact containing one non-empty `KnightOnLine.js`, `KnightOnLine.wasm`, and `KnightOnLine.data`.
- Stale/failed runs or artifacts fail closed before public publication.

### WS12 — browser launcher / strict publication preflight

- Frozen by current WS50 pending handoff as `77f55b2949844e0fdd279526dab0fba4e8ab4f94`.
- WS09 runs that exact launcher config check and launcher-core publication preflight.
- Required same-origin endpoints are `/auth` and `/game`.
- The public preflight verifies WS38 pointer/manifest/marker identity, required-file bodies/hashes, strict MIME, and launchable HTML entry.

### WS38 — immutable client publication

- Frozen by current WS50 pending handoff as `5f323f3cf055ba7f96d928605a2f2faf84e609cb`.
- Exact content contract consumed:
  - `KnightOnLine.js` -> `text/javascript; charset=utf-8`
  - `KnightOnLine.wasm` -> `application/wasm`
  - `KnightOnLine.data` -> `application/octet-stream`
- Publication order: immutable files -> manifest -> verify -> `_complete` -> verify -> `latest.json` last.

### WS50 — staging integration handoff

- Current branch head checked: `ws50-integration-rehearsal@8c4c1c71e3f7ecff2d4eb49240a813a4928e1bf7`.
- `integration-rehearsal/STAGING_LINK_HANDOFF.md` now exists and declares **`STAGING LINK CANDIDATE: READY_PENDING_WS10`**.
- Exact WS10 release fields remain `REQUIRED`; the handoff explicitly says the single remaining blocker is WS10.
- Frozen provider set relevant to WS09:
  - WS01 `25c2fcd9c59e8f7a704f7d2ac0d5c331d0042ff9`
  - WS02 `1738f60945b24e00bdd2266e6600b5c0cf3c64cf`
  - WS03 `d634870bbcd2c541695516643d34e0ac119354d7`
  - WS12 `77f55b2949844e0fdd279526dab0fba4e8ab4f94`
  - WS14 `82cdcef40bed265ff4c4ce0fb7c8f6ad8cf2f52b`
  - WS38 `5f323f3cf055ba7f96d928605a2f2faf84e609cb`
- That pending handoff froze WS09 at `bac4f9d1338e385c8aff3989becaa8ed74037b38`, but WS09 intentionally moved afterward to complete the publisher. Therefore the final WS50 `READY` handoff must re-freeze WS09 at a revision containing the current publisher.
- The WS09 workflow now enforces this: it parses `WS09_SHA` from the exact handoff and rejects the release if any publisher/infra code changed after that frozen SHA. Docs/status/request-only commits may follow without invalidating the publisher freeze.

## EPHEMERAL PUBLISHER CONTRACT

Workflow: `.github/workflows/ws09-ephemeral-staging.yml`

Branch-native activation path, with no main merge required:

1. copy `workstreams/ws09/EPHEMERAL_REQUEST.example.json` to `workstreams/ws09/EPHEMERAL_REQUEST.json`;
2. fill it only with exact WS10 PASS/run/artifact values and the final WS50 READY handoff/frozen SHAs;
3. commit/push that request to `ws09-production-infra`;
4. the publisher starts automatically on that branch.

The publisher then:

1. verifies exact WS10 successful run identity and exact live artifacts through GitHub Actions metadata;
2. verifies exact WS50 `READY` handoff, all frozen upstream identities, and a non-stale WS09 publisher freeze;
3. downloads the frozen passing client without rebuilding provider/client code;
4. materializes exact provider slices into a disposable runner composition;
5. stages the client with exact WS38 tools/order;
6. builds WS02 gateway and integrated WS03+WS14 runtime images from exact frozen SHAs;
7. creates a temporary HTTPS/WSS `*.trycloudflare.com` origin using pinned `cloudflared 2026.10.0` with verified linux-amd64 SHA-256;
8. boots the existing WS09 same-origin edge with `/play-shell/`, `/auth`, `/game`;
9. runs public HTTPS/WS38/MIME/cache/WSS smoke plus exact WS12 full publication preflight;
10. emits `TEST_LINK=https://<temporary-host>/play-shell/` only after every gate passes, then keeps the process alive for a bounded 5–45 minute window.

Public edge smoke intentionally uses HEAD for large immutable files. Exact WS12 preflight performs the full required-file body/hash verification once, avoiding a redundant ~587 MB-class download through the temporary tunnel.

## CURRENT DECISION

- `EPHEMERAL STAGING PIPELINE`: **READY**.
- `EPHEMERAL TEST LINK`: **NOT LIVE / NOT CLAIMED**.
- Current blockers are release inputs, not WS09 implementation: WS10 run #25 has not produced an exact PASS yet, and WS50 remains `READY_PENDING_WS10`; the final WS50 READY revision must also re-freeze the completed WS09 publisher.
- No production domain, DNS, production certificate, repository secret, or main merge is required for the branch-native publication path.

## BOUNDARIES

- No merge to `main`.
- No force push.
- No provider/client/game implementation change.
- No fake client or stale PASS/handoff accepted.
- No production DNS/certificate change.

## LAST_SYNC

Checked on 2026-10-14 against current `main` test-link coordination and current WS01/WS10/WS12/WS38/WS50 staging evidence.
