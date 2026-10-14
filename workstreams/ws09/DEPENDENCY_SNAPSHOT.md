WS09

# Dependency Snapshot — Ephemeral HTTPS/WSS Test Link

## SELF

- Workstream: `WS09`
- Branch: `ws09-production-infra`
- Ephemeral publisher implementation head before this snapshot: `4e7c16ac7979b1a0c768f542cc7941f96172e7fb`
- Owned surfaces used: `infra/**`, `deploy/**`, `workstreams/ws09/**`, `.github/workflows/ws09-*.yml`, existing `docker-compose.ws09-staging.yml`.
- No provider/game/client implementation was modified.

## UPSTREAM

### WS01 — browser WSS transport

- Current branch head checked: `ws01-runtime-build@25c2fcd9c59e8f7a704f7d2ac0d5c331d0042ff9`.
- Its public-WSS control closes the browser transport contract: auth uses same-origin `/auth`, game uses same-origin `/game`, while legacy TCP ports remain backend-only.
- WS09 consumes the exact WS01 SHA frozen by the future WS50 handoff; WS09 does not rewrite WS01 transport/provider code.

### WS10 — real Moradon acceptance + frozen passing client

- Latest observed run while this snapshot was written: `WS10 Moradon E2E Integration Gate` run #25, run id `38503397843`, head `419d52b363a73c8ab77ff8ad944a30968fda967d`, still `in_progress` at the observation point.
- Previous run #24 (`38501204665`, head `b11929915d881e046ff50aa34695c9da70a5480a`) completed with `failure`; its artifact must not be used as a PASS release.
- Ephemeral publisher requires an exact **completed successful** WS10 Moradon E2E run, exact head SHA, explicit PASS evidence artifact, and exact frozen client artifact containing one non-empty `KnightOnLine.js`, `.wasm`, and `.data`.
- Stale/failed runs or artifacts fail closed before any public publication.

### WS12 — browser launcher / strict publication preflight

- Current branch head checked: `ws12-browser-launcher@77f55b2949844e0fdd279526dab0fba4e8ab4f94`.
- WS09 materializes the exact WS12 SHA from the WS50 handoff and runs its own `check-config.cjs` plus its exact launcher-core publication preflight.
- Required same-origin endpoints are `/auth` and `/game`.
- The public preflight verifies WS38 pointer/manifest/marker identity, required-file bytes/hashes, strict MIME, and launchable HTML entry.

### WS38 — immutable client publication

- Current branch head checked: `ws38-client-content-pipeline@5f323f3cf055ba7f96d928605a2f2faf84e609cb`.
- Exact content contract consumed:
  - `KnightOnLine.js` -> `text/javascript; charset=utf-8`
  - `KnightOnLine.wasm` -> `application/wasm`
  - `KnightOnLine.data` -> `application/octet-stream`
- Publisher sequence is fail closed and ordered: immutable files -> manifest -> verify -> `_complete` -> verify -> `latest.json` last.

### WS50 — staging integration handoff

- Current branch head checked: `ws50-integration-rehearsal@bfedd39a085494f229f6d602b4bb427ce4bbc288`.
- At this observation point `integration-rehearsal/STAGING_LINK_HANDOFF.md` is not present yet.
- WS09 will accept only an exact WS50 commit containing that handoff with `STAGING LINK CANDIDATE: READY`; `READY_PENDING_WS10` is rejected.
- The handoff must contain the same WS10 run/head/artifact identities and exact WS01/WS02/WS03/WS12/WS14/WS38 SHAs supplied to the publisher.

## EPHEMERAL PUBLISHER CONTRACT

Workflow: `.github/workflows/ws09-ephemeral-staging.yml`

The workflow:

1. verifies exact WS10 successful run identity and exact live artifacts through GitHub Actions metadata;
2. verifies exact WS50 READY handoff and all frozen identities;
3. downloads the frozen passing client without rebuilding provider/client code;
4. materializes exact provider slices into a disposable runner composition;
5. publishes the client with exact WS38 tools/order;
6. builds WS02 gateway and integrated WS03+WS14 runtime images from exact frozen SHAs;
7. creates a temporary HTTPS/WSS `*.trycloudflare.com` origin using pinned `cloudflared 2026.10.0` with verified linux-amd64 SHA-256;
8. boots existing WS09 same-origin edge with `/play-shell/`, `/auth`, `/game`;
9. runs public HTTPS/WS38/MIME/cache/WSS smoke plus exact WS12 full publication preflight;
10. emits `TEST_LINK=https://<temporary-host>/play-shell/` only after every gate passes, then keeps the process alive for a bounded 5–45 minute window.

Public edge smoke intentionally uses HEAD for large immutable files. Exact WS12 preflight performs the full required-file body/hash verification once, avoiding a redundant ~587 MB class download through the temporary tunnel.

## CURRENT DECISION

- `EPHEMERAL STAGING PIPELINE`: implementation ready, validation finishing on WS09 Actions.
- `EPHEMERAL TEST LINK`: **NOT LIVE / NOT CLAIMED** because an exact successful WS10 PASS artifact and exact WS50 READY handoff are not both available at this snapshot point.
- No production domain, DNS, production certificate, or repository secret is required by this path.

## BOUNDARIES

- No merge to `main`.
- No force push.
- No provider/client/game implementation change.
- No fake client or stale PASS artifact accepted.
- No production DNS/certificate change.

## LAST_SYNC

Checked on 2026-10-14 against current `main` test-link coordination, WS01/WS10/WS12/WS38/WS50 staging evidence, and current provider branch heads listed above.
