import http from 'node:http';
import crypto from 'node:crypto';
import { AppError } from './errors.js';
import { notFound } from './service.js';

export const DIRECTORY_CACHE = 'public, max-age=15, stale-while-revalidate=30';
export const REALM_CACHE = 'public, max-age=10, stale-while-revalidate=20';
export const OPENAPI_CACHE = 'public, max-age=300';

function sendHead(res, status, { requestId, cacheControl = 'no-store' } = {}) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': cacheControl,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    ...(requestId ? { 'x-request-id': requestId } : {})
  });
  res.end();
}

function sendJson(res, status, body, { requestId, cacheControl = 'no-store' } = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': cacheControl,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    ...(requestId ? { 'x-request-id': requestId } : {})
  });
  res.end(payload);
}

function requestId(req) {
  const supplied = req.headers['x-request-id'];
  return typeof supplied === 'string' && /^[A-Za-z0-9._-]{8,128}$/.test(supplied) ? supplied : crypto.randomUUID();
}

function routeRealmId(pathname) {
  const match = /^\/v1\/realms\/([^/]+)$/.exec(pathname);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    throw new AppError(400, 'INVALID_REALM_ID', 'Realm ID is invalid');
  }
}

export function createHttpServer({ service, openApiDocument }) {
  if (!service) throw new TypeError('service is required');
  if (!openApiDocument) throw new TypeError('openApiDocument is required');

  return http.createServer(async (req, res) => {
    const id = requestId(req);
    try {
      const url = new URL(req.url, 'http://server-status-api.local');
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        throw new AppError(405, 'METHOD_NOT_ALLOWED', 'Server Status API is read-only and accepts GET/HEAD requests only');
      }

      let status = 200;
      let body;
      let cacheControl = 'no-store';

      if (url.pathname === '/healthz') {
        body = await service.health();
      } else if (url.pathname === '/openapi.json') {
        body = openApiDocument;
        cacheControl = OPENAPI_CACHE;
      } else if (url.pathname === '/v1/realms') {
        body = await service.listRealms();
        cacheControl = DIRECTORY_CACHE;
      } else {
        const realmId = routeRealmId(url.pathname);
        if (realmId !== null) {
          body = await service.getRealm(realmId);
          cacheControl = REALM_CACHE;
        } else {
          return notFound();
        }
      }

      if (req.method === 'HEAD') return sendHead(res, status, { requestId: id, cacheControl });
      return sendJson(res, status, body, { requestId: id, cacheControl });
    } catch (error) {
      const status = error instanceof AppError ? error.status : 500;
      const code = error instanceof AppError ? error.code : 'INTERNAL_ERROR';
      const message = error instanceof AppError ? error.message : 'Internal server error';
      if (!(error instanceof AppError)) {
        console.error(JSON.stringify({ event: 'server_status_request_error', requestId: id, error: error?.message }));
      }
      if (req.method === 'HEAD') return sendHead(res, status, { requestId: id });
      return sendJson(res, status, { error: { code, message }, requestId: id }, { requestId: id });
    }
  });
}
