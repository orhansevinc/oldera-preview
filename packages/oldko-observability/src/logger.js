import { contextLogFields } from './context.js';
import { redact } from './redaction.js';

export const LOG_LEVELS = Object.freeze(['trace', 'debug', 'info', 'warn', 'error', 'fatal']);
const LEVEL_WEIGHT = new Map(LOG_LEVELS.map((level, index) => [level, index]));

function defaultSink(line, level) {
  const stream = level === 'error' || level === 'fatal' ? process.stderr : process.stdout;
  stream.write(`${line}\n`);
}

function normalizeFields(fields) {
  if (fields === undefined) return {};
  if (fields instanceof Error) return { error: fields };
  if (fields && typeof fields === 'object' && !Array.isArray(fields)) return fields;
  return { value: fields };
}

export function createLogger(options) {
  if (!options?.serviceName) throw new TypeError('serviceName is required');
  if (!options?.serviceVersion) throw new TypeError('serviceVersion is required');

  const minLevel = options.minLevel ?? 'info';
  if (!LEVEL_WEIGHT.has(minLevel)) throw new TypeError(`Unknown log level: ${minLevel}`);

  const sink = options.sink ?? defaultSink;
  const clock = options.clock ?? (() => new Date());
  const base = { ...(options.base ?? {}) };

  function emit(level, message, fields = {}) {
    if (LEVEL_WEIGHT.get(level) < LEVEL_WEIGHT.get(minLevel)) return undefined;

    const timestamp = clock();
    const record = redact({
      timestamp: timestamp instanceof Date ? timestamp.toISOString() : new Date(timestamp).toISOString(),
      level,
      message: String(message),
      service_name: options.serviceName,
      service_version: options.serviceVersion,
      ...base,
      ...contextLogFields(),
      ...normalizeFields(fields)
    }, options.redaction);

    const line = JSON.stringify(record);
    sink(line, level, record);
    return record;
  }

  const logger = {
    trace: (message, fields) => emit('trace', message, fields),
    debug: (message, fields) => emit('debug', message, fields),
    info: (message, fields) => emit('info', message, fields),
    warn: (message, fields) => emit('warn', message, fields),
    error: (message, fields) => emit('error', message, fields),
    fatal: (message, fields) => emit('fatal', message, fields),
    child(childBase = {}) {
      return createLogger({ ...options, base: { ...base, ...childBase }, sink, clock });
    }
  };

  return Object.freeze(logger);
}
