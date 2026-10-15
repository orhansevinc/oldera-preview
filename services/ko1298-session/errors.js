'use strict';

const ERROR_CATEGORY = Object.freeze({
  MALFORMED_PACKET: 'MALFORMED_PACKET',
  WRONG_STATE: 'WRONG_STATE',
  AUTHENTICATION: 'AUTHENTICATION',
  OWNERSHIP: 'OWNERSHIP',
  DOWNSTREAM: 'DOWNSTREAM',
  BACKPRESSURE: 'BACKPRESSURE',
  TRANSPORT: 'TRANSPORT',
  INTERNAL: 'INTERNAL',
});

class SessionError extends Error {
  constructor(code, message, {
    category = ERROR_CATEGORY.INTERNAL,
    fatal = false,
    details = {},
    cause = undefined,
  } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'SessionError';
    this.code = code;
    this.category = category;
    this.fatal = Boolean(fatal);
    this.details = { ...details };
  }
}

function classifyError(error, fallbackCode = 'INTERNAL_ERROR') {
  if (error instanceof SessionError) return error;
  return new SessionError(fallbackCode, error?.message || String(error), {
    category: ERROR_CATEGORY.INTERNAL,
    fatal: true,
    cause: error,
  });
}

function safeErrorMetadata(error) {
  const classified = classifyError(error);
  return {
    name: classified.name,
    code: classified.code,
    category: classified.category,
    fatal: classified.fatal,
    message: classified.message,
    details: sanitizeDetails(classified.details),
  };
}

function sanitizeDetails(details) {
  const safe = {};
  const denied = /(password|secret|token|credential|payload|body|key)/i;
  for (const [key, value] of Object.entries(details || {})) {
    if (denied.test(key)) continue;
    if (Buffer.isBuffer(value)) {
      safe[`${key}Length`] = value.length;
      continue;
    }
    if (['string', 'number', 'boolean'].includes(typeof value) || value === null) safe[key] = value;
  }
  return safe;
}

module.exports = { ERROR_CATEGORY, SessionError, classifyError, safeErrorMetadata };
