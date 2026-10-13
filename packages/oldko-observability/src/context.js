import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

const storage = new AsyncLocalStorage();
const ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

function normalizeId(value) {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return ID_PATTERN.test(text) ? text : undefined;
}

export function createRequestContext(input = {}) {
  const requestId = normalizeId(input.requestId) ?? randomUUID();
  const correlationId = normalizeId(input.correlationId) ?? requestId;
  const sessionId = normalizeId(input.sessionId);

  return Object.freeze({
    correlationId,
    requestId,
    ...(sessionId ? { sessionId } : {})
  });
}

function readHeader(headers, name) {
  if (!headers) return undefined;
  if (typeof headers.get === 'function') return headers.get(name) ?? undefined;

  const direct = headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];
  if (Array.isArray(direct)) return direct[0];
  return direct;
}

export function contextFromHeaders(headers, { sessionId } = {}) {
  return createRequestContext({
    correlationId: readHeader(headers, 'x-correlation-id'),
    requestId: readHeader(headers, 'x-request-id'),
    sessionId: sessionId ?? readHeader(headers, 'x-session-id')
  });
}

export function runWithContext(context, fn) {
  const normalized = createRequestContext(context);
  return storage.run(normalized, fn);
}

export function getContext() {
  return storage.getStore();
}

export function withSessionId(sessionId, fn) {
  const current = storage.getStore() ?? createRequestContext();
  return runWithContext({ ...current, sessionId }, fn);
}

export function contextLogFields(context = storage.getStore()) {
  if (!context) return {};
  return {
    correlation_id: context.correlationId,
    request_id: context.requestId,
    ...(context.sessionId ? { session_id: context.sessionId } : {})
  };
}

export function responseContextHeaders(context = storage.getStore()) {
  if (!context) return {};
  return {
    'x-correlation-id': context.correlationId,
    'x-request-id': context.requestId
  };
}
