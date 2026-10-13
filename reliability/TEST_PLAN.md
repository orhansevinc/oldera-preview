# WS20 Reliability / Security Test Plan

## Scope

WS20 is an independent test-only workstream. It does not modify product code, client code, admin/site code, database schema, or production infrastructure. All active load tests are restricted to loopback by default. A non-loopback target is rejected unless `WS20_ALLOW_NONLOOPBACK=1` is explicitly set for an owned test environment.

Baseline: `main` at `a1c1d6b3e9aeb07fd066cee8a41714685557dddf`.
Branch: `ws20-reliability-security`.

## Test principles

1. Do not make the product pass by weakening assertions.
2. Never load-test third-party or public endpoints.
3. Separate harness self-tests from product evidence.
4. A skipped scenario is not a pass.
5. HIGH/CRITICAL security findings block a green security gate.
6. Reliability tests must record status distribution, errors, and latency/resource indicators where applicable.

## Current target availability

`main` currently contains the legacy `server/` admin API but does not contain the new WS02 gateway, WS03 KO1298 session server, WS07 database layer, WS09 container deployment, or WS13 public account API. Therefore, admin HTTP, rate-limit, DB-failure, process lifecycle, and resource-soak tests can run against `main`; gateway/session/container scenarios are prepared but remain integration-gated.

## Matrix

| Scenario | Test/Probe | Current state on `main` | Pass criteria |
|---|---|---|---|
| Concurrent WebSocket | `tests/load/ws-target-probe.mjs` | BLOCKED: WS02 target absent | configured owned target accepts test connections without probe errors; optional health remains healthy |
| Reconnect storm | WebSocket harness + target campaign | BLOCKED: WS02 target absent | no service crash, bounded errors, recovery confirmed by health |
| Malformed packet | `ws-target-probe.mjs` opaque binary payload | BLOCKED: WS02/WS03 target absent | malformed input cannot crash gateway/session service |
| Oversized packet | WS harness; product campaign after integration | BLOCKED: WS02/WS03 target absent | connection rejected/closed according to service limit; service remains healthy |
| Backpressure | WS harness; product campaign after integration | BLOCKED: WS02 target absent | memory/queue growth bounded; health remains responsive |
| Dead TCP target | WS02 deployment scenario | BLOCKED: WS02 absent | gateway rejects/closes cleanly and remains available for later connections |
| Service restart | `reliability/service-lifecycle-probe.mjs` | RUNNABLE | initial start succeeds, SIGTERM exits cleanly, restart succeeds |
| DB unavailable | `reliability/db-unavailable-probe.mjs` | RUNNABLE | API health responds while DB reports enabled=true/connected=false; process stays alive |
| Stale session | account/session integration scenario | BLOCKED: WS13/WS03 absent | stale token/session rejected; no privilege retention |
| Duplicate login | account/session integration scenario | BLOCKED: WS13/WS03 absent | deterministic single-session policy; no session corruption |
| Invalid auth spam | `tests/load/http-auth-storm.mjs` | RUNNABLE | no 5xx/network failures and rate limiting activates |
| Rate-limit | static audit + auth storm | RUNNABLE | login limiter present and runtime returns 429 under spam |
| Admin unauthorized | `security-tests/admin-http-probe.mjs` | RUNNABLE | privileged admin endpoints return 401 without owner session |
| Oversized admin JSON | `admin-http-probe.mjs` | RUNNABLE | payload above configured body limit returns 413 |
| Graceful shutdown | static audit + lifecycle probe | RUNNABLE | explicit SIGTERM/SIGINT handling and clean exit code |
| Container recovery | `reliability/container-recovery.mjs` | BLOCKED: WS09 compose target absent | stop/start of owned test container restores health within 30s |
| Memory/resource leak indicator | `reliability/resource-leak-probe.mjs` | RUNNABLE | no request errors and RSS growth below 64 MiB during bounded health soak |

## WebSocket harness validation

`tests/load/ws-harness-selftest.mjs` runs only against the WS20-owned in-process fixture in `reliability/fixtures/ws-echo.mjs`. It validates the test machinery for 40 concurrent connections, 100 reconnects, opaque malformed binary, oversized close handling, and backpressure observation. This is harness evidence only and must never be reported as product PASS.

## Integration execution

After WS02/WS03 integration, run:

```bash
WS20_WS_TARGET=ws://127.0.0.1:<gateway-port> \
WS20_WS_HEALTH_URL=http://127.0.0.1:<health-port>/health \
node tests/load/ws-target-probe.mjs
```

For container recovery after WS09 integration:

```bash
WS20_COMPOSE_FILE=<owned-test-compose-file> \
WS20_COMPOSE_SERVICE=<service-name> \
WS20_CONTAINER_HEALTH_URL=http://127.0.0.1:<port>/health \
node reliability/container-recovery.mjs
```

## Evidence policy

Every defect goes to `workstreams/ws20/BUGS.md` using severity, affected WS, reproduce, expected, actual, and evidence. Security assertions intentionally fail for unresolved HIGH/CRITICAL findings. Product fixes belong to the affected workstream, never WS20.
