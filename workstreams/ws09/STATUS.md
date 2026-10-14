WS09

# STATUS — Staging MIME Contract Finalization

## Decision

**STAGING MIME CONTRACT: READY**

Branch: `ws09-production-infra`
Implementation head validated before this closing status: `834f913c29d9678215fa00d9817ae79b12b7af2c`.
Closing commit is the branch HEAD containing this status; the exact SHA is reported in the control-session closure message.

This control session is only the deployment-contract repair requested by `coordination/inbox/WS09.md`. It does not change provider/game/client code, production DNS, production certificates, or secrets.

## Evidence consumed

- `main`: `coordination/MASTER_CONTROL.md`, `BROADCAST.md`, `WORKSTREAM_REGISTRY.md`, `TASK_QUEUE.md`, `MORADON_CRITICAL_PATH.md`, and `coordination/inbox/WS09.md`.
- WS12 `ws12-browser-launcher@77f55b2949844e0fdd279526dab0fba4e8ab4f94`: strict WS38 publication preflight requires the response Content-Type to match the manifest declaration exactly; its handoff explicitly requests WS09 to serve JS as `text/javascript; charset=utf-8`.
- WS38 `ws38-client-content-pipeline@5f323f3cf055ba7f96d928605a2f2faf84e609cb`: `oldko1298.profile.json` declares:
  - `KnightOnLine.js` -> `text/javascript; charset=utf-8`
  - `KnightOnLine.wasm` -> `application/wasm`
  - `KnightOnLine.data` -> `application/octet-stream`
- WS50 current staging evidence branch head checked at `ws50-integration-rehearsal@94715058fdedc0a4fbab3a5f5c2ab29602fe747b`; its staging candidate report independently records the previous WS09 JS MIME mismatch as a deployment follow-up.

## Fix implemented

- `infra/nginx/mime.types`
  - changed `.js/.mjs` from `application/javascript` to `text/javascript`;
  - kept `.wasm = application/wasm`;
  - kept `.data = application/octet-stream`.
- `infra/nginx/nginx.conf`
  - enables `charset utf-8` for `text/javascript` so the emitted header is exactly `text/javascript; charset=utf-8`;
  - binary WASM/DATA media types are excluded from charset handling;
  - gzip recognizes `text/javascript` while retaining compatibility with `application/javascript` from unrelated upstream responses.
- `deploy/verify-config.sh`
  - requires the `text/javascript js mjs` mapping;
  - fails if legacy `application/javascript` owns `js` or `mjs` again;
  - requires UTF-8 charset handling for `text/javascript`;
  - keeps explicit WASM/DATA assertions.
- `deploy/staging-smoke.sh`
  - compares the complete response Content-Type, mirroring WS12 `strictContentType` behavior;
  - requires JS to be exactly `text/javascript; charset=utf-8`;
  - keeps exact WASM/DATA checks;
  - supports an optional synthetic `.mjs` fixture for CI regression coverage.
- `.github/workflows/ws09-deploy.yml`
  - adds real Nginx HTTP smoke coverage for `.js`, synthetic `.mjs`, `.wasm`, and `.data` through the staging template.

## Exact staging MIME contract

```text
.js   -> text/javascript; charset=utf-8
.mjs  -> text/javascript; charset=utf-8
.wasm -> application/wasm
.data -> application/octet-stream
```

This now matches the WS38 manifest contract consumed by WS12 strict publication validation.

## Verification actually run

GitHub Actions:

- workflow: `WS09 deployment config`
- run: `38496243278` (run 16)
- job: `validate` / `115632531458`
- implementation head: `834f913c29d9678215fa00d9817ae79b12b7af2c`
- result: **SUCCESS**

Passing steps include:

- static validation: PASS
- production compose validation: PASS
- staging compose validation: PASS
- Nginx local template syntax: PASS
- Nginx staging template syntax: PASS
- **Staging WS38 and WS12 strict MIME smoke: PASS**
- Nginx production template syntax: PASS

The MIME smoke exercises a real Nginx container and verifies the full HTTP Content-Type values for `.js`, `.mjs`, `.wasm`, and `.data`.

## Remaining gates outside this task

No WS09 MIME blocker remains.

This READY decision is intentionally narrow: it does not override WS50's separate public-staging blocker concerning browser-native WSS/path routing ownership, and it does not declare the project-level Moradon E2E gate passed. Those remain external acceptance/provider concerns, not permission for WS09 to modify provider code.

## Boundaries

- No merge to `main`.
- No force push.
- No other workstream branch modified.
- No application/provider/game/client implementation modified.
- No production domain/DNS/certificate changed.
- No secret added.

BU SOHBETE ARTIK GEREK VAR MI?: HAYIR
