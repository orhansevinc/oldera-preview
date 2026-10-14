WS12

# STATUS — Browser Launcher / Staging Test Prep

## Decision

**STAGING LAUNCHER PREP: READY**

Branch: `ws12-browser-launcher`
Pre-control branch head: `e21f84e481203130522964a45e133b84038d8e17`
Closing commit: branch HEAD containing this status; exact SHA is reported in the control-session closure message.

This session prepares the launcher/test-entry path only. It does not claim a public staging URL, production DNS/TLS, or a new Moradon E2E PASS.

## Implemented in this control session

- Revalidated the launcher against current WS02 and WS09 staging contracts.
- Replaced the single-gateway assumption with config-driven multi-endpoint readiness probing while keeping legacy `gateway.url` compatibility.
- Added a domain-independent staging example using same-origin `/auth` and `/game`; HTTPS automatically resolves those to `wss://<same-host>/auth` and `/game`.
- Added WS38 manifest publication preflight:
  - GET mutable `latest.json` with no-store;
  - verify exact `manifest.json` bytes against `manifestFileSha256`;
  - parse/validate manifest v1 identity and embedded `oldkoweb-json-v1` SHA-256 checksum;
  - require matching `contentVersion`, `buildId`, and manifest checksum;
  - require and validate `_complete.json` for staging/publication mode;
  - fetch every required manifest file and verify exact byte size + SHA-256;
  - enforce manifest-declared MIME type when `strictContentType=true`;
  - derive the real client HTML entry from the immutable manifest path instead of inventing a fake scene or loader.
- Manifest `contentVersion` is now the launcher cache/release identity when WS38 mode is enabled. Legacy local `real1298` mode retains query-string cache busting for branch smoke use only.
- Added `play-shell/config.staging.example.json` as the deploy-time contract. No purchased domain is assumed.
- Kept real runtime monitoring config-driven and same-origin when available.

No fake game, fake loading percentage, HTML/Three.js world, packet logic, server logic, provider branch, or WS38 implementation was added.

## Verification actually run

Local control-session validation:

```text
node --check play-shell/launcher-core.js                         PASS
node --check play-shell/app.js                                  PASS
node tools/ws12_launcher/check-config.cjs                        PASS
node --test tests/ws12-launcher/*.test.cjs                       PASS 11/11
workflow YAML parse                                              PASS
```

The 11 tests include a fixed independent WS38 canonical-checksum vector, successful `latest -> manifest -> _complete -> required files`, corrupt manifest rejection, missing completion-marker rejection, strict MIME rejection, cache-version change, legacy package 404 behavior, WASM/WebGL2 checks, and same-origin auth/game WSS resolution.

CI additionally checks the committed real `real1298` package with WS38's own generator/verifier from `ws38-client-content-pipeline`, then performs HTTP smoke checks on the launcher and real JS/WASM/DATA artifacts.

## Exact one-click staging wiring

After a new WS10 Moradon E2E PASS exists for the corrected WS05 provider, publish the exact passing client build as follows:

1. Freeze the exact passing provider/client SHAs; do not rebuild from moving branch tips.
2. Stage WS12 `play-shell/**` under WS09's staging static root.
3. Publish the real 1298 package with WS38 tooling under a new immutable path such as `/client-content/v1/<contentVersion>/`.
4. Publish in WS38 order: immutable files -> `manifest.json` -> remote verification -> `_complete.json` -> verification -> mutable `latest.json` last.
5. Put the mutable pointer at `/latest.json` for the current WS09 staging template, or change `publication.latestUrl` to the exact deployed pointer path if the publisher uses another path.
6. Copy `play-shell/config.staging.example.json` to the staged `play-shell/config.json` unchanged when using the current WS09 same-origin edge. It requires both `/auth` and `/game` readiness before enabling OYNA.
7. External TLS/tunnel/LB may use any temporary HTTPS hostname; no `oldkoweb.com` purchase is required for this test. Preserve Host / X-Forwarded-Host / X-Forwarded-Proto as required by WS09/WS02.
8. The real C++/WASM transport must itself be the exact integrated build proven by WS10 and must connect through the published auth/game transport endpoints. The launcher readiness probe does **not** rewrite CAPISocket or replace client transport configuration.
9. Open only the single user entry: `https://<temporary-staging-host>/play-shell/`.
10. Re-run the WS10 native browser/Moradon gate against that published composition before presenting the URL as a verified Moradon test link.

## Known integration requirement

Current WS09 staging MIME table serves `.js` as `application/javascript`, while the current WS38 1298 profile declares `text/javascript; charset=utf-8`. WS12 intentionally fails closed when strict WS38 MIME validation sees that mismatch. The exact WS09-side adjustment is recorded in `workstreams/ws12/INTEGRATION_PATCH.md`; WS12 did not edit WS09-owned files.

## Current upstream state consumed

- WS02 `ws02-websocket-gateway@1738f60945b24e00bdd2266e6600b5c0cf3c64cf` — auth/game gateway contract complete.
- WS05 `ws05-moradon-world@6ca101f3390e0a0f6b056afea99b45ec8d4f67be` — wire zone 21/native zone 210 correction ready for unchanged WS10 rerun.
- WS09 `ws09-production-infra@cef2b97e727eb1bba6e2cd2ceceede495dea62bb` — staging edge `/auth` + `/game` ready; temporary public host remains external.
- WS10 `ws10-qa-integration@34c551518aad87a9fd03d392f193d354483c95a0` — latest recorded report is still run #16 / MORADON E2E BLOCKED because it predates the WS05 correction.
- WS38 `ws38-client-content-pipeline@5f323f3cf055ba7f96d928605a2f2faf84e609cb` — manifest/latest/_complete contract complete.
- WS50 `ws50-integration-rehearsal@9112bb4e326d016f3ca8a2a56495e3421ffa76c5` — existing rehearsal classified WS12 as cleanly integratable; current control changes require the normal future rehearsal/integration owner to refresh that evidence before merge.

## Boundaries

- No merge to `main`.
- No force push.
- No other WS branch modified.
- No real client/WASM binary modified.
- No gateway/server/game logic modified.
- No production domain, DNS, TLS certificate, or provider hostname assumed.

BU SOHBETE ARTIK GEREK VAR MI?: HAYIR
