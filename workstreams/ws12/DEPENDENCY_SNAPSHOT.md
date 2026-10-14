WS12

# Dependency Snapshot

## SELF

- Workstream: `WS12`
- Branch: `ws12-browser-launcher`
- Pre-control head: `e21f84e481203130522964a45e133b84038d8e17`
- Scope used: `play-shell/**`, `tools/ws12_launcher/**`, `tests/ws12-launcher/**`, `workstreams/ws12/**`, `.github/workflows/ws12-launcher.yml`.
- Final closing SHA: branch HEAD containing this snapshot; reported at conversational closure.

## UPSTREAM

### WS02 — WebSocket transport

- Ref checked: `ws02-websocket-gateway@1738f60945b24e00bdd2266e6600b5c0cf3c64cf`.
- Contract: separate auth/game instances, browser WS paths `/auth` and `/game`, `/healthz`, TLS at edge, Origin/Host allowlists.
- WS12 use: readiness probes only; no KO packet generation and no transport implementation duplication.

### WS05 — Moradon browser/provider instrumentation

- Ref checked: `ws05-moradon-world@6ca101f3390e0a0f6b056afea99b45ec8d4f67be`.
- State: corrected wire Moradon zone 21 vs pinned native client zone 210; ready for unchanged WS10 rerun.
- WS12 use: release-gate awareness only.

### WS09 — staging deployment

- Ref checked: `ws09-production-infra@cef2b97e727eb1bba6e2cd2ceceede495dea62bb`.
- Contract: one same-origin staging edge, `/play-shell/`, `/auth`, `/game`, temporary HTTPS/WSS host allowed, private AUTH/GAME TCP services.
- Integration note: current `.js` MIME mapping differs from WS38's declared loader MIME; see `INTEGRATION_PATCH.md`.

### WS10 — E2E authority

- Ref checked: `ws10-qa-integration@34c551518aad87a9fd03d392f193d354483c95a0`.
- Latest recorded evidence: run #16 proves real WASM -> create/select -> WS14 world bootstrap but is `MORADON E2E: BLOCKED` at the old WS05 21/210 probe defect.
- A post-WS05-fix PASS is still required before a public staging URL can be called verified.

### WS38 — content publication/integrity

- Ref checked: `ws38-client-content-pipeline@5f323f3cf055ba7f96d928605a2f2faf84e609cb`.
- Contract consumed: manifest schema v1, `latest.json`, exact manifest-file SHA-256, canonical manifest checksum, immutable base path, required file size/hash/MIME, `_complete.json`, fail-closed mixed/stale/corrupt release handling.

### WS40 / WS50 — integration planning evidence

- WS40 output was reviewed as historical release-order guidance; it predates several current control repairs and is not used to override current main inbox/broadcast evidence.
- WS50 current checked head: `9112bb4e326d016f3ca8a2a56495e3421ffa76c5`; prior rehearsal listed WS12 as cleanly integratable.

## DOWNSTREAM

- WS09/publisher stages the launcher and publication pointer.
- WS10 consumes the public staging composition for final native E2E evidence.
- Ana Kontrol Hattı decides integration/merge/public-link release.

## CONTRACTS

Current staging launcher contract:

```text
GET  /play-shell/config.json        no-store
GET  /latest.json                   no-store
GET  /client-content/v1/<v>/manifest.json
GET  /client-content/v1/<v>/_complete.json
GET  /client-content/v1/<v>/<required-file> + SHA-256/size/MIME verification
WSS  /auth
WSS  /game
OPEN immutable manifest-derived HTML entry
```

No purchased hostname is encoded. Relative gateway URLs are resolved against the launcher origin.

## BLOCKERS

- WS12 implementation blocker: **none**.
- Publish-quality gate: a new WS10 Moradon E2E PASS after the WS05 fix.
- Deployment integration requirement: align WS09 `.js` MIME with the WS38 declared loader MIME before strict manifest preflight can pass publicly.
- External requirement for a real link remains the WS09-owned Internet-reachable HTTPS/WSS host/tunnel/LB.

## LAST_SYNC

Checked during the 2026-10-14 WS12 control session against current `main` control/inbox files and the upstream branch heads listed above.
