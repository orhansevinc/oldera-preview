# WS29 Integration Patch Guide

WS29 intentionally does **not** modify existing product services. Apply the following changes in each owning workstream when that service is ready to integrate observability.

## 1. Add the local package dependency

For a service whose `package.json` lives under `services/<service>/package.json`:

```json
{
  "dependencies": {
    "@oldko/observability": "file:../../packages/oldko-observability"
  }
}
```

Adjust only the relative path if the service is located at a different depth. Node 20+ is required.

## 2. Bootstrap once per process

```js
import {
  HealthRegistry,
  MemoryMetricsRegistry,
  createLogger,
  createStandardMetrics,
  installGracefulShutdown,
  renderPrometheus
} from '@oldko/observability';

const SERVICE_NAME = 'account-api';
const SERVICE_VERSION = process.env.SERVICE_VERSION ?? 'dev';

export const logger = createLogger({
  serviceName: SERVICE_NAME,
  serviceVersion: SERVICE_VERSION,
  minLevel: process.env.LOG_LEVEL ?? 'info'
});

export const metricRegistry = new MemoryMetricsRegistry();
export const metrics = createStandardMetrics(metricRegistry);
export const health = new HealthRegistry({
  serviceName: SERVICE_NAME,
  serviceVersion: SERVICE_VERSION
});
```

Do not create one registry/logger per request.

## 3. Request context middleware (framework-neutral shape)

At the first trusted server boundary:

```js
import {
  contextFromHeaders,
  responseContextHeaders,
  runWithContext
} from '@oldko/observability';

function handleIncoming(req, res, next) {
  const context = contextFromHeaders(req.headers, {
    sessionId: req.session?.observabilitySessionId
  });

  runWithContext(context, () => {
    for (const [name, value] of Object.entries(responseContextHeaders())) {
      res.setHeader(name, value);
    }
    next();
  });
}
```

The session ID must be a non-secret correlation value. Never pass an auth token or cookie as `sessionId`.

## 4. Health/readiness endpoints

Register only checks owned by the service. Example:

```js
health.addReadinessCheck('db', async () => {
  await db.ping();
  return true;
}, { critical: true, timeoutMs: 1000 });

app.get('/healthz', (_req, res) => {
  const body = health.health();
  res.status(httpStatusForHealth(body)).json(body);
});

app.get('/readyz', async (_req, res) => {
  const body = await health.readiness();
  res.status(httpStatusForHealth(body)).json(body);
});
```

Do not make telemetry export a critical readiness dependency by default.

## 5. Metrics endpoint / exporter

Prometheus-compatible process-local option:

```js
app.get('/metrics', (_req, res) => {
  metrics.updateProcessUptime();
  res.type('text/plain; version=0.0.4').send(renderPrometheus(metricRegistry));
});
```

Infrastructure must decide whether `/metrics` is private, authenticated, or network-restricted. Product code should not assume public exposure.

For OpenTelemetry or another backend, implement the registry adapter contract from `observability/OBSERVABILITY_STANDARD.md` and keep the service calls to `createStandardMetrics()` unchanged.

## 6. Signal instrumentation

Use only bounded labels:

```js
metrics.setActiveSessions(sessionStore.activeCount());
metrics.setWebsocketConnections(wsServer.clients.size);
metrics.recordPacket({ direction: 'in', result: 'ok' });
metrics.recordError({ category: 'protocol' });
metrics.observeDbLatency({ operation: 'account_lookup', result: 'ok', durationSeconds });
metrics.observeCommandLatency({ command: 'kick_player', result: 'ok', durationSeconds });
metrics.recordLogin({ outcome: 'success' }); // or failure
metrics.setWorldSessions(worldSessions.size);
```

Never use request/session/account/character IDs, names, IP addresses, SQL text, exception messages, or command arguments as metric labels.

## 7. Structured logging

```js
logger.info('login_succeeded', { account_state: 'active' });
logger.warn('packet_rejected', { reason: 'invalid_length', direction: 'in' });
logger.error('db_operation_failed', { operation: 'account_lookup', error });
```

Never log passwords, auth tokens, cookies, request bodies, raw packet bytes, decrypted packet payloads, or arbitrary command payloads. The package redacts common fields, but callers must still follow the safe logging contract.

## 8. Graceful shutdown

```js
const shutdown = installGracefulShutdown({
  logger,
  timeoutMs: 10_000,
  onDraining: () => health.setDraining(true),
  hooks: [
    async function stopListeners() { await server.close(); },
    async function closeDatabase() { await db.close(); }
  ]
});
```

Order hooks according to service ownership: stop new work first, then drain/close dependencies. Do not call `process.exit()` elsewhere in normal SIGTERM/SIGINT flow or the hooks can be bypassed.

## 9. Files intentionally untouched by WS29

No existing service implementation, infra/deploy file, admin/site/client code, database migration, or `main` branch file outside the WS29 allowlist is modified. Integration must be performed by the owning service workstream.
