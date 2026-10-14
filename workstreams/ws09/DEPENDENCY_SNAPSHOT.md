WS09

# Dependency Snapshot

## SELF

- Workstream: `WS09`
- Branch: `ws09-production-infra`
- Staging-prep implementation head at this snapshot: `7f17ecb338a8eb8dac6b6b796fb366acbe83c2cd`
- Owned surfaces used in this control session: `infra/**`, `deploy/**`, `docker-compose.ws09-staging.yml`, `.github/workflows/ws09-deploy.yml`, `workstreams/ws09/**`.
- No provider/product source was modified.

## UPSTREAM

### WS02 — WebSocket ↔ TCP gateway

- Branch/head checked: `ws02-websocket-gateway@1738f60945b24e00bdd2266e6600b5c0cf3c64cf`
- State consumed: transport implementation complete.
- Contract consumed:
  - one image/codebase, separate `GATEWAY_MODE=auth|game` instances;
  - auth TCP target via `AUTH_TCP_HOST` / `AUTH_TCP_PORT`;
  - game TCP target via `GAME_TCP_HOST` / `GAME_TCP_PORT`;
  - default browser WebSocket paths `/auth` and `/game`;
  - health path `/healthz`;
  - exact `ALLOWED_ORIGINS` and `ALLOWED_HOSTS` deployment allowlists;
  - `X-Forwarded-Host` honored when `TRUST_PROXY=true`;
  - TLS terminates at the edge/reverse proxy.

### WS03 — KO 1298 session orchestration

- Branch/head checked: `ws03-ko1298-session@d634870bbcd2c541695516643d34e0ac119354d7`
- State consumed: `TAMAMLANDI`, Moradon M1 complete / integrated M2-ready.
- Contract consumed:
  - one session process listens `AUTH_PORT` (default 15100) and `GAME_PORT` (default 15001);
  - `GAME_HOST` is the advertised game-host identity;
  - real character list/create/select is implemented;
  - validated selection delegates to WS14 instead of fabricating world success;
  - an integrated image containing `services/ko1298-world` allows WS03 to construct the WS14 provider dynamically.

### WS05 — native Moradon render gate

- Branch/head checked: `ws05-moradon-world@6ca101f3390e0a0f6b056afea99b45ec8d4f67be`
- State consumed: `READY FOR UNCHANGED WS10 E2E RERUN / MORADON PASS PENDING`.
- Latest fix consumed as release-gate evidence only: server/wire Moradon remains zone `21`, while the pinned 1.298 native client world namespace is `210` after the authentic client conversion.
- WS09 does not reproduce or weaken the WS05 native framebuffer/render gate.

### WS10 — integrated QA/E2E authority

- Branch/head checked: `ws10-qa-integration@34c551518aad87a9fd03d392f193d354483c95a0`
- Current recorded report is run #16 (`38490102763`) and still says `MORADON E2E: BLOCKED` because it predates the later WS05 21/210 fix.
- That run nevertheless proves the real WASM/WebGL browser path through WS02 transport, WS03 create/select, WS14 world bootstrap, native main-scene entry, and local-player initialization.
- A new unchanged WS10 rerun after the WS05 fix is the publish-quality trigger. WS09 does not declare Moradon PASS itself.

### WS12 — browser launcher/play shell

- Branch/head checked: `ws12-browser-launcher@e21f84e481203130522964a45e133b84038d8e17`
- State consumed: launcher complete and conditionally deployable.
- Contract consumed:
  - `play-shell/config.json` controls client/build/package URLs and the optional gateway reachability probe;
  - launcher + real client should be same-origin when runtime telemetry is desired;
  - gateway URL stays deployment configuration, not a hard-coded provider edit;
  - `cacheVersion` changes with published client content.
- Important boundary: the launcher gateway probe does not replace the real C++ client's auth/game transport configuration.

### WS14 — selected-character world session

- Branch/head checked: `ws14-world-session@82cdcef40bed265ff4c4ce0fb7c8f6ad8cf2f52b`
- State consumed: `TAMAMLANDI`, integration-ready; revalidated 14/14 tests.
- Contract consumed: WS03 validates selection and calls `beginSelectedCharacter`; WS14 owns successful world placement plus the two-phase 1298 GAMESTART/MYINFO/zone bootstrap.

### WS38 — client content publication/integrity

- Branch/head checked: `ws38-client-content-pipeline@5f323f3cf055ba7f96d928605a2f2faf84e609cb`
- State consumed: complete publication contract/tooling.
- Infra contract consumed:
  - `.wasm` -> `Content-Type: application/wasm`;
  - `.data` -> `Content-Type: application/octet-stream`;
  - immutable version paths -> `Cache-Control: public, max-age=31536000, immutable`;
  - `latest.json` / `rollback.json` -> `Cache-Control: no-store, max-age=0`;
  - immutable files are published before manifest; `_complete.json` is published last; `latest.json` advances only after verification.

## DOWNSTREAM

- WS10 / Ana Kontrol Hattı consume the staging endpoint for the final integrated public-test gate.
- The operator/user consumes the resulting temporary browser URL only after the current Moradon E2E gate passes.

## CONTRACTS

The WS09 staging profile now exposes only one browser edge and two WebSocket paths:

```text
https://<staging-host>/play-shell/
wss://<staging-host>/auth
wss://<staging-host>/game
```

For local HTTP smoke, the same paths are `http://localhost:8080` and `ws://localhost:8080/{auth,game}`.

Backend TCP ports 15100/15001 remain private to the compose backend network. The edge preserves `Host` / `X-Forwarded-Host`; public TLS/WSS is intentionally external to the in-repo staging container.

GitHub Pages is treated as static-only. It can host launcher/client files, but it cannot run WS02/WS03/WS14 and therefore is not a complete OldKOWeb public-test environment.

## BLOCKERS

- **WS09 implementation blocker:** none known after the staging profile update.
- **Publish-quality gate:** a new WS10 Moradon E2E PASS is still required after the WS05 fix. This is an upstream acceptance gate, not permission for WS09 to alter provider code.
- **Single external requirement for a real public test link:** an Internet-reachable container host or equivalent tunnel/load-balancer service that provides a temporary HTTPS/WSS hostname and forwards to the WS09 staging edge while preserving `Host`, `X-Forwarded-Host`, and `X-Forwarded-Proto`. A purchased `oldkoweb.com` domain is not required.

## LAST_SYNC

Checked on 2026-10-14 against current `main` control/inbox files and the provider branch heads listed above.
