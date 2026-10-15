const DEFAULT_SENSITIVE_KEYS = new Set([
  'password', 'passwd', 'pwd', 'passwordhash', 'password_hash',
  'authorization', 'proxyauthorization', 'auth', 'authtoken', 'auth_token',
  'token', 'accesstoken', 'access_token', 'refreshtoken', 'refresh_token',
  'verificationtoken', 'verification_token', 'passwordresettoken', 'password_reset_token',
  'apikey', 'api_key', 'secret', 'clientsecret', 'client_secret',
  'deliverywebhooksecret', 'delivery_webhook_secret', 'tunneltoken', 'tunnel_token',
  'adminsessionsecret', 'admin_session_secret',
  'csrf', 'csrftoken', 'csrf_token', 'csrfvalue', 'csrf_value', 'xsrf', 'xsrftoken', 'xsrf_token',
  'cookie', 'setcookie', 'set_cookie', 'sessioncookie', 'session_cookie',
  'credential', 'credentials', 'databaseurl', 'database_url', 'dburl', 'db_url',
  'privatekey', 'private_key',
  'body', 'requestbody', 'request_body', 'responsebody', 'response_body',
  'payload', 'packet', 'rawpacket', 'raw_packet', 'packetraw', 'packet_raw',
  'packetpayload', 'packet_payload', 'rawpayload', 'raw_payload',
  'binarypayload', 'binary_payload'
]);

const SENSITIVE_NAME_PATTERN = '(?:password|passwd|pwd|authorization|proxy-authorization|auth(?:_?token)?|token|access_?token|refresh_?token|verification_?token|password_?reset_?token|api_?key|client_?secret|secret|delivery_?webhook_?secret|tunnel_?token|admin_?session_?secret|csrf(?:_?(?:token|value))?|xsrf(?:_?token)?|cookie|set-cookie|session_?cookie|database_?url|db_?url|private_?key)';

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

function redactCredentialsInUrls(text, replacement) {
  return text.replace(/\b([a-z][a-z0-9+.-]*:\/\/)([^\s/@:]+)(?::([^\s/@]*))?@/gi, (_m, scheme) => `${scheme}${replacement}:${replacement}@`);
}

export function sanitizeText(value, options = {}) {
  const { replacement = '[REDACTED]', maxStringLength = 4096 } = options;
  let text = String(value);

  text = redactCredentialsInUrls(text, replacement);
  text = text.replace(new RegExp(`(^|[\\r\\n])([ \\t]*)(Authorization|Proxy-Authorization|Cookie|Set-Cookie|X-CSRF-Token|X-XSRF-Token)([ \\t]*:[ \\t]*)([^\\r\\n]*)`, 'gim'), (_m, prefix, ws, name, sep) => `${prefix}${ws}${name}${sep}${replacement}`);
  text = text.replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, `Bearer ${replacement}`);

  const queryLike = new RegExp(`([?&;])(${SENSITIVE_NAME_PATTERN})(=)([^&#;\\s]*)`, 'gi');
  text = text.replace(queryLike, (_m, lead, name, eq) => `${lead}${name}${eq}${replacement}`);

  const assignmentLike = new RegExp(`(^|[\\s,{;])(["']?)(${SENSITIVE_NAME_PATTERN})\\2([ \\t]*[:=][ \\t]*)(["']?)([^"'\\s,;}\\r\\n]+)\\5`, 'gim');
  text = text.replace(assignmentLike, (_m, lead, quote, name, sep, valueQuote) => `${lead}${quote}${name}${quote}${sep}${valueQuote}${replacement}${valueQuote}`);

  if (text.length <= maxStringLength) return text;
  return `${text.slice(0, maxStringLength)}…[truncated:${text.length - maxStringLength}]`;
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
    if (typeof input === 'string') return sanitizeText(input, { replacement, maxStringLength });
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

export function containsForbiddenBytes(value, forbiddenValues = []) {
  const haystack = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
  return forbiddenValues.some((secret) => {
    if (secret === undefined || secret === null || String(secret).length === 0) return false;
    return haystack.includes(Buffer.from(String(secret)));
  });
}

export const SENSITIVE_LOG_FIELDS = Object.freeze([...DEFAULT_SENSITIVE_KEYS].sort());
