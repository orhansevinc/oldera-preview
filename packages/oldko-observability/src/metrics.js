const METRIC_NAME = /^[a-z][a-z0-9_]*$/;
const FORBIDDEN_LABELS = new Set([
  'account_id', 'character_id', 'character_name', 'user_id', 'username',
  'session_id', 'request_id', 'correlation_id', 'ip', 'ip_address', 'token',
  'auth_token', 'raw_packet', 'packet_payload'
]);

function assertMetricName(name) {
  if (!METRIC_NAME.test(name)) throw new TypeError(`Invalid metric name: ${name}`);
}

function normalizeLabelNames(labelNames = []) {
  const unique = [...new Set(labelNames.map(String))];
  for (const label of unique) {
    if (!METRIC_NAME.test(label)) throw new TypeError(`Invalid label name: ${label}`);
    if (FORBIDDEN_LABELS.has(label)) throw new TypeError(`Forbidden high-cardinality/sensitive label: ${label}`);
  }
  return unique.sort();
}

function normalizeLabels(expected, labels = {}) {
  const provided = Object.keys(labels).sort();
  if (provided.length !== expected.length || provided.some((key, i) => key !== expected[i])) {
    throw new TypeError(`Expected labels [${expected.join(', ')}], got [${provided.join(', ')}]`);
  }
  const normalized = {};
  for (const key of expected) normalized[key] = String(labels[key]);
  return normalized;
}

function labelsKey(labels) {
  return JSON.stringify(labels);
}

class InstrumentBase {
  constructor(type, name, { help = '', unit, labelNames = [] } = {}) {
    assertMetricName(name);
    this.type = type;
    this.name = name;
    this.help = help;
    this.unit = unit;
    this.labelNames = normalizeLabelNames(labelNames);
    this.series = new Map();
  }

  _labels(labels) {
    return normalizeLabels(this.labelNames, labels);
  }
}

class Counter extends InstrumentBase {
  constructor(name, options) {
    super('counter', name, options);
  }

  inc(labels = {}, value = 1) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new TypeError('Counter increment must be a finite non-negative number');
    }
    const normalized = this._labels(labels);
    const key = labelsKey(normalized);
    const current = this.series.get(key)?.value ?? 0;
    this.series.set(key, { labels: normalized, value: current + value });
  }
}

class Gauge extends InstrumentBase {
  constructor(name, options) {
    super('gauge', name, options);
  }

  set(labels = {}, value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError('Gauge value must be finite');
    const normalized = this._labels(labels);
    this.series.set(labelsKey(normalized), { labels: normalized, value });
  }

  inc(labels = {}, value = 1) {
    const normalized = this._labels(labels);
    const key = labelsKey(normalized);
    const current = this.series.get(key)?.value ?? 0;
    this.set(normalized, current + value);
  }

  dec(labels = {}, value = 1) {
    this.inc(labels, -value);
  }
}

class Histogram extends InstrumentBase {
  constructor(name, options = {}) {
    super('histogram', name, options);
    this.buckets = [...(options.buckets ?? [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5])]
      .map(Number)
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
  }

  observe(labels = {}, value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new TypeError('Histogram observation must be a finite non-negative number');
    }
    const normalized = this._labels(labels);
    const key = labelsKey(normalized);
    const current = this.series.get(key) ?? {
      labels: normalized,
      count: 0,
      sum: 0,
      buckets: this.buckets.map((le) => ({ le, count: 0 }))
    };
    current.count += 1;
    current.sum += value;
    for (const bucket of current.buckets) if (value <= bucket.le) bucket.count += 1;
    this.series.set(key, current);
  }
}

export class MemoryMetricsRegistry {
  constructor() {
    this.instruments = new Map();
  }

  _register(instrument) {
    if (this.instruments.has(instrument.name)) throw new Error(`Metric already registered: ${instrument.name}`);
    this.instruments.set(instrument.name, instrument);
    return instrument;
  }

  counter(name, options) { return this._register(new Counter(name, options)); }
  gauge(name, options) { return this._register(new Gauge(name, options)); }
  histogram(name, options) { return this._register(new Histogram(name, options)); }

  snapshot() {
    return [...this.instruments.values()].map((instrument) => ({
      type: instrument.type,
      name: instrument.name,
      help: instrument.help,
      ...(instrument.unit ? { unit: instrument.unit } : {}),
      labelNames: [...instrument.labelNames],
      ...(instrument.type === 'histogram' ? { buckets: [...instrument.buckets] } : {}),
      series: [...instrument.series.values()].map((series) => JSON.parse(JSON.stringify(series)))
    }));
  }
}

export const METRIC_DEFINITIONS = Object.freeze({
  activeSessions: Object.freeze({ name: 'oldko_active_sessions', type: 'gauge', help: 'Current authenticated or game-active sessions.' }),
  websocketConnections: Object.freeze({ name: 'oldko_websocket_connections', type: 'gauge', help: 'Current open WebSocket connections.' }),
  packets: Object.freeze({ name: 'oldko_packets_total', type: 'counter', help: 'Total application packets processed.', labelNames: ['direction', 'result'] }),
  errors: Object.freeze({ name: 'oldko_errors_total', type: 'counter', help: 'Total service errors by bounded category.', labelNames: ['category'] }),
  dbLatency: Object.freeze({ name: 'oldko_db_operation_duration_seconds', type: 'histogram', help: 'Database operation latency in seconds.', unit: 'seconds', labelNames: ['operation', 'result'] }),
  commandLatency: Object.freeze({ name: 'oldko_command_duration_seconds', type: 'histogram', help: 'Administrative or game command latency in seconds.', unit: 'seconds', labelNames: ['command', 'result'] }),
  loginAttempts: Object.freeze({ name: 'oldko_login_attempts_total', type: 'counter', help: 'Login attempts by success/failure outcome.', labelNames: ['outcome'] }),
  worldSessions: Object.freeze({ name: 'oldko_world_sessions', type: 'gauge', help: 'Current world sessions.' }),
  processUptime: Object.freeze({ name: 'oldko_process_uptime_seconds', type: 'gauge', help: 'Process uptime in seconds.', unit: 'seconds' })
});

function createByDefinition(registry, definition) {
  const options = {
    help: definition.help,
    unit: definition.unit,
    labelNames: definition.labelNames ?? []
  };
  return registry[definition.type](definition.name, options);
}

export function createStandardMetrics(registry = new MemoryMetricsRegistry()) {
  const instruments = {
    activeSessions: createByDefinition(registry, METRIC_DEFINITIONS.activeSessions),
    websocketConnections: createByDefinition(registry, METRIC_DEFINITIONS.websocketConnections),
    packets: createByDefinition(registry, METRIC_DEFINITIONS.packets),
    errors: createByDefinition(registry, METRIC_DEFINITIONS.errors),
    dbLatency: createByDefinition(registry, METRIC_DEFINITIONS.dbLatency),
    commandLatency: createByDefinition(registry, METRIC_DEFINITIONS.commandLatency),
    loginAttempts: createByDefinition(registry, METRIC_DEFINITIONS.loginAttempts),
    worldSessions: createByDefinition(registry, METRIC_DEFINITIONS.worldSessions),
    processUptime: createByDefinition(registry, METRIC_DEFINITIONS.processUptime)
  };

  return Object.freeze({
    registry,
    instruments: Object.freeze(instruments),
    setActiveSessions: (count) => instruments.activeSessions.set({}, count),
    setWebsocketConnections: (count) => instruments.websocketConnections.set({}, count),
    recordPacket: ({ direction, result = 'ok', count = 1 }) => instruments.packets.inc({ direction, result }, count),
    recordError: ({ category = 'unknown', count = 1 } = {}) => instruments.errors.inc({ category }, count),
    observeDbLatency: ({ operation, result = 'ok', durationSeconds }) => instruments.dbLatency.observe({ operation, result }, durationSeconds),
    observeCommandLatency: ({ command, result = 'ok', durationSeconds }) => instruments.commandLatency.observe({ command, result }, durationSeconds),
    recordLogin: ({ outcome }) => instruments.loginAttempts.inc({ outcome }, 1),
    setWorldSessions: (count) => instruments.worldSessions.set({}, count),
    updateProcessUptime: () => instruments.processUptime.set({}, process.uptime())
  });
}

export const FORBIDDEN_METRIC_LABELS = Object.freeze([...FORBIDDEN_LABELS].sort());
