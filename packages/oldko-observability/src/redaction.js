const DEFAULT_SENSITIVE_KEYS = new Set([
  'password', 'passwd', 'pwd', 'passwordhash', 'password_hash',
  'authorization', 'proxyauthorization', 'auth', 'authtoken', 'auth_token',
  'token', 'accesstoken', 'access_token', 'refreshtoken', 'refresh_token',
  'apikey', 'api_key', 'secret', 'clientsecret', 'client_secret',
  'cookie', 'setcookie', 'set_cookie', 'sessioncookie', 'session_cookie',
  'credential', 'credentials', 'privatekey', 'private_key',
  'body', 'requestbody', 'request_body', 'responsebody', 'response_body',
  'payload', 'packet', 'rawpacket', 'raw_packet', 'packetraw', 'packet_raw',
  'packetpayload', 'packet_payload', 'rawpayload', 'raw_payload',
  'binarypayload', 'binary_payload'
]);

function canonicalKey(key) {
  return String(key).toLowerCase().replace(/[^a-z0-9_]/g, '');
}

function isSensitiveKey(key, sensitiveKeys) {
  const canonical = canonicalKey(key);
  if (sensitiveKeys.has(canonical)) return true;
  return canonical.endsWith('password') || canonical.endsWith('_password') ||
    canonical.endsWith('token') || canonical.endsWith('_token') ||
    canonical.endsWith('secret') || canonical.endsWith('_secret');
}

function sanitizeString(value, maxStringLength) {
  if (value.length <= maxStringLength) return value;
  return `${value.slice(0, maxStringLength)}…[truncated:${value.length - maxStringLength}]`;
}

export function redact(value, options = {}) {
  const {
    replacement = '[REDACTED]',
    maxDepth = 8,
    maxStringLength = 4096,
    sensitiveKeys: extraSensitiveKeys = []
  } = options;

  const sensitiveKeys = new Set(DEFAULT_SENSITIVE_KEYS);
  for (const key of extraSensitiveKeys) sensitiveKeys.add(canonicalKey(key));

  const seen = new WeakSet();

  function visit(input, depth, key) {
    if (key !== undefined && isSensitiveKey(key, sensitiveKeys)) return replacement;
    if (input === null || input === undefined) return input;
    if (typeof input === 'string') return sanitizeString(input, maxStringLength);
    if (typeof input === 'number' || typeof input === 'boolean') return input;
    if (typeof input === 'bigint') return input.toString();
    if (typeof input === 'function') return `[Function:${input.name || 'anonymous'}]`;
    if (typeof input === 'symbol') return input.toString();
    if (Buffer.isBuffer(input) || ArrayBuffer.isView(input) || input instanceof ArrayBuffer) {
      return '[REDACTED_BINARY]';
    }
    if (depth >= maxDepth) return '[MAX_DEPTH]';
    if (input instanceof Date) return input.toISOString();
    if (input instanceof Error) {
      return visit({
        name: input.name,
        message: input.message,
        stack: input.stack,
        ...(input.code !== undefined ? { code: input.code } : {})
      }, depth + 1);
    }
    if (typeof input !== 'object') return String(input);
    if (seen.has(input)) return '[CIRCULAR]';

    seen.add(input);
    if (Array.isArray(input)) {
      const result = input.map((item) => visit(item, depth + 1));
      seen.delete(input);
      return result;
    }

    const result = {};
    for (const [childKey, childValue] of Object.entries(input)) {
      result[childKey] = visit(childValue, depth + 1, childKey);
    }
    seen.delete(input);
    return result;
  }

  return visit(value, 0);
}

export const SENSITIVE_LOG_FIELDS = Object.freeze([...DEFAULT_SENSITIVE_KEYS].sort());
