# WS29 Status

## Identity

- Workstream: WS29
- Branch: `ws29-observability`
- Base: `main`
- Scope: production observability / metrics / structured logging / health-readiness common layer

## Completed

- Backend-independent `@oldko/observability` package created for Node 20+ with zero external runtime dependencies.
- JSONL structured logger with service name/version and standard log levels.
- AsyncLocalStorage request context with correlation/request/session IDs and safe propagation helpers.
- Recursive sensitive-data redaction for credentials, tokens, cookies, bodies/payloads/packets and binary buffers.
- Metric naming/cardinality contract and standard instruments for active sessions, WebSockets, packets, errors, DB latency, command latency, login outcomes, world sessions and process uptime.
- In-memory metric registry and Prometheus text adapter added without coupling instrumentation to Prometheus.
- Liveness and readiness contracts implemented with critical/non-critical checks, timeouts and draining state.
- Graceful shutdown controller and SIGTERM/SIGINT installer implemented with idempotent execution and timeout handling.
- Production standard document and integration patch guide added.
- CI workflow scoped only to WS29 paths added.

## Verification

Local Node test command:

```text
node --test tests/observability/*.test.mjs
```

Result at completion: 9 tests passed, 0 failed.

Syntax checks cover every package source file. Tests cover context propagation, ID validation, logger fields/levels, redaction, metric recording/rendering/cardinality protection, health/readiness state transitions, and graceful shutdown idempotency/failure reporting.

## Scope compliance

Changed paths are limited to:

- `observability/**`
- `packages/oldko-observability/**`
- `tests/observability/**`
- `workstreams/ws29/**`
- `.github/workflows/ws29-observability.yml`

No product service, infra, admin/site/client, DB migration, or main-branch merge is part of WS29.
