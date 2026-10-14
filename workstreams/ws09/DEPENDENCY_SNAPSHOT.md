WS09

# Dependency Snapshot — Staging MIME Contract Finalization

## SELF

- Workstream: `WS09`
- Branch: `ws09-production-infra`
- Implementation head validated in this control session: `834f913c29d9678215fa00d9817ae79b12b7af2c`
- Owned surfaces changed: `infra/nginx/**`, `deploy/**`, `.github/workflows/ws09-deploy.yml`, `workstreams/ws09/**`.
- No provider/product/client/game source changed.

## UPSTREAM

### WS12 — browser launcher / strict publication preflight

- Branch/head checked: `ws12-browser-launcher@77f55b2949844e0fdd279526dab0fba4e8ab4f94`.
- Evidence read: `workstreams/ws12/STATUS.md`, `workstreams/ws12/INTEGRATION_PATCH.md`.
- Contract consumed: WS12 strict content validation compares the actual response Content-Type to WS38's manifest-declared value and must fail closed on mismatch.
- Required WS09 response for the real loader: `text/javascript; charset=utf-8`.

### WS38 — client content publication / MIME contract

- Branch/head checked: `ws38-client-content-pipeline@5f323f3cf055ba7f96d928605a2f2faf84e609cb`.
- Evidence read: `workstreams/ws38/STATUS.md`, `content-pipeline/oldko1298.profile.json`.
- Exact contract consumed:
  - `KnightOnLine.js` -> `text/javascript; charset=utf-8`
  - `KnightOnLine.wasm` -> `application/wasm`
  - `KnightOnLine.data` -> `application/octet-stream`
- Publication/cache sequencing remains WS38-owned and unchanged.

### WS50 — integration rehearsal / staging evidence

- Current branch head checked: `ws50-integration-rehearsal@94715058fdedc0a4fbab3a5f5c2ab29602fe747b`.
- Evidence read: `workstreams/ws50/STATUS.md`, `integration-rehearsal/STAGING_CANDIDATE.md`.
- WS50 independently recorded the previous WS09 `.js/.mjs = application/javascript` mapping as incompatible with WS12 strict WS38 validation.
- WS50's separate browser-native public-WSS/path-routing blocker remains outside WS09 ownership.

## DOWNSTREAM

- WS12 strict staging/publication preflight consumes the Content-Type emitted by the WS09 edge.
- WS50/integration owners can now rehearse WS09 without the prior JS MIME mismatch.
- WS10 / Ana Kontrol Hattı may consume the staging edge after their separate browser/Moradon gates are satisfied.

## CONTRACTS

Current WS09 static MIME contract:

```text
.js   -> text/javascript; charset=utf-8
.mjs  -> text/javascript; charset=utf-8
.wasm -> application/wasm
.data -> application/octet-stream
```

Regression enforcement:

- `deploy/verify-config.sh` statically rejects a return to `application/javascript` for `js`/`mjs` and checks charset handling.
- `deploy/staging-smoke.sh` performs exact full-header comparison compatible with WS12 `strictContentType` semantics.
- `.github/workflows/ws09-deploy.yml` runs a real Nginx staging smoke for `.js`, synthetic `.mjs`, `.wasm`, and `.data`.

## VERIFICATION

GitHub Actions implementation run:

- workflow run: `38496243278`
- job: `115632531458`
- head: `834f913c29d9678215fa00d9817ae79b12b7af2c`
- result: SUCCESS
- strict staging MIME smoke: SUCCESS

## BLOCKERS

- **WS09 staging MIME contract blocker:** none.
- Separate project/public-staging gates remain outside this inbox task: WS50's browser-native WSS/path-routing finding and the project-level current Moradon E2E acceptance state.
- No production domain/DNS/certificate change is required or authorized by this task.

## LAST_SYNC

Checked on 2026-10-14 against current `main` coordination files and the WS12/WS38/WS50 staging evidence listed above.
