'use strict';

const crypto = require('node:crypto');
const { createAuthService, hasPermission } = require('./security');
const { assertRepository } = require('./repository');

const COMMANDS = new Map([
  ['INVISIBLE', { targetRequired: false, risk: 'medium' }], ['CLEAN', { targetRequired: false, risk: 'high' }], ['RAINING', { targetRequired: false, risk: 'low' }], ['SNOWING', { targetRequired: false, risk: 'low' }], ['TIME', { targetRequired: false, risk: 'low' }], ['COUNT', { targetRequired: false, risk: 'low' }], ['NOTICE', { targetRequired: false, risk: 'low' }], ['ARREST', { targetRequired: true, risk: 'medium' }], ['FORBIDCONNECT', { targetRequired: true, risk: 'high' }], ['FORBIDCHAT', { targetRequired: true, risk: 'medium' }], ['PERMITCHAT', { targetRequired: true, risk: 'medium' }], ['NOTICEALL', { targetRequired: false, risk: 'low' }], ['CUTOFF', { targetRequired: true, risk: 'medium' }], ['VIEW', { targetRequired: true, risk: 'medium' }], ['UNVIEW', { targetRequired: false, risk: 'low' }], ['FORBIDUSER', { targetRequired: true, risk: 'high' }], ['SUMMONUSER', { targetRequired: true, risk: 'medium' }], ['ATTACKDISABLE', { targetRequired: false, risk: 'critical' }], ['ATTACKENABLE', { targetRequired: false, risk: 'critical' }], ['PROGRAMLISTCHECK', { targetRequired: false, risk: 'medium' }]
]);

const ZONES = new Set(['Moradon', 'Colony Zone', 'El Morad Castle', 'Luferson']);
const ITEM_ACTIONS = new Set(['FLAG', 'QUARANTINE', 'CLEAR_FLAG']);

class HttpError extends Error { constructor(status, message, detail) { super(message); this.status = status; this.detail = detail; } }
function fail(status, message, detail) { throw new HttpError(status, message, detail); }
function json(res, status, body, headers = {}) { const payload = JSON.stringify(body); res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers }); res.end(payload); }
function routeMatch(pathname, pattern) { const keys = []; const source = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:([A-Za-z0-9_]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }); const match = pathname.match(new RegExp(`^${source}$`)); if (!match) return null; return Object.fromEntries(keys.map((key, i) => [key, decodeURIComponent(match[i + 1])])); }
function int(value, field, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) { const n = Number(value); if (!Number.isInteger(n) || n < min || n > max) fail(422, 'VALIDATION_ERROR', `${field} must be an integer between ${min} and ${max}`); return n; }
function text(value, field, { min = 1, max = 500 } = {}) { const s = String(value ?? '').trim(); if (s.length < min || s.length > max) fail(422, 'VALIDATION_ERROR', `${field} length must be ${min}-${max}`); return s; }
async function body(req) { if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return {}; const chunks = []; let size = 0; for await (const chunk of req) { size += chunk.length; if (size > 64 * 1024) fail(413, 'BODY_TOO_LARGE'); chunks.push(chunk); } if (!chunks.length) return {}; const contentType = String(req.headers['content-type'] || ''); if (!contentType.includes('application/json')) fail(415, 'JSON_REQUIRED'); try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail(400, 'INVALID_JSON'); } }

function createAdminApi({ repository, users, sessionSecret, secureCookies = false }) {
  const repo = assertRepository(repository);
  const auth = createAuthService({ users, sessionSecret, secureCookies });
  const idempotency = new Map();

  function requireAuth(req) { const user = auth.authenticateRequest(req); if (!user) fail(401, 'AUTH_REQUIRED'); return user; }
  function requirePermission(user, permission) { if (!hasPermission(user, permission)) fail(403, 'FORBIDDEN', `Missing permission: ${permission}`); }
  function auditReason(payload, fallback = '') { const reason = String(payload?.reason || fallback || '').trim(); if (!reason) fail(422, 'AUDIT_REASON_REQUIRED'); if (reason.length > 500) fail(422, 'VALIDATION_ERROR', 'reason is too long'); return reason; }
  function traceId(req) { return String(req.headers['x-trace-id'] || `ADM-${crypto.randomUUID()}`); }
  function source(req, payload) { return String(payload?.source || req.headers['x-admin-source'] || 'oldko-admin-api').slice(0, 80); }

  async function mutate(req, user, action, target, reason, operation) {
    const key = String(req.headers['idempotency-key'] || '').trim();
    if (key && idempotency.has(`${user.id}:${key}`)) return idempotency.get(`${user.id}:${key}`);
    const trace = traceId(req);
    const result = await repo.transaction(async (tx) => {
      const value = await operation(tx, trace);
      await tx.appendAudit({ actor: user.username, actorId: user.id, roles: user.roles, action, target, reason, source: 'oldko-admin-api', traceId: trace, result: 'SUCCESS' });
      return { ok: true, traceId: trace, ...value };
    });
    if (key) idempotency.set(`${user.id}:${key}`, result);
    return result;
  }

  async function handler(req, res) {
    try {
      const url = new URL(req.url, 'http://admin.local');
      if (!url.pathname.startsWith('/api/admin')) return json(res, 404, { ok: false, error: 'NOT_FOUND' });
      const path = url.pathname.slice('/api/admin'.length) || '/';

      if (req.method === 'GET' && path === '/health') return json(res, 200, { ok: true, service: 'oldkoweb-admin-api', version: 1, db: repository.constructor?.name || 'repository' });

      if (req.method === 'POST' && path === '/session/login') {
        const payload = await body(req); const logged = auth.login(payload.user, payload.password); if (!logged) fail(401, 'INVALID_CREDENTIALS');
        return json(res, 200, { ok: true, user: { username: logged.user.username, roles: logged.user.roles, permissions: logged.user.permissions } }, { 'set-cookie': auth.cookie(logged.token) });
      }
      if (req.method === 'POST' && path === '/session/logout') return json(res, 200, { ok: true }, { 'set-cookie': auth.clearCookie() });
      if (req.method === 'GET' && path === '/session') { const user = requireAuth(req); return json(res, 200, { ok: true, user: { username: user.username, roles: user.roles, permissions: user.permissions } }); }

      const user = requireAuth(req);

      if (req.method === 'GET' && path === '/overview') { requirePermission(user, 'players:read'); return json(res, 200, await repo.overview()); }
      if (req.method === 'GET' && path === '/players') { requirePermission(user, 'players:read'); const players = await repo.listPlayers({ online: url.searchParams.get('online') === '1', q: url.searchParams.get('q') || '', limit: Math.min(int(url.searchParams.get('limit') || 1000, 'limit', { min: 1, max: 5000 }), 5000) }); return json(res, 200, { ok: true, players }); }

      let params = routeMatch(path, '/characters/:name');
      if (params && req.method === 'GET') { requirePermission(user, 'characters:read'); const character = await repo.getCharacter(params.name); if (!character) fail(404, 'CHARACTER_NOT_FOUND'); return json(res, 200, { ok: true, character, ...character }); }
      if (params && req.method === 'PATCH') {
        requirePermission(user, 'characters:write'); const payload = await body(req); const reason = auditReason(payload); const patch = {};
        if ('level' in payload) patch.level = int(payload.level, 'level', { min: 1, max: 83 });
        if ('np' in payload) patch.np = int(payload.np, 'np', { min: 0, max: 2147483647 });
        if ('coin' in payload) patch.coin = int(payload.coin, 'coin', { min: 0, max: 2147483647 });
        if ('zone' in payload) { if (!ZONES.has(String(payload.zone))) fail(422, 'VALIDATION_ERROR', 'Unsupported zone'); patch.zone = String(payload.zone); }
        if (!Object.keys(patch).length) fail(422, 'VALIDATION_ERROR', 'No editable fields supplied');
        const out = await mutate(req, user, 'CHARACTER_EDIT', params.name, reason, async (tx) => { const character = await tx.updateCharacter(params.name, patch); if (!character) fail(404, 'CHARACTER_NOT_FOUND'); return { character }; }); return json(res, 200, out);
      }

      params = routeMatch(path, '/characters/:name/stats');
      if (params && req.method === 'PATCH') { requirePermission(user, 'characters:write'); const payload = await body(req); const reason = auditReason(payload); const stats = {}; for (const key of ['str','hp','dex','int','mp']) if (key in payload) stats[key] = int(payload[key], key, { min: 0, max: 255 }); if (!Object.keys(stats).length) fail(422, 'VALIDATION_ERROR', 'No stats supplied'); const out = await mutate(req, user, 'CHARACTER_STATS_EDIT', params.name, reason, async (tx) => { const character = await tx.updateStats(params.name, stats); if (!character) fail(404, 'CHARACTER_NOT_FOUND'); return { character }; }); return json(res, 200, out); }

      params = routeMatch(path, '/characters/:name/skills');
      if (params && req.method === 'PATCH') { requirePermission(user, 'characters:write'); const payload = await body(req); const reason = auditReason(payload); const skills = {}; for (const [key, value] of Object.entries(payload)) if (!['reason','actor','authority','source'].includes(key)) skills[key] = int(value, key, { min: 0, max: 83 }); if (!Object.keys(skills).length) fail(422, 'VALIDATION_ERROR', 'No skills supplied'); const out = await mutate(req, user, 'CHARACTER_SKILLS_EDIT', params.name, reason, async (tx) => { const character = await tx.updateSkills(params.name, skills); if (!character) fail(404, 'CHARACTER_NOT_FOUND'); return { character }; }); return json(res, 200, out); }

      for (const [suffix, method, permission] of [['inventory','getInventory','characters:read'], ['inn','getInn','characters:read'], ['transactions','getTransactions','characters:read'], ['sanctions','getSanctions','characters:read']]) {
        params = routeMatch(path, `/characters/:name/${suffix}`); if (params && req.method === 'GET') { requirePermission(user, permission); if (!(await repo.getCharacter(params.name))) fail(404, 'CHARACTER_NOT_FOUND'); const value = await repo[method](params.name); return json(res, 200, suffix === 'transactions' ? { ok: true, entries: value } : suffix === 'sanctions' ? { ok: true, sanctions: value } : { ok: true, ...value }); }
      }

      if (req.method === 'GET' && path === '/items/search') { requirePermission(user, 'items:read'); const q = url.searchParams.get('q') || ''; return json(res, 200, { ok: true, items: await repo.searchItems(q) }); }
      if (req.method === 'GET' && path === '/items/duplicates') { requirePermission(user, 'items:read'); return json(res, 200, { ok: true, ...(await repo.findDuplicateSerials()) }); }
      params = routeMatch(path, '/items/:serial/history');
      if (params && req.method === 'GET') { requirePermission(user, 'items:read'); return json(res, 200, { ok: true, serial: params.serial, entries: await repo.itemHistory(params.serial) }); }
      params = routeMatch(path, '/items/:serial');
      if (params && req.method === 'POST') { requirePermission(user, 'items:write'); const payload = await body(req); const reason = auditReason(payload); const action = String(payload.action || '').toUpperCase(); if (!ITEM_ACTIONS.has(action)) fail(422, 'VALIDATION_ERROR', `action must be one of: ${[...ITEM_ACTIONS].join(', ')}`); const out = await mutate(req, user, `ITEM_${action}`, params.serial, reason, async (tx) => { const item = await tx.itemAction(params.serial, { action, note: String(payload.note || '').slice(0, 500), actor: user.username }); if (!item) fail(404, 'ITEM_NOT_FOUND'); return { item }; }); return json(res, 200, out); }

      if (req.method === 'POST' && path === '/sanctions') { requirePermission(user, 'sanctions:write'); const payload = await body(req); const character = text(payload.character, 'character', { max: 30 }); const type = String(payload.type || 'ACCOUNT').toUpperCase(); if (!['ACCOUNT','IP'].includes(type)) fail(422, 'VALIDATION_ERROR', 'type must be ACCOUNT or IP'); const reason = auditReason(payload); const out = await mutate(req, user, type === 'IP' ? 'IP_BAN' : 'ACCOUNT_BAN', character, reason, async (tx, trace) => { const sanction = await tx.createSanction({ character, type, reason, actor: user.username, traceId: trace }); if (!sanction) fail(404, 'CHARACTER_NOT_FOUND'); return { sanction }; }); return json(res, 201, out); }
      params = routeMatch(path, '/sanctions/:character');
      if (params && req.method === 'DELETE') { requirePermission(user, 'sanctions:write'); const payload = await body(req); const type = String(url.searchParams.get('type') || payload.type || '').toUpperCase(); if (type && !['ACCOUNT','IP'].includes(type)) fail(422, 'VALIDATION_ERROR', 'type must be ACCOUNT or IP'); const reason = auditReason(payload, `Ban removed via existing admin frontend contract${type ? ` (${type})` : ''}`); const out = await mutate(req, user, 'BAN_REMOVE', params.character, reason, async (tx) => { const character = await tx.removeSanction({ character: params.character, type }); if (!character) fail(404, 'CHARACTER_NOT_FOUND'); return { character }; }); return json(res, 200, out); }

      if (req.method === 'GET' && path === '/audit') { requirePermission(user, 'audit:read'); const limit = int(url.searchParams.get('limit') || 100, 'limit', { min: 1, max: 1000 }); return json(res, 200, { ok: true, entries: await repo.listAudit(limit) }); }

      if (req.method === 'POST' && path === '/commands') {
        requirePermission(user, 'commands:execute'); const payload = await body(req); const commandName = String(payload.command || '').toUpperCase(); const descriptor = COMMANDS.get(commandName); if (!descriptor) fail(422, 'UNKNOWN_COMMAND'); if (descriptor.risk === 'critical') requirePermission(user, 'commands:critical'); const target = String(payload.target || '').trim(); if (descriptor.targetRequired && !target) fail(422, 'TARGET_REQUIRED'); const reason = auditReason(payload); const out = await mutate(req, user, `GM_COMMAND_${commandName}`, target || 'GLOBAL', reason, async (tx, trace) => ({ game: { forwarded: false, request: await tx.enqueueCommand({ command: commandName, target, arg: String(payload.arg || '').slice(0, 500), requestedBy: user.username, traceId: trace, source: source(req, payload) }) } })); return json(res, 202, out);
      }

      return json(res, 404, { ok: false, error: 'NOT_FOUND' });
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      if (status >= 500) console.error(error);
      return json(res, status, { ok: false, error: error.message || 'INTERNAL_ERROR', ...(error.detail ? { detail: error.detail } : {}) });
    }
  }

  return { handler, COMMANDS };
}

module.exports = { createAdminApi, HttpError, COMMANDS };
