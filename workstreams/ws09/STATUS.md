WS09

# STATUS — Public test / staging preparation

## Decision

**STAGING DEPLOY PREP: READY**

Branch: `ws09-production-infra`

This control session prepares the deployment path only. It does **not** claim a production cutover, a purchased domain, a production certificate, or a completed Moradon E2E PASS.

## What changed

The previous WS09 scaffold used stale pre-integration assumptions: one generic gateway and one session TCP target. Current provider evidence requires two WS02 gateway instances and WS03's separate AUTH/GAME TCP listeners, with WS14 composed behind WS03.

WS09 now provides:

- `docker-compose.ws09-staging.yml` — separate domain-free staging profile;
- `deploy/.env.staging.example` — non-secret local/public-test environment template;
- `infra/nginx/templates/staging.conf.template` — staging edge/reverse proxy;
- `deploy/staging-up.sh` — one-command bring-up after artifacts/images are supplied;
- `deploy/staging-smoke.sh` — edge/gateway/MIME smoke checks;
- `deploy/artifacts/staging-play/README.md` — exact static artifact layout;
- extended `deploy/verify-config.sh` and WS09 CI validation;
- `workstreams/ws09/DEPENDENCY_SNAPSHOT.md` with current provider heads/contracts.

No provider/product code, production DNS, production certificates, or secrets were changed.

## Staging topology

```text
browser
  |
  | HTTPS/WSS (public host/tunnel/LB terminates TLS)
  v
WS09 nginx staging edge
  |-- /play-shell/ + real WASM/static content
  |-- /auth  -> WS02 gateway-auth -> WS03 AUTH TCP :15100
  `-- /game  -> WS02 gateway-game -> WS03 GAME TCP :15001
                                      |
                                      `-> WS14 world provider in integrated image
```

Only the staging edge publishes a host port. AUTH/GAME TCP ports stay on the private compose network.

Browser-facing WebSocket contract:

```text
local smoke:  ws://localhost:8080/auth
local smoke:  ws://localhost:8080/game
public test:  wss://<temporary-staging-host>/auth
public test:  wss://<temporary-staging-host>/game
```

The gateway containers use the current WS02 deployment contract:

- `GATEWAY_MODE=auth|game`;
- `/auth` and `/game` WS paths;
- `/healthz` health path;
- exact `ALLOWED_ORIGINS` and `ALLOWED_HOSTS`;
- `REQUIRE_ORIGIN=true`;
- `TRUST_PROXY=true` with edge-provided Host / X-Forwarded-Host.

## Static client / launcher contract

Materialize approved provider artifacts into:

```text
deploy/artifacts/staging-play/
  play-shell/**
  real1298/index.html
  real1298/BUILD.txt
  real1298/KnightOnLine.js
  real1298/KnightOnLine.wasm
  real1298/KnightOnLine.data
```

For a public test, deployment may rewrite the staged `play-shell/config.json` artifact without changing WS12's provider branch:

- client/build/required-file URLs stay same-origin;
- set the launcher gateway reachability probe to `wss://<temporary-staging-host>/auth`;
- set `gateway.required=true` when launch must fail closed on unavailable transport;
- bump `cacheVersion` when the staged client package changes.

Important: WS12's gateway URL is a launcher reachability probe. It does not replace the real C++/WASM client's auth/game transport wiring. The client package used for publication must be the integrated browser build proven by WS10 and must use the exposed `/auth` and `/game` transport endpoints.

## MIME and cache policy

The staging edge keeps the WS38 contract:

- `.wasm`: `application/wasm`;
- `.data`: `application/octet-stream`;
- `client-content/v1/<contentVersion>/...`: `public, max-age=31536000, immutable`;
- `latest.json` / `rollback.json`: `no-store, max-age=0`;
- mutable inherited `real1298` staging JS/WASM/DATA: forced revalidation instead of one-year caching.

When the full WS38 versioned publication flow is used, publish immutable files first, then `manifest.json`, verify, publish `_complete.json` last, verify again, and only then advance `latest.json`.

## Exact publish steps after MORADON PASS

1. Require a **new WS10 `MORADON E2E: PASS`** using the corrected WS05 provider. The current WS10 report is run #16 and predates WS05's wire-zone-21/native-zone-210 fix, so it is not a release PASS.
2. Freeze the provider SHAs used by that passing run. Build/publish immutable image tags/digests for:
   - WS02 gateway -> `GATEWAY_IMAGE`;
   - integrated WS03 + WS14 session/world runtime -> `KO_SESSION_WORLD_IMAGE`.
3. Materialize the exact passing WS12 launcher + real WASM/client package into `deploy/artifacts/staging-play/`. If WS38 versioned content is used, materialize its manifest/marker/pointer layout as specified above.
4. Create the host-local env file:

   ```sh
   cp deploy/.env.staging.example deploy/.env.staging
   ```

5. Set these deployment values in `deploy/.env.staging`:
   - `GATEWAY_IMAGE=<immutable WS02 image ref>`
   - `KO_SESSION_WORLD_IMAGE=<immutable integrated WS03+WS14 image ref>`
   - `STAGING_HOST=<temporary provider hostname>`
   - `STAGING_PUBLIC_ORIGIN=https://<temporary provider hostname>`
   - `STAGING_ALLOWED_HOST=<temporary provider hostname>` (include port only if the public URL uses a non-default port)
   - `STAGING_HTTP_BIND=<host port reached by the TLS/tunnel/LB layer>`
   - `KO_GAME_ADVERTISE_HOST=<host identity required by the exact integrated browser transport proven by WS10>`
6. Configure the external host/tunnel/load balancer to provide HTTPS/WSS and forward to the staging edge. Preserve `Host`, `X-Forwarded-Host`, and `X-Forwarded-Proto=https`. Do **not** expose TCP 15100 or 15001 publicly.
7. Update the staged `play-shell/config.json` gateway probe/client URLs for that public origin; do not edit the WS12 branch.
8. Bring up and smoke-check in one command:

   ```sh
   sh deploy/staging-up.sh deploy/.env.staging
   ```

9. Verify from outside the host:
   - `https://<host>/play-shell/` loads;
   - `wss://<host>/auth` and `wss://<host>/game` are the browser endpoints;
   - WASM and DATA MIME headers are correct;
   - static content is the frozen passing build.
10. Rerun the real WS10 browser/Moradon gate against the published staging composition before telling the user the public link is a verified Moradon PASS. The WS09 smoke command is infrastructure evidence only; it is not a substitute for WS10 native render evidence.

## GitHub Pages boundary

GitHub Pages may host static launcher/client files, but it cannot run WS02 WebSocket gateway, WS03 session TCP service, or WS14 world service. WS09 therefore does not present GitHub Pages as a complete public-test deployment.

## Single external requirement

**One external requirement remains for an actual public URL:** an Internet-reachable container host, or an equivalent tunnel/load-balancer service, that provides a temporary HTTPS/WSS hostname and forwards traffic to the WS09 staging edge while preserving the proxy headers above.

This does **not** require buying `oldkoweb.com`; a provider-issued temporary hostname is sufficient for the test.

## Current upstream gate

- WS05 is corrected and reports ready for an unchanged WS10 rerun.
- WS10's latest recorded report still reflects the older pre-fix run and therefore does not yet authorize publication as a verified Moradon PASS.
- This is a publish-quality gate, not an unresolved WS09 implementation defect.

## Verification

WS09 CI/static validation now checks:

- production compose parses;
- staging compose parses with the non-secret example env;
- local, staging, and production Nginx templates pass `nginx -t` in CI;
- staging compose includes separate auth/game gateway modes and paths;
- Origin/Host allowlist configuration is present;
- `.wasm` and `.data` MIME contracts are present;
- immutable and no-store cache directives are present;
- staging shell scripts pass `sh -n`.

The exact GitHub Actions run evidence is recorded/reported at closure after the final branch validation run is inspected.

## Boundaries

- No merge to `main`.
- No force push.
- No other WS branch modified.
- No application/product/provider implementation modified.
- No secret committed.
- No production domain ownership assumed.
- No production DNS or certificate cutover performed.

BU SOHBETE ARTIK GEREK VAR MI?: HAYIR
