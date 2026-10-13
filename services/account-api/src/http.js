import http from 'node:http';
import crypto from 'node:crypto';
import { AppError } from './errors.js';

const MAX_BODY = 32 * 1024;

async function readJson(req) {
  const type = req.headers['content-type'] || '';
  if (!type.toLowerCase().startsWith('application/json')) throw new AppError(415, 'JSON_REQUIRED', 'Content-Type must be application/json');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new AppError(413, 'BODY_TOO_LARGE', 'Request body is too large');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw new AppError(400, 'INVALID_JSON', 'Request body is not valid JSON'); }
}

function send(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    ...extraHeaders
  });
  res.end(payload);
}

function clientIp(req, trustProxy) {
  if (trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') return forwarded.split(',')[0].trim().slice(0, 64);
  }
  return req.socket.remoteAddress || 'unknown';
}

export function createHttpServer({ service, openApiDocument, trustProxy = false, allowedOrigins = [] }) {
  return http.createServer(async (req, res) => {
    const requestId = (typeof req.headers['x-request-id'] === 'string' && /^[A-Za-z0-9._-]{8,128}$/.test(req.headers['x-request-id']))
      ? req.headers['x-request-id'] : crypto.randomUUID();
    const origin = req.headers.origin;
    const cors = origin && allowedOrigins.includes(origin) ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {};
    const context = { requestId, ip: clientIp(req, trustProxy) };

    try {
      if (req.method === 'OPTIONS') {
        if (!origin || !allowedOrigins.includes(origin)) throw new AppError(403, 'ORIGIN_NOT_ALLOWED', 'Origin is not allowed');
        res.writeHead(204, { ...cors, 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type,x-request-id', 'access-control-max-age': '600' });
        return res.end();
      }

      const url = new URL(req.url, 'http://account-api.local');
      if (req.method === 'GET' && url.pathname === '/healthz') return send(res, 200, { ok: true, service: 'oldko-account-api' }, { ...cors, 'x-request-id': requestId });
      if (req.method === 'GET' && url.pathname === '/openapi.json') return send(res, 200, openApiDocument, { ...cors, 'x-request-id': requestId });
      if (req.method === 'GET' && url.pathname === '/v1/accounts/username/availability') {
        const result = await service.usernameAvailability(url.searchParams.get('username'), context);
        return send(res, 200, result, { ...cors, 'x-request-id': requestId });
      }

      const routes = new Map([
        ['/v1/accounts/register', (body) => service.register(body, context)],
        ['/v1/accounts/access-check', (body) => service.accessCheck(body, context)],
        ['/v1/accounts/password/change', (body) => service.changePassword(body, context)],
        ['/v1/accounts/password-reset/request', (body) => service.requestPasswordReset(body, context)],
        ['/v1/accounts/password-reset/confirm', (body) => service.confirmPasswordReset(body, context)],
        ['/v1/accounts/verification/request', (body) => service.requestVerification(body, context)],
        ['/v1/accounts/verification/confirm', (body) => service.confirmVerification(body, context)]
      ]);
      if (req.method === 'POST' && routes.has(url.pathname)) {
        const result = await routes.get(url.pathname)(await readJson(req));
        const status = url.pathname.endsWith('/request') ? 202 : (url.pathname === '/v1/accounts/register' ? 201 : 200);
        return send(res, status, result, { ...cors, 'x-request-id': requestId });
      }
      throw new AppError(404, 'NOT_FOUND', 'Endpoint not found');
    } catch (error) {
      const status = error instanceof AppError ? error.status : 500;
      const code = error instanceof AppError ? error.code : 'INTERNAL_ERROR';
      const message = error instanceof AppError ? error.message : 'Internal server error';
      const headers = { ...cors, 'x-request-id': requestId };
      if (status === 429 && error.details?.retryAfterSeconds) headers['retry-after'] = String(error.details.retryAfterSeconds);
      if (!(error instanceof AppError)) console.error(JSON.stringify({ event: 'request_error', requestId, error: error?.message }));
      return send(res, status, { error: { code, message, ...(error instanceof AppError && error.details ? { details: error.details } : {}) }, requestId }, headers);
    }
  });
}
