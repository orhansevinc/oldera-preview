function withTimeout(promise, timeoutMs, name) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, state: 'timeout', detail: `${name} exceeded ${timeoutMs}ms` }), timeoutMs);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function normalizeCheckResult(result) {
  if (result === true || result === undefined) return { ok: true, state: 'ok' };
  if (result === false) return { ok: false, state: 'fail' };
  if (result && typeof result === 'object') {
    const ok = result.ok !== false;
    return { ok, state: result.state ?? (ok ? 'ok' : 'fail'), ...(result.detail ? { detail: String(result.detail) } : {}) };
  }
  return { ok: Boolean(result), state: result ? 'ok' : 'fail' };
}

export class HealthRegistry {
  constructor({ serviceName, serviceVersion, clock = () => new Date(), uptime = () => process.uptime() }) {
    if (!serviceName) throw new TypeError('serviceName is required');
    if (!serviceVersion) throw new TypeError('serviceVersion is required');
    this.serviceName = serviceName;
    this.serviceVersion = serviceVersion;
    this.clock = clock;
    this.uptime = uptime;
    this.readyChecks = new Map();
    this.draining = false;
  }

  addReadinessCheck(name, check, options = {}) {
    if (!name || typeof check !== 'function') throw new TypeError('Readiness check requires name and function');
    if (this.readyChecks.has(name)) throw new Error(`Readiness check already exists: ${name}`);
    this.readyChecks.set(name, {
      check,
      critical: options.critical !== false,
      timeoutMs: options.timeoutMs ?? 1000
    });
    return () => this.readyChecks.delete(name);
  }

  setDraining(draining = true) {
    this.draining = Boolean(draining);
  }

  health() {
    return {
      status: 'ok',
      service_name: this.serviceName,
      service_version: this.serviceVersion,
      uptime_seconds: this.uptime(),
      timestamp: this.clock().toISOString()
    };
  }

  async readiness() {
    const checks = [];
    for (const [name, descriptor] of this.readyChecks) {
      let result;
      try {
        result = await withTimeout(Promise.resolve().then(descriptor.check).then(normalizeCheckResult), descriptor.timeoutMs, name);
      } catch (error) {
        result = { ok: false, state: 'fail', detail: error?.message ? String(error.message) : 'readiness check failed' };
      }
      checks.push({ name, critical: descriptor.critical, ...result });
    }

    const criticalFailure = this.draining || checks.some((check) => check.critical && !check.ok);
    const nonCriticalFailure = checks.some((check) => !check.critical && !check.ok);

    return {
      status: criticalFailure ? 'not_ready' : (nonCriticalFailure ? 'degraded' : 'ready'),
      service_name: this.serviceName,
      service_version: this.serviceVersion,
      draining: this.draining,
      uptime_seconds: this.uptime(),
      timestamp: this.clock().toISOString(),
      checks
    };
  }
}

export function httpStatusForHealth(payload) {
  return payload?.status === 'ok' || payload?.status === 'ready' || payload?.status === 'degraded' ? 200 : 503;
}
