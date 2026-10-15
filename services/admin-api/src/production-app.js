'use strict';

const crypto = require('node:crypto');
const { createPersistentAuth } = require('./persistent-auth');

class HttpError extends Error {
  constructor(status, code, detail = code) { super(detail); this.status = status; this.code = code; }
}

function json(res, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(payload);
}

async function body(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 256 * 1024) throw new HttpError(413, 'BODY_TOO_LARGE'); chunks.push(chunk); }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'INVALID_JSON'); }
}

function reasonOf(input, fallback = '') {
  const reason = String(input?.reason || fallback).trim();
  if (reason.length < 5 || reason.length > 500) throw new HttpError(422, 'AUDIT_REASON_REQUIRED', 'reason must be 5-500 characters');
  return reason;
}

function expectedVersionOf(input) {
  const version = Number(input?.expectedVersion);
  if (!Number.isSafeInteger(version) || version < 1) throw new HttpError(428, 'EXPECTED_VERSION_REQUIRED', 'expectedVersion is required for CAS-protected mutations');
  return version;
}

function trustedOrigin(req, allowedOrigins) {
  const origin = String(req.headers.origin || '');
  return Boolean(origin && allowedOrigins.has(origin));
}

function createProductionAdminApi({ repository, runtimeAuthority, commandExecutor, users, rootOwnerId, sessionSecret, allowedOrigins = [], secureCookies = true } = {}) {
  const origins = new Set(allowedOrigins.map(String));
  if (!origins.size) throw new Error('At least one ADMIN_ALLOWED_ORIGIN is required');
  const auth = createPersistentAuth({ repository, users, rootOwnerId, sessionSecret, secureCookies });
  const capabilities = Object.freeze({
    reads: ['overview', 'players', 'character', 'inventory', 'inn', 'transactions', 'sanctions', 'items', 'audit'],
    mutations: ['character', 'stats', 'skills', 'item-moderation', 'sanctions'],
    commands: Object.freeze([...commandExecutor.supportedLegacyCommands]),
    unsupportedCommands: Object.freeze([...commandExecutor.unsupportedLegacyCommands]),
    commandStates: Object.freeze(['PENDING', 'SUCCEEDED', 'FAILED', 'UNSUPPORTED']),
    mutationConcurrency: 'expectedVersion/CAS',
    onlineAuthority: 'WS03/WS45 runtime adapter'
  });

  async function authenticate(req) {
    const authn = await auth.authenticateRequest(req);
    if (!authn) throw new HttpError(401, 'AUTH_REQUIRED');
    return authn;
  }

  function requirePermission(authn, permission) {
    if (!auth.hasPermission(authn.user, permission)) throw new HttpError(403, 'FORBIDDEN');
  }

  function requireUnsafeGuards(req, authn) {
    if (!trustedOrigin(req, origins)) throw new HttpError(403, 'ORIGIN_REJECTED');
    if (!auth.verifyCsrf(req, authn)) throw new HttpError(403, 'CSRF_REJECTED');
  }

  async function authoritativeOnlineMap() {
    const rows = await runtimeAuthority.listOnlineCharacters();
    const map = new Map();
    for (const row of rows || []) {
      if (typeof row === 'string') map.set(row.toLowerCase(), { name: row, online: true });
      else if (row?.name) map.set(String(row.name).toLowerCase(), { ...row, online: true });
    }
    return map;
  }

  async function characterEnvelope(name) {
    const persisted = await repository.getCharacter(name);
    if (!persisted) return null;
    const runtime = await runtimeAuthority.getCharacterState(name);
    return { ...persisted, online: Boolean(runtime?.online), runtime: runtime || null };
  }

  async function auditMutation({ req, authn, kind, targetType, targetId, reason, idempotencyKey, operation }) {
    if (!idempotencyKey || String(idempotencyKey).length < 8 || String(idempotencyKey).length > 128) throw new HttpError(428, 'IDEMPOTENCY_KEY_REQUIRED');
    const traceId = crypto.randomUUID();
    const result = await repository.runIdempotent({ key: String(idempotencyKey), actorId: authn.user.id, kind }, async () => {
      return repository.transaction(async () => {
        const value = await operation(traceId);
        await repository.appendAudit({ actorId: authn.user.id, actor: authn.user.username, action: kind, targetType, targetId, reason, requestId: traceId, sourceIp: req.socket?.remoteAddress || null, result: 'SUCCESS' });
        return { ok: true, traceId, value };
      });
    });
    return { ...result.value, idempotentReplay: result.replayed === true };
  }

  async function mutateCharacter({ req, authn, name, kind, patch, expectedVersion, reason, idempotencyKey }) {
    const runtime = await runtimeAuthority.getCharacterState(name);
    if (runtime?.online) {
      const traceId = crypto.randomUUID();
      const result = await repository.runIdempotent({ key: String(idempotencyKey), actorId: authn.user.id, kind }, async () => {
        const value = await runtimeAuthority.mutateOnlineCharacter({ name, kind, patch, expectedVersion, operationId: traceId, actorId: authn.user.id, reason });
        await repository.appendAudit({ actorId: authn.user.id, actor: authn.user.username, action: kind, targetType: 'character', targetId: name, reason, requestId: traceId, sourceIp: req.socket?.remoteAddress || null, result: 'SUCCESS', authority: 'runtime' });
        return { ok: true, traceId, value };
      });
      return { ...result.value, idempotentReplay: result.replayed === true };
    }
    const method = kind === 'CHARACTER_EDIT' ? 'updateCharacter' : kind === 'STATS_EDIT' ? 'updateStats' : 'updateSkills';
    return auditMutation({ req, authn, kind, targetType: 'character', targetId: name, reason, idempotencyKey, operation: async () => {
      const value = await repository[method](name, patch, { expectedVersion });
      if (!value) throw new HttpError(404, 'CHARACTER_NOT_FOUND');
      return value;
    } });
  }

  async function handler(req, res) {
    const url = new URL(req.url, 'http://admin.internal');
    const path = url.pathname;
    if (!path.startsWith('/api/admin')) return json(res, 404, { ok: false, error: 'NOT_FOUND' });
    const route = path.slice('/api/admin'.length) || '/';
    try {
      if (req.method === 'GET' && route === '/health') return json(res, 200, { ok: true, service: 'admin-api', mode: 'production', persistence: 'required', runtimeAuthority: 'required' });

      if (req.method === 'POST' && route === '/session/login') {
        if (!trustedOrigin(req, origins)) throw new HttpError(403, 'ORIGIN_REJECTED');
        const input = await body(req);
        const login = await auth.login(input.user, input.password, { sourceIp: req.socket?.remoteAddress || null, userAgent: req.headers['user-agent'] || null });
        if (!login) throw new HttpError(401, 'INVALID_CREDENTIALS');
        return json(res, 200, { ok: true, user: { id: login.user.id, username: login.user.username, roles: login.user.roles, permissions: login.user.permissions }, csrfToken: login.csrfToken, capabilities }, { 'set-cookie': login.cookies });
      }

      const authn = await authenticate(req);

      if (req.method === 'GET' && route === '/session') return json(res, 200, { ok: true, user: { id: authn.user.id, username: authn.user.username, roles: authn.user.roles, permissions: authn.user.permissions }, csrfToken: authn.csrfCookie, capabilities });
      if (req.method === 'POST' && route === '/session/logout') { requireUnsafeGuards(req, authn); await auth.logout(authn); return json(res, 200, { ok: true }, { 'set-cookie': auth.clearCookies() }); }
      if (req.method === 'GET' && route === '/capabilities') return json(res, 200, { ok: true, capabilities });

      if (req.method === 'GET' && route === '/overview') {
        requirePermission(authn, 'players:read');
        const [persisted, online] = await Promise.all([repository.overview(), authoritativeOnlineMap()]);
        return json(res, 200, { ok: true, overview: { ...persisted, online: online.size } });
      }

      if (req.method === 'GET' && route === '/players') {
        requirePermission(authn, 'players:read');
        const q = url.searchParams.get('q') || ''; const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get('limit') || 100)));
        const [rows, online] = await Promise.all([repository.listPlayers({ q, limit: 1000 }), authoritativeOnlineMap()]);
        let players = rows.map((p) => ({ ...p, online: online.has(String(p.name).toLowerCase()), runtime: online.get(String(p.name).toLowerCase()) || null }));
        if (url.searchParams.get('online') === '1') players = players.filter((p) => p.online);
        return json(res, 200, { ok: true, players: players.slice(0, limit) });
      }

      let m = route.match(/^\/characters\/([^/]+)$/);
      if (m && req.method === 'GET') { requirePermission(authn, 'characters:read'); const character = await characterEnvelope(decodeURIComponent(m[1])); if (!character) throw new HttpError(404, 'CHARACTER_NOT_FOUND'); return json(res, 200, { ok: true, character }); }
      if (m && req.method === 'PATCH') {
        requirePermission(authn, 'characters:write'); requireUnsafeGuards(req, authn); const input = await body(req); const reason = reasonOf(input); const expectedVersion = expectedVersionOf(input); const { reason: _r, expectedVersion: _v, actor: _a, authority: _au, ...patch } = input;
        if ('level' in patch && (!Number.isInteger(patch.level) || patch.level < 1 || patch.level > 83)) throw new HttpError(422, 'INVALID_LEVEL');
        const result = await mutateCharacter({ req, authn, name: decodeURIComponent(m[1]), kind: 'CHARACTER_EDIT', patch, expectedVersion, reason, idempotencyKey: req.headers['idempotency-key'] }); return json(res, 200, result);
      }

      m = route.match(/^\/characters\/([^/]+)\/(stats|skills)$/);
      if (m && req.method === 'PATCH') {
        requirePermission(authn, 'characters:write'); requireUnsafeGuards(req, authn); const input = await body(req); const reason = reasonOf(input); const expectedVersion = expectedVersionOf(input); const { reason: _r, expectedVersion: _v, actor: _a, authority: _au, ...patch } = input;
        const kind = m[2] === 'stats' ? 'STATS_EDIT' : 'SKILLS_EDIT'; const result = await mutateCharacter({ req, authn, name: decodeURIComponent(m[1]), kind, patch, expectedVersion, reason, idempotencyKey: req.headers['idempotency-key'] }); return json(res, 200, result);
      }

      m = route.match(/^\/characters\/([^/]+)\/(inventory|inn|transactions|sanctions)$/);
      if (m && req.method === 'GET') {
        requirePermission(authn, 'characters:read'); const name = decodeURIComponent(m[1]); const methods = { inventory: 'getInventory', inn: 'getInn', transactions: 'getTransactions', sanctions: 'getSanctions' }; const value = await repository[methods[m[2]]](name); return json(res, 200, { ok: true, [m[2]]: value });
      }

      if (req.method === 'GET' && route === '/items/duplicates') { requirePermission(authn, 'items:read'); return json(res, 200, { ok: true, ...(await repository.findDuplicateSerials()) }); }
      if (req.method === 'GET' && route === '/items/search') { requirePermission(authn, 'items:read'); return json(res, 200, { ok: true, items: await repository.searchItems(url.searchParams.get('q') || '') }); }
      m = route.match(/^\/items\/([^/]+)\/history$/);
      if (m && req.method === 'GET') { requirePermission(authn, 'items:read'); return json(res, 200, { ok: true, entries: await repository.itemHistory(decodeURIComponent(m[1])) }); }
      m = route.match(/^\/items\/([^/]+)$/);
      if (m && req.method === 'POST') {
        requirePermission(authn, 'items:write'); requireUnsafeGuards(req, authn); const input = await body(req); const reason = reasonOf(input); const expectedVersion = expectedVersionOf(input); const serial = decodeURIComponent(m[1]);
        const result = await auditMutation({ req, authn, kind: 'ITEM_ACTION', targetType: 'item', targetId: serial, reason, idempotencyKey: req.headers['idempotency-key'], operation: async () => { const value = await repository.itemAction(serial, { action: input.action }, { expectedVersion }); if (!value) throw new HttpError(404, 'ITEM_NOT_FOUND'); return value; } }); return json(res, 200, result);
      }

      if (req.method === 'POST' && route === '/sanctions') {
        requirePermission(authn, 'sanctions:write'); requireUnsafeGuards(req, authn); const input = await body(req); const reason = reasonOf(input); const type = String(input.type || 'ACCOUNT').toUpperCase(); if (!['ACCOUNT', 'IP'].includes(type)) throw new HttpError(422, 'INVALID_SANCTION_TYPE');
        const result = await auditMutation({ req, authn, kind: `${type}_BAN`, targetType: 'character', targetId: input.character, reason, idempotencyKey: req.headers['idempotency-key'], operation: async (traceId) => { const value = await repository.createSanction({ character: input.character, type, reason, actor: authn.user.id, traceId }); if (!value) throw new HttpError(404, 'CHARACTER_NOT_FOUND'); return value; } }); return json(res, 201, result);
      }
      m = route.match(/^\/sanctions\/([^/]+)$/);
      if (m && req.method === 'DELETE') {
        requirePermission(authn, 'sanctions:write'); requireUnsafeGuards(req, authn); const input = await body(req); const reason = reasonOf(input); const name = decodeURIComponent(m[1]); const type = String(url.searchParams.get('type') || input.type || '').toUpperCase();
        const result = await auditMutation({ req, authn, kind: 'SANCTION_REVOKE', targetType: 'character', targetId: name, reason, idempotencyKey: req.headers['idempotency-key'], operation: async () => { const value = await repository.removeSanction({ character: name, type }); if (!value) throw new HttpError(404, 'CHARACTER_NOT_FOUND'); return value; } }); return json(res, 200, result);
      }

      if (req.method === 'POST' && route === '/commands') {
        requirePermission(authn, 'commands:execute'); requireUnsafeGuards(req, authn); const input = await body(req); const reason = reasonOf(input); const outcome = await commandExecutor.executeLegacy({ actor: { id: authn.user.id, username: authn.user.username, roles: authn.user.roles, sessionId: authn.session.id }, command: input.command, target: input.target, arg: input.arg, zoneId: input.zoneId, durationSeconds: input.durationSeconds, reason, idempotencyKey: req.headers['idempotency-key'], metadata: { sourceIp: req.socket?.remoteAddress || '' } }); return json(res, outcome.httpStatus, { ok: outcome.result.status === 'SUCCEEDED', command: outcome.command, game: outcome.result });
      }
      m = route.match(/^\/commands\/([^/]+)$/);
      if (m && req.method === 'GET') { requirePermission(authn, 'commands:execute'); const command = await repository.getCommand(decodeURIComponent(m[1])); if (!command) throw new HttpError(404, 'COMMAND_NOT_FOUND'); return json(res, 200, { ok: true, command }); }

      if (req.method === 'GET' && route === '/audit') { requirePermission(authn, 'audit:read'); const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit') || 100))); return json(res, 200, { ok: true, entries: await repository.listAudit(limit) }); }
      return json(res, 404, { ok: false, error: 'NOT_FOUND' });
    } catch (error) {
      if (error?.code === 'VERSION_CONFLICT') return json(res, 409, { ok: false, error: 'VERSION_CONFLICT', detail: error.message });
      if (error instanceof HttpError) return json(res, error.status, { ok: false, error: error.code, detail: error.message });
      console.error('admin-api production error', error);
      return json(res, 500, { ok: false, error: 'INTERNAL_ERROR' });
    }
  }

  return { handler, capabilities };
}

module.exports = { createProductionAdminApi, HttpError };
