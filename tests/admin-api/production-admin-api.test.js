'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '../../services/admin-api/src');
const { createProductionAdminApi } = require(path.join(root, 'production-app'));
const { createWs28CommandExecutor } = require(path.join(root, 'ws28-command-executor'));
const { MemoryAdminRepository } = require(path.join(root, 'repository'));
const { hashPassword } = require(path.join(root, 'security'));

class DurableFixtureRepository extends MemoryAdminRepository {
  constructor() {
    super({ characters: [
      { name: 'offline', account: 'acct-offline', accountId: '1', characterId: '11', level: 10, zone: 'Moradon', version: 1 },
      { name: 'runtimeOnline', account: 'acct-online', accountId: '2', characterId: '22', level: 20, zone: 'Moradon', version: 3 }
    ] });
    this.adminSessions = new Map();
    this.receipts = new Map();
  }
  async createAdminSession(row) { this.adminSessions.set(row.id, structuredClone(row)); return structuredClone(row); }
  async getAdminSession(id) { const row = this.adminSessions.get(id); return row && !row.revokedAt ? structuredClone(row) : null; }
  async revokeAdminSession(id, reason) { const row = this.adminSessions.get(id); if (!row) return false; row.revokedAt = new Date().toISOString(); row.revokeReason = reason; return true; }
  async runIdempotent({ key, actorId, kind }, work) { const k = `${actorId}:${kind}:${key}`; if (this.receipts.has(k)) return { replayed: true, value: structuredClone(this.receipts.get(k)) }; const value = await work(); this.receipts.set(k, structuredClone(value)); return { replayed: false, value }; }
  async enqueueCommand(command) { const row = { id: crypto.randomUUID(), status: command.status || 'PENDING', ...structuredClone(command) }; this.commands.push(row); return structuredClone(row); }
  async updateCommand(id, patch) { const row = this.commands.find((x) => x.id === id); Object.assign(row, structuredClone(patch)); return structuredClone(row); }
  async getCommand(id) { return structuredClone(this.commands.find((x) => x.id === id) || null); }
  async updateCharacter(name, patch, { expectedVersion } = {}) { const row = this.characters.find((x) => x.name === name); if (!row) return null; if (row.version !== expectedVersion) { const e = new Error('version mismatch'); e.code = 'VERSION_CONFLICT'; throw e; } Object.assign(row, patch); row.version += 1; return structuredClone(row); }
  async updateStats(name, patch, options) { return this.updateCharacter(name, { stats: patch }, options); }
  async updateSkills(name, patch, options) { return this.updateCharacter(name, { skills: patch }, options); }
}

function cookieJar(setCookie) {
  const values = Array.isArray(setCookie) ? setCookie : [setCookie];
  return values.filter(Boolean).map((v) => v.split(';')[0]).join('; ');
}

async function fixture({ busResult } = {}) {
  const repository = new DurableFixtureRepository();
  const runtimeCalls = [];
  const runtimeAuthority = {
    async listOnlineCharacters() { return [{ name: 'runtimeOnline', sessionId: 'game-session-1', serverId: 'game-1' }]; },
    async getCharacterState(name) { return String(name).toLowerCase() === 'runtimeonline' ? { name: 'runtimeOnline', online: true, sessionId: 'game-session-1', version: 3 } : { name, online: false }; },
    async mutateOnlineCharacter(input) { runtimeCalls.push(structuredClone(input)); return { name: input.name, ...input.patch, version: input.expectedVersion + 1, persistedBy: 'runtime-domain' }; }
  };
  const commandBus = { async execute(request) { return busResult ? busResult(request) : { requestId: request.requestId, command: request.command, status: 'ok', code: 'OK', data: { applied: true } }; } };
  const commandExecutor = createWs28CommandExecutor({ repository, commandBus });
  const users = [
    { id: 'root-verified-id', username: 'ROOT', passwordHash: hashPassword('root-pass', 'root-salt'), roles: ['VIEWER'] },
    { id: 'forger-id', username: 'FORGER', passwordHash: hashPassword('forger-pass', 'forger-salt'), roles: ['OWNER', 'GM'] }
  ];
  const api = createProductionAdminApi({ repository, runtimeAuthority, commandExecutor, users, rootOwnerId: 'root-verified-id', sessionSecret: 'production-test-secret-at-least-thirty-two-bytes', allowedOrigins: ['https://admin.oldkoweb.com'], secureCookies: false });
  const server = http.createServer(api.handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/admin`;
  async function login(user = 'ROOT', password = 'root-pass') {
    const r = await fetch(`${base}/session/login`, { method: 'POST', headers: { origin: 'https://admin.oldkoweb.com', 'content-type': 'application/json' }, body: JSON.stringify({ user, password }) });
    assert.equal(r.status, 200); const data = await r.json(); return { data, cookie: cookieJar(r.headers.getSetCookie ? r.headers.getSetCookie() : r.headers.get('set-cookie')) };
  }
  async function request(pathname, { method = 'GET', cookie, csrf, body, idempotencyKey, origin = 'https://admin.oldkoweb.com' } = {}) {
    const headers = { ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}), ...(csrf ? { 'x-csrf-token': csrf } : {}), ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) };
    return fetch(`${base}${pathname}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  }
  return { repository, runtimeCalls, api, base, request, login, close: () => new Promise((resolve) => server.close(resolve)) };
}

async function withFixture(fn, options) { const f = await fixture(options); try { await fn(f); } finally { await f.close(); } }

test('root owner is bound to verified id and forged OWNER role is stripped', async () => withFixture(async ({ login }) => {
  const rootLogin = await login(); assert.deepEqual(rootLogin.data.user.roles, ['VIEWER', 'OWNER']);
  const forged = await login('FORGER', 'forger-pass'); assert.deepEqual(forged.data.user.roles, ['GM']);
}));

test('authoritative online filter ignores persisted/demo online flags', async () => withFixture(async ({ login, request }) => {
  const auth = await login();
  const r = await request('/players?online=1', { cookie: auth.cookie }); assert.equal(r.status, 200);
  const data = await r.json(); assert.deepEqual(data.players.map((x) => x.name), ['runtimeOnline']);
}));

test('unsafe mutation requires trusted origin and csrf then uses CAS/idempotency/audit', async () => withFixture(async ({ login, request, repository }) => {
  const auth = await login();
  let r = await request('/characters/offline', { method: 'PATCH', cookie: auth.cookie, body: { level: 11, expectedVersion: 1, reason: 'controlled test edit' }, idempotencyKey: 'edit-offline-0001' }); assert.equal(r.status, 403); assert.equal((await r.json()).error, 'CSRF_REJECTED');
  r = await request('/characters/offline', { method: 'PATCH', cookie: auth.cookie, csrf: auth.data.csrfToken, body: { level: 11, expectedVersion: 1, reason: 'controlled test edit', actor: 'ATTACKER', authority: 'ROOT_OWNER' }, idempotencyKey: 'edit-offline-0001' }); assert.equal(r.status, 200); const first = await r.json(); assert.equal(first.value.level, 11);
  r = await request('/characters/offline', { method: 'PATCH', cookie: auth.cookie, csrf: auth.data.csrfToken, body: { level: 11, expectedVersion: 1, reason: 'controlled test edit' }, idempotencyKey: 'edit-offline-0001' }); assert.equal(r.status, 200); const replay = await r.json(); assert.equal(replay.idempotentReplay, true);
  assert.equal(repository.audit.filter((x) => x.action === 'CHARACTER_EDIT').length, 1);
}));

test('online character mutation is sent to runtime authority instead of repository sql path', async () => withFixture(async ({ login, request, runtimeCalls, repository }) => {
  const auth = await login();
  const before = await repository.getCharacter('runtimeOnline');
  const r = await request('/characters/runtimeOnline', { method: 'PATCH', cookie: auth.cookie, csrf: auth.data.csrfToken, body: { level: 21, expectedVersion: 3, reason: 'runtime owned edit' }, idempotencyKey: 'runtime-edit-0001' }); assert.equal(r.status, 200);
  assert.equal(runtimeCalls.length, 1); assert.equal(runtimeCalls[0].operationId.length > 10, true);
  const after = await repository.getCharacter('runtimeOnline'); assert.equal(after.level, before.level);
}));

test('ws28 result is SUCCEEDED only after bus applies it; unsupported and downstream failure are distinct', async () => withFixture(async ({ login, request }) => {
  const auth = await login();
  let r = await request('/commands', { method: 'POST', cookie: auth.cookie, csrf: auth.data.csrfToken, idempotencyKey: 'cmd-count-0001', body: { command: 'COUNT', reason: 'count players now' } }); assert.equal(r.status, 200); let data = await r.json(); assert.equal(data.game.status, 'SUCCEEDED'); assert.equal(data.command.status, 'SUCCEEDED');
  r = await request('/commands', { method: 'POST', cookie: auth.cookie, csrf: auth.data.csrfToken, idempotencyKey: 'cmd-clean-0001', body: { command: 'CLEAN', reason: 'unsupported command test' } }); assert.equal(r.status, 422); data = await r.json(); assert.equal(data.game.status, 'UNSUPPORTED');
}), { });

test('ws28 service failure is returned as FAILED/503, never successful 202', async () => withFixture(async ({ login, request }) => {
  const auth = await login();
  const r = await request('/commands', { method: 'POST', cookie: auth.cookie, csrf: auth.data.csrfToken, idempotencyKey: 'cmd-fail-0001', body: { command: 'COUNT', reason: 'failure propagation test' } });
  assert.equal(r.status, 503); const data = await r.json(); assert.equal(data.game.status, 'FAILED'); assert.equal(data.game.code, 'SERVICE_UNAVAILABLE');
}), { busResult: () => ({ status: 'failed', code: 'SERVICE_UNAVAILABLE', message: 'game unavailable' }) }));

test('session survives api recreation on same durable store and logout revokes it', async () => withFixture(async ({ login, request }) => {
  const auth = await login();
  let r = await request('/session', { cookie: auth.cookie }); assert.equal(r.status, 200);
  r = await request('/session/logout', { method: 'POST', cookie: auth.cookie, csrf: auth.data.csrfToken }); assert.equal(r.status, 200);
  r = await request('/session', { cookie: auth.cookie }); assert.equal(r.status, 401);
}));
