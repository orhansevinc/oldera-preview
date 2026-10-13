'use strict';

const MODES = new Set(['auth', 'game']);

function intEnv(env, name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = env[name];
  if (raw == null || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function boolEnv(env, name, fallback = false) {
  const raw = env[name];
  if (raw == null || raw === '') return fallback;
  if (/^(1|true|yes|on)$/i.test(raw)) return true;
  if (/^(0|false|no|off)$/i.test(raw)) return false;
  throw new Error(`${name} must be a boolean`);
}

function csv(raw) {
  if (!raw) return [];
  return raw.split(',').map((v) => v.trim()).filter(Boolean);
}

function parseConfig(env = process.env) {
  const mode = (env.GATEWAY_MODE || 'auth').toLowerCase();
  if (!MODES.has(mode)) throw new Error('GATEWAY_MODE must be auth or game');

  const prefix = mode === 'auth' ? 'AUTH' : 'GAME';
  const targetHost = env[`${prefix}_TCP_HOST`] || env.TCP_TARGET_HOST;
  const targetPort = intEnv(env, `${prefix}_TCP_PORT`, env.TCP_TARGET_PORT ? Number(env.TCP_TARGET_PORT) : NaN, { min: 1, max: 65535 });
  if (!targetHost) throw new Error(`${prefix}_TCP_HOST (or TCP_TARGET_HOST) is required`);
  if (!Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535) {
    throw new Error(`${prefix}_TCP_PORT (or TCP_TARGET_PORT) is required and must be 1-65535`);
  }

  return {
    mode,
    listenHost: env.LISTEN_HOST || '0.0.0.0',
    listenPort: intEnv(env, 'PORT', 8080, { min: 1, max: 65535 }),
    wsPath: env.WS_PATH || `/${mode}`,
    healthPath: env.HEALTH_PATH || '/healthz',
    targetHost,
    targetPort,
    connectTimeoutMs: intEnv(env, 'TCP_CONNECT_TIMEOUT_MS', 5000, { min: 100, max: 120000 }),
    idleTimeoutMs: intEnv(env, 'IDLE_TIMEOUT_MS', 120000, { min: 1000, max: 86400000 }),
    pingIntervalMs: intEnv(env, 'PING_INTERVAL_MS', 30000, { min: 1000, max: 3600000 }),
    pongTimeoutMs: intEnv(env, 'PONG_TIMEOUT_MS', 10000, { min: 1000, max: 3600000 }),
    maxMessageBytes: intEnv(env, 'MAX_MESSAGE_BYTES', 8 * 1024 * 1024, { min: 1024, max: 256 * 1024 * 1024 }),
    maxBufferedBytes: intEnv(env, 'MAX_BUFFERED_BYTES', 16 * 1024 * 1024, { min: 4096, max: 512 * 1024 * 1024 }),
    allowedOrigins: csv(env.ALLOWED_ORIGINS),
    allowedHosts: csv(env.ALLOWED_HOSTS),
    requireOrigin: boolEnv(env, 'REQUIRE_ORIGIN', true),
    trustProxy: boolEnv(env, 'TRUST_PROXY', true),
    logLevel: (env.LOG_LEVEL || 'info').toLowerCase()
  };
}

module.exports = { parseConfig };
