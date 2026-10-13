import http from 'node:http';
import crypto from 'node:crypto';
import { AppError } from './errors.js';
import { parseCharacterRankingQuery, parseClanRankingQuery } from './validation.js';
import { notFound } from './service.js';

const RANKING_CACHE = 'public, max-age=30, stale-while-revalidate=60';
const OPENAPI_CACHE = 'public, max-age=300';

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

export function createHttpServer({ service, openApiDocument }) {
  return http.createServer(async (req, res) => {
    const id = requestId(req);
    try {
      const url = new URL(req.url, 'http://ranking-api.local');
      if (req.method !== 'GET') throw new AppError(405, 'METHOD_NOT_ALLOWED', 'Ranking API is read-only and accepts GET requests only');

      if (url.pathname === '/healthz') return sendJson(res, 200, await service.health(), { requestId: id });
      if (url.pathname === '/openapi.json') return sendJson(res, 200, openApiDocument, { requestId: id, cacheControl: OPENAPI_CACHE });
      if (url.pathname === '/v1/rankings/characters') {
        const body = await service.characterRanking(parseCharacterRankingQuery(url.searchParams));
        return sendJson(res, 200, body, { requestId: id, cacheControl: RANKING_CACHE });
      }
      if (url.pathname === '/v1/rankings/levels') {
        const body = await service.characterRanking(parseCharacterRankingQuery(url.searchParams, 'level'));
        return sendJson(res, 200, body, { requestId: id, cacheControl: RANKING_CACHE });
      }
      if (url.pathname === '/v1/rankings/national-points') {
        const body = await service.characterRanking(parseCharacterRankingQuery(url.searchParams, 'national_points'));
        return sendJson(res, 200, body, { requestId: id, cacheControl: RANKING_CACHE });
      }
      if (url.pathname === '/v1/rankings/clans') {
        const body = await service.clanRanking(parseClanRankingQuery(url.searchParams));
        return sendJson(res, 200, body, { requestId: id, cacheControl: RANKING_CACHE });
      }
      return notFound();
    } catch (error) {
      const status = error instanceof AppError ? error.status : 500;
      const code = error instanceof AppError ? error.code : 'INTERNAL_ERROR';
      const message = error instanceof AppError ? error.message : 'Internal server error';
      if (!(error instanceof AppError)) console.error(JSON.stringify({ event: 'ranking_request_error', requestId: id, error: error?.message }));
      return sendJson(res, status, { error: { code, message }, requestId: id }, { requestId: id });
    }
  });
}
