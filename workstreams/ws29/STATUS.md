# WS29 Status

## Identity

- Workstream: WS29
- Branch: `ws29-observability`
- Base/current task input: `d26f5af7aae0892576af5f35599a9d6076daf129`
- Scope: production observability / domain-live diagnostics contracts and tooling only
- Release: `oldkoweb-domain-live-20261015`

## Completed

- Existing backend-independent `@oldko/observability` package preserved and extended; no provider product branch was modified.
- Domain-live release identity reader added for exact `release_id`, WS50 provider set, exact coordinator source commit, client artifact/digest/build, service versions and migration head. Moving branch HEAD is not treated as a version.
- Diagnostic correlation contract added: request/trace IDs, opaque session ref, release-scoped account hash, character ID, game connection ID, runtime target ID and admin command ID.
- Canonical account-to-game, combat and admin-command flow stage contracts added.
- Redaction strengthened for nested JSON, headers, query/assignment strings, Bearer values and credential URLs. Passwords, Authorization, Cookie/Set-Cookie, CSRF, verification/reset tokens, webhook/tunnel/admin secrets, DATABASE_URL credentials and private keys are covered.
- Reusable compose/endpoint health collector added for container state, restart count, health, HTTP readiness, PostgreSQL connectivity, migration metadata, disk free, gateway ports and bounded sanitized logs.
- One-shot `incident bundle` CLI added with summary/release/health/migrations/containers/signatures/browser-evidence/sanitized-logs output and explicit no-DB-dump/no-secret boundary.
- Evidence-only failure classification added for account API, DB, migrations, auth/game gateways, world readiness, WebSocket, client assets/entities/models and admin repository/runtime bridge; no evidence returns `UNKNOWN`.
- Generic WS10/WS05 browser evidence reference schema added; WS29 does not create screenshots.
- PowerShell-friendly invocation and future WS09 wrapper contract documented without changing WS09.
- Bundle/log growth bounded by log tail/window/truncation and default 10-bundle/7-day retention. Docker rotation ownership remains with deployment infrastructure.
- Machine-readable contract: `workstreams/ws29/DOMAIN_LIVE_OBSERVABILITY.json`.

## Verification

- Existing WS29 test glob remains authoritative: `node --test tests/observability/*.test.mjs`.
- New domain-live diagnostics test file covers redaction golden cases, exact-byte secret leakage, release identity, correlation, deterministic classification, broken-service evidence, healthy bundle fixture, restart count and cross-platform path handling.
- Local isolated verification of the new domain-live test file: 7 passed, 0 failed.
- CI workflow remains `.github/workflows/ws29-observability.yml`; package `check` now syntax-checks the diagnostic modules and CLI.

## Scope compliance

Changed paths remain limited to WS29-owned observability/package/test/workstream paths. No WS03, WS05, WS07, WS08, WS09, WS10, WS13 product logic or branch content is modified.
