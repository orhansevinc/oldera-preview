import http from 'node:http';
import crypto from 'node:crypto';
import { AppError } from './errors.js';

const MAX_BODY = 32 * 1024;
const SESSION_COOKIE = 'oldko_session';
const PUBLIC_PREFIX = '/api/account';

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

function readCookie(req, name) {
  const raw = req.headers.cookie;
  if (typeof raw !== 'string') return null;
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    if (key !== name) continue;
    try { return decodeURIComponent(part.slice(idx + 1).trim()); } catch { return null; }
  }
  return null;
}

function sessionCookie(token, expiresAt) {
  const maxAge = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
}

function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Strict`;
}

function assertTrustedOrigin(req, allowedOrigins) {
  const origin = req.headers.origin;
  if (typeof origin !== 'string' || !allowedOrigins.includes(origin)) throw new AppError(403, 'ORIGIN_NOT_ALLOWED', 'Origin is not allowed');
}

function upstreamPath(pathname) {
  if (pathname === PUBLIC_PREFIX) return '/';
  if (pathname.startsWith(`${PUBLIC_PREFIX}/`)) return pathname.slice(PUBLIC_PREFIX.length);
  return pathname;
}

export function createHttpServer({ service, openApiDocument, trustProxy = false, allowedOrigins = [], readinessCheck = async () => true }) {
  return http.createServer(async (req, res) => {
    const requestId = (typeof req.headers['x-request-id'] === 'string' && /^[A-Za-z0-9._-]{8,128}$/.test(req.headers['x-request-id']))
      ? req.headers['x-request-id'] : crypto.randomUUID();
    const origin = req.headers.origin;
    const cors = origin && allowedOrigins.includes(origin)
      ? { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', vary: 'Origin' }
      : {};
    const context = {
      requestId,
      ip: clientIp(req, trustProxy),
      userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'].slice(0, 512) : null
    };

    try {
      if (req.method === 'OPTIONS') {
        if (!origin || !allowedOrigins.includes(origin)) throw new AppError(403, 'ORIGIN_NOT_ALLOWED', 'Origin is not allowed');
        res.writeHead(204, { ...cors, 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type,x-request-id', 'access-control-max-age': '600' });
        return res.end();
      }

      const url = new URL(req.url, 'http://account-api.local');
      const pathname = upstreamPath(url.pathname);
      if (req.method === 'GET' && pathname === '/healthz') return send(res, 200, { ok: true, service: 'oldko-account-api' }, { ...cors, 'x-request-id': requestId });
      if (req.method === 'GET' && pathname === '/readyz') {
        try {
          await readinessCheck();
          return send(res, 200, { ok: true, service: 'oldko-account-api' }, { ...cors, 'x-request-id': requestId });
        } catch {
          return send(res, 503, { ok: false, service: 'oldko-account-api' }, { ...cors, 'x-request-id': requestId });
        }
      }
      if (req.method === 'GET' && pathname === '/openapi.json') return send(res, 200, openApiDocument, { ...cors, 'x-request-id': requestId });
      if (req.method === 'GET' && pathname === '/v1/accounts/username/availability') {
        const result = await service.usernameAvailability(url.searchParams.get('username'), context);
        return send(res, 200, result, { ...cors, 'x-request-id': requestId });
      }
      if (req.method === 'GET' && pathname === '/v1/session/current') {
        const result = await service.currentUser(readCookie(req, SESSION_COOKIE), context);
        return send(res, 200, result, { ...cors, 'x-request-id': requestId });
      }
      if (req.method === 'POST' && pathname === '/v1/session/login') {
        assertTrustedOrigin(req, allowedOrigins);
        const result = await service.login(await readJson(req), context);
        return send(res, 200, { user: result.user, credentialUpgradeRequired: result.credentialUpgradeRequired }, { ...cors, 'x-request-id': requestId, 'set-cookie': sessionCookie(result.token, result.expiresAt) });
      }
      if (req.method === 'POST' && pathname === '/v1/session/logout') {
        assertTrustedOrigin(req, allowedOrigins);
        const result = await service.logout(readCookie(req, SESSION_COOKIE), context);
        return send(res, 200, result, { ...cors, 'x-request-id': requestId, 'set-cookie': clearSessionCookie() });
      }

      const routes = new Map([
        ['/v1/accounts/register', { browser: true, handler: (body) => service.register(body, context) }],
        ['/v1/accounts/access-check', { browser: false, handler: (body) => service.accessCheck(body, context) }],
        ['/v1/password/change', { browser: true, handler: (body) => service.changePassword(body, context) }],
        ['/v1/password-reset/request', { browser: true, handler: (body) => service.requestPasswordReset(body, context) }],
        ['/v1/password-reset/confirm', { browser: true, handler: (body) => service.confirmPasswordReset(body, context) }],
        ['/v1/accounts/password/change', { browser: true, handler: (body) => service.changePassword(body, context) }],
        ['/v1/accounts/password-reset/request', { browser: true, handler: (body) => service.requestPasswordReset(body, context) }],
        ['/v1/accounts/password-reset/confirm', { browser: true, handler: (body) => service.confirmPasswordReset(body, context) }],
        ['/v1/accounts/verification/request', { browser: true, handler: (body) => service.requestVerification(body, context) }],
        ['/v1/accounts/verification/confirm', { browser: true, handler: (body) => service.confirmVerification(body, context) }]
      ]);
      if (req.method === 'POST' && routes.has(pathname)) {
        const route = routes.get(pathname);
        if (route.browser) assertTrustedOrigin(req, allowedOrigins);
        const result = await route.handler(await readJson(req));
        const status = pathname.endsWith('/request') ? 202 : (pathname === '/v1/accounts/register' ? 201 : 200);
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
