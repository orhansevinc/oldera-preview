import {
  HealthRegistry,
  MemoryMetricsRegistry,
  contextFromHeaders,
  createLogger,
  createStandardMetrics,
  httpStatusForHealth,
  installGracefulShutdown,
  renderPrometheus,
  responseContextHeaders,
  runWithContext
} from '../packages/oldko-observability/src/index.js';

export function createServiceObservability({ serviceName, serviceVersion, readinessChecks = [] }) {
  const logger = createLogger({ serviceName, serviceVersion, minLevel: process.env.LOG_LEVEL ?? 'info' });
  const metricRegistry = new MemoryMetricsRegistry();
  const metrics = createStandardMetrics(metricRegistry);
  const health = new HealthRegistry({ serviceName, serviceVersion });

  for (const descriptor of readinessChecks) {
    health.addReadinessCheck(descriptor.name, descriptor.check, descriptor.options);
  }

  const shutdown = installGracefulShutdown({
    logger,
    onDraining: () => health.setDraining(true),
    hooks: []
  });

  return {
    logger,
    metrics,
    health,
    shutdown,
    prometheusText: () => {
      metrics.updateProcessUptime();
      return renderPrometheus(metricRegistry);
    },
    async withRequest(headers, sessionId, handler) {
      const context = contextFromHeaders(headers, { sessionId });
      return runWithContext(context, async () => {
        const result = await handler();
        return { result, responseHeaders: responseContextHeaders() };
      });
    },
    healthHttp: () => {
      const body = health.health();
      return { status: httpStatusForHealth(body), body };
    },
    readyHttp: async () => {
      const body = await health.readiness();
      return { status: httpStatusForHealth(body), body };
    }
  };
}
