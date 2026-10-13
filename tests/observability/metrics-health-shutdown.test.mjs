import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HealthRegistry,
  MemoryMetricsRegistry,
  createShutdownController,
  createStandardMetrics,
  httpStatusForHealth,
  renderPrometheus
} from '../../packages/oldko-observability/src/index.js';

test('standard metrics capture requested operational signals and render Prometheus text', () => {
  const registry = new MemoryMetricsRegistry();
  const metrics = createStandardMetrics(registry);

  metrics.setActiveSessions(11);
  metrics.setWebsocketConnections(7);
  metrics.recordPacket({ direction: 'in', result: 'ok', count: 4 });
  metrics.recordPacket({ direction: 'out', result: 'ok', count: 3 });
  metrics.recordError({ category: 'protocol' });
  metrics.observeDbLatency({ operation: 'account_lookup', result: 'ok', durationSeconds: 0.012 });
  metrics.observeCommandLatency({ command: 'kick_player', result: 'ok', durationSeconds: 0.04 });
  metrics.recordLogin({ outcome: 'success' });
  metrics.recordLogin({ outcome: 'failure' });
  metrics.setWorldSessions(5);
  metrics.updateProcessUptime();

  const snapshot = registry.snapshot();
  assert.equal(snapshot.length, 9);
  assert.equal(snapshot.find((metric) => metric.name === 'oldko_active_sessions').series[0].value, 11);
  assert.equal(snapshot.find((metric) => metric.name === 'oldko_login_attempts_total').series.length, 2);

  const text = renderPrometheus(registry);
  assert.match(text, /# TYPE oldko_packets_total counter/);
  assert.match(text, /oldko_packets_total\{direction="in",result="ok"\} 4/);
  assert.match(text, /oldko_db_operation_duration_seconds_count\{operation="account_lookup",result="ok"\} 1/);
});

test('metric registry rejects sensitive high-cardinality labels', () => {
  const registry = new MemoryMetricsRegistry();
  assert.throws(() => registry.counter('oldko_bad_total', { labelNames: ['session_id'] }), /Forbidden/);
});

test('health and readiness distinguish liveness, degradation, failure, and draining', async () => {
  const health = new HealthRegistry({
    serviceName: 'game-server',
    serviceVersion: '2.0.0',
    clock: () => new Date('2026-10-14T00:00:00.000Z'),
    uptime: () => 123
  });

  health.addReadinessCheck('db', async () => ({ ok: true, detail: 'connected' }));
  health.addReadinessCheck('telemetry-export', async () => false, { critical: false });

  const live = health.health();
  assert.equal(live.status, 'ok');
  assert.equal(httpStatusForHealth(live), 200);

  const degraded = await health.readiness();
  assert.equal(degraded.status, 'degraded');
  assert.equal(httpStatusForHealth(degraded), 200);

  health.addReadinessCheck('world-loop', async () => false, { critical: true });
  const failed = await health.readiness();
  assert.equal(failed.status, 'not_ready');
  assert.equal(httpStatusForHealth(failed), 503);

  health.setDraining(true);
  const draining = await health.readiness();
  assert.equal(draining.draining, true);
  assert.equal(draining.status, 'not_ready');
});

test('shutdown controller marks draining, executes hooks once, and reports failures', async () => {
  const events = [];
  const controller = createShutdownController({
    timeoutMs: 1000,
    onDraining: (value, signal) => events.push(`draining:${value}:${signal}`),
    hooks: [
      async function stopAccepting() { events.push('stop'); },
      async function flushSessions() { events.push('flush'); },
      async function failingHook() { throw new Error('expected'); }
    ]
  });

  const [a, b] = await Promise.all([controller.run('SIGTERM'), controller.run('SIGTERM')]);
  assert.equal(a.timedOut, false);
  assert.equal(b.timedOut, false);
  assert.equal(events.filter((event) => event === 'stop').length, 1);
  assert.equal(events.filter((event) => event === 'flush').length, 1);
  assert.equal(a.results.find((result) => result.name === 'failingHook').ok, false);
});
