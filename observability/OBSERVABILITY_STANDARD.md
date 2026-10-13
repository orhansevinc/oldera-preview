# OldKOWeb Observability Standard

Status: WS29 production contract v0.1  
Runtime baseline: Node.js 20+  
Core package: `packages/oldko-observability`

## 1. Purpose and boundaries

This standard defines a common contract for OldKOWeb server-side services without coupling product code to Prometheus, OpenTelemetry, a specific log collector, or a specific HTTP framework. Product services choose when and where to emit signals; the shared package defines safe shapes, names, lifecycle behavior, and backend adapter boundaries.

Observability failures must not disclose credentials, raw packets, authentication material, or personal/high-cardinality identifiers. Telemetry exporters should be treated as non-critical dependencies unless a service explicitly requires them for safe operation.

## 2. Structured JSON logging

Every emitted log record is exactly one JSON object per line (JSONL). Required fields:

| Field | Meaning |
| --- | --- |
| `timestamp` | UTC ISO-8601 timestamp |
| `level` | `trace`, `debug`, `info`, `warn`, `error`, or `fatal` |
| `message` | Stable machine-readable event name/summary; do not inject raw user input |
| `service_name` | Stable service identifier, e.g. `account-api` |
| `service_version` | Deployed version/build identifier |
| `correlation_id` | Cross-service operation ID when a request context exists |
| `request_id` | Per-request/operation ID when a request context exists |
| `session_id` | Optional bounded session correlation ID; never use as a metric label |

Recommended optional fields include `component`, `operation`, `result`, `duration_ms`, `zone_id`, `error`, and bounded domain identifiers that are safe for logs. Prefer stable event names such as `login_failed`, `world_session_started`, or `gm_command_completed` rather than free-form sentences.

### Log levels

- `trace`: extremely detailed diagnostic flow; disabled in normal production.
- `debug`: temporary operational detail useful during investigation.
- `info`: normal lifecycle and business-operation milestones.
- `warn`: unexpected/recoverable state that needs attention.
- `error`: operation failed or service capability degraded.
- `fatal`: service cannot safely continue.

Do not use `info` for every packet. Per-packet logging creates cost, noise, and data exposure risk; use packet counters instead.

## 3. Correlation, request, and session IDs

Inbound operations should call `contextFromHeaders()` and execute the request inside `runWithContext()`. Accepted propagation headers are:

- `x-correlation-id`: propagated across service boundaries.
- `x-request-id`: unique to the receiving request/operation.
- `x-session-id`: optional service-side session correlation; do not derive from auth tokens.

IDs are limited to 128 safe characters. Invalid IDs are rejected and fresh UUIDs are generated for request/correlation IDs. Outbound responses should return `x-correlation-id` and `x-request-id` using `responseContextHeaders()`.

A new downstream request SHOULD keep the current correlation ID but MAY create a new request ID. Session IDs are operational correlation values, not credentials.

## 4. Sensitive-data redaction

The shared logger recursively redacts known sensitive keys and binary data before serialization. Default protected classes include:

- passwords and password hashes;
- authorization headers, auth/access/refresh tokens, API keys and secrets;
- cookies/session cookies and credentials/private keys;
- request/response `body`, generic `payload`, `packet`, raw packet/payload variants;
- `Buffer`, typed arrays, and `ArrayBuffer` values.

Rules for service authors:

1. Never put a password, auth token, cookie, raw packet bytes, or decrypted sensitive packet body in a log message.
2. Never disable redaction to debug production traffic.
3. Log packet metadata only: direction, bounded result/category, byte length when safe, and a protocol-safe event name. Do not log raw payload.
4. Error messages must not embed credentials. Redaction can protect fields; it cannot reliably discover a secret interpolated into arbitrary prose.
5. Add service-specific secret field names through the logger `redaction.sensitiveKeys` option when necessary.

## 5. Metrics naming and cardinality

Metric names use lowercase snake_case, start with `oldko_`, include base units when meaningful, and counters end in `_total`. Durations use seconds so adapters map naturally to Prometheus/OpenTelemetry conventions.

Required standard instruments:

| Metric | Type | Labels | Meaning |
| --- | --- | --- | --- |
| `oldko_active_sessions` | gauge | none | Current authenticated/game-active sessions |
| `oldko_websocket_connections` | gauge | none | Current open WebSocket connections |
| `oldko_packets_total` | counter | `direction`, `result` | Packet throughput source; derive packet rate in backend |
| `oldko_errors_total` | counter | `category` | Error source; derive error rate in backend |
| `oldko_db_operation_duration_seconds` | histogram | `operation`, `result` | DB latency interface |
| `oldko_command_duration_seconds` | histogram | `command`, `result` | GM/admin/game command latency |
| `oldko_login_attempts_total` | counter | `outcome` | Login success/failure counts |
| `oldko_world_sessions` | gauge | none | Current world session count |
| `oldko_process_uptime_seconds` | gauge | none | Process uptime |

Packet rate and error rate are derived rates, not separate gauges. Examples in a Prometheus backend are `rate(oldko_packets_total[5m])` and `rate(oldko_errors_total[5m])`. Other backends should use their equivalent rate operators.

### Cardinality policy

Metric labels must be bounded enumerations or small stable operation sets. The shared registry rejects known unsafe/high-cardinality labels such as `session_id`, `request_id`, `correlation_id`, account/character/user identifiers, usernames, IP addresses, tokens, and raw packet fields.

Do not add character names, account IDs, arbitrary exception messages, SQL text, URLs with IDs, packet payloads, or unbounded command arguments as labels. If an operation label can grow without a code/config change, it is probably unsafe.

## 6. Backend-independent metric adapter contract

`createStandardMetrics(registry)` depends only on three registry factory methods:

```text
registry.counter(name, options)   -> { inc(labels, value) }
registry.gauge(name, options)     -> { set(labels, value), optional inc/dec }
registry.histogram(name, options) -> { observe(labels, value) }
```

This is the adapter boundary. `MemoryMetricsRegistry` is included as a dependency-free implementation and `renderPrometheus()` can expose that registry in Prometheus text format. An OpenTelemetry adapter can implement the same three methods without changing product instrumentation.

Adapters MUST preserve metric names, label names, and units from `METRIC_DEFINITIONS`.

## 7. Health and readiness contracts

Liveness and readiness are intentionally separate.

### Liveness (`health()`)

Liveness answers only whether the process is alive enough to respond. It MUST NOT fail merely because a database, exporter, or downstream dependency is unavailable.

Canonical body:

```json
{
  "status": "ok",
  "service_name": "example-service",
  "service_version": "1.0.0",
  "uptime_seconds": 123.4,
  "timestamp": "2026-10-14T00:00:00.000Z"
}
```

HTTP status: `200` for `status=ok`.

### Readiness (`readiness()`)

Readiness answers whether the process should receive new traffic. Checks can be critical or non-critical and each has a timeout.

Canonical top-level statuses:

- `ready`: all checks passed.
- `degraded`: only non-critical checks failed; service may still receive traffic.
- `not_ready`: a critical check failed/timed out or the process is draining.

HTTP status: `200` for `ready`/`degraded`, `503` for `not_ready`.

Database connectivity, required game-loop/world dependencies, or mandatory command-bus connectivity are candidates for critical readiness checks. Telemetry export itself should normally be non-critical to avoid an observability outage taking the game offline.

## 8. Graceful shutdown

Services should handle `SIGTERM` and `SIGINT` using `installGracefulShutdown()` or the lower-level `createShutdownController()`.

Recommended shutdown order:

1. Mark readiness as draining (`HealthRegistry.setDraining(true)`).
2. Stop accepting new HTTP/WebSocket/session work.
3. Stop schedulers/consumers and reject new commands.
4. Allow in-flight work to finish within a bounded timeout.
5. Persist/flush safe state where the owning service is responsible for it.
6. Close DB/network connections.
7. Flush telemetry adapter if applicable.
8. Exit cleanly; timeout/error should produce a non-zero exit where appropriate.

Shutdown execution is idempotent: repeated signals share the first shutdown run.

## 9. Recommended service-level events

Services should instrument outcomes, not sensitive inputs. Recommended examples:

- account API: login attempt success/failure counter, request correlation, DB latency;
- gateway/WebSocket: connection gauge, packet counters by direction/result, protocol error category;
- world server: world-session gauge, lifecycle info logs;
- GM command bus: command latency by bounded command name/result, error category, correlation ID in logs;
- DB layer: bounded operation name/result histogram; never SQL text with user data.

## 10. Production defaults

Recommended defaults are `info` log level, readiness check timeout around 1 second unless the dependency contract demands otherwise, and graceful shutdown around 10 seconds unless the service has a documented longer drain requirement. These are defaults, not hard-coded operational policy.

Expose `/healthz`, `/readyz`, and optionally `/metrics` at the service edge according to deployment policy. Protect metrics endpoints from public internet exposure at the infrastructure layer. WS29 does not modify infrastructure or product services.
