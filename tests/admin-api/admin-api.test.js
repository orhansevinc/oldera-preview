'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');

const root = path.resolve(__dirname, '../../services/admin-api/src');
const { createAdminApi } = require(path.join(root, 'app'));
const { MemoryAdminRepository } = require(path.join(root, 'repository'));
const { hashPassword } = require(path.join(root, 'security'));

async function fixture() {
  const repository = new MemoryAdminRepository();
  const users = [
    { id: 'owner-1', username: 'ORHAN', passwordHash: hashPassword('owner-pass', 'owner-test-salt'), roles: ['OWNER'] },
    { id: 'viewer-1', username: 'VIEWER', passwordHash: hashPassword('viewer-pass', 'viewer-test-salt'), roles: ['VIEWER'] },
    { id: 'gm-1', username: 'GMUSER', passwordHash: hashPassword('gm-pass', 'gm-test-salt'), roles: ['GM'] }
  ];
  const api = createAdminApi({ repository, users, sessionSecret: 'test-secret-must-be-at-least-thirty-two-bytes-long' });
  const server = http.createServer(api.handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/admin`;
  async function login(user, password) { const r = await fetch(`${base}/session/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ user, password }) }); assert.equal(r.status, 200); return r.headers.get('set-cookie').split(';')[0]; }
  async function request(pathname, { method = 'GET', cookie, body, headers = {} } = {}) { return fetch(`${base}${pathname}`, { method, headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }); }
  return { repository, base, request, login, close: () => new Promise((resolve) => server.close(resolve)) };
}

async function withFixture(fn) { const f = await fixture(); try { await fn(f); } finally { await f.close(); } }

test('health is public and unauthenticated admin data is blocked', async () => withFixture(async ({ request }) => {
  assert.equal((await request('/health')).status, 200);
  assert.equal((await request('/players')).status, 401);
}));

test('login/session resolves server-side roles and permissions', async () => withFixture(async ({ request, login }) => {
  const cookie = await login('ORHAN', 'owner-pass');
  const r = await request('/session', { cookie }); const data = await r.json();
  assert.equal(data.ok, true); assert.deepEqual(data.user.roles, ['OWNER']); assert.ok(data.user.permissions.includes('commands:critical'));
}));

test('player search and online filter match frontend response shape', async () => withFixture(async ({ request, login }) => {
  const cookie = await login('ORHAN', 'owner-pass');
  let data = await (await request('/players?q=osevinc&limit=100', { cookie })).json(); assert.equal(data.players.length, 1); assert.equal(data.players[0].name, 'osevinc');
  data = await (await request('/players?online=1', { cookie })).json(); assert.ok(data.players.every((p) => p.online));
}));

test('inventory and inn expose 14/28/192 slot models used by existing admin frontend', async () => withFixture(async ({ request, login }) => {
  const cookie = await login('ORHAN', 'owner-pass');
  const inv = await (await request('/characters/osevinc/inventory', { cookie })).json(); const inn = await (await request('/characters/osevinc/inn', { cookie })).json();
  assert.equal(inv.equipment.length, 14); assert.equal(inv.inventory.length, 28); assert.equal(inn.slots.length, 192);
}));

test('character mutation validates values, ignores forged authority, and audits authenticated actor', async () => withFixture(async ({ request, login }) => {
  const cookie = await login('ORHAN', 'owner-pass');
  const r = await request('/characters/osevinc', { method: 'PATCH', cookie, body: { level: 71, np: 50000, coin: 42, zone: 'Moradon', reason: 'test edit', actor: 'ATTACKER', authority: 'ROOT_OWNER' } }); assert.equal(r.status, 200);
  const audit = await (await request('/audit', { cookie })).json(); assert.equal(audit.entries[0].actor, 'ORHAN'); assert.equal(audit.entries[0].action, 'CHARACTER_EDIT');
  assert.equal((await request('/characters/osevinc', { method: 'PATCH', cookie, body: { level: 99, reason: 'bad' } })).status, 422);
}));

test('audit reason is mandatory on character edits', async () => withFixture(async ({ request, login }) => {
  const cookie = await login('ORHAN', 'owner-pass'); const r = await request('/characters/osevinc', { method: 'PATCH', cookie, body: { level: 71 } }); assert.equal(r.status, 422); assert.equal((await r.json()).error, 'AUDIT_REASON_REQUIRED');
}));

test('viewer cannot mutate even when sending ROOT_OWNER label', async () => withFixture(async ({ request, login }) => {
  const cookie = await login('VIEWER', 'viewer-pass'); const r = await request('/sanctions', { method: 'POST', cookie, body: { character: 'osevinc', type: 'ACCOUNT', reason: 'forged', authority: 'ROOT_OWNER', actor: 'ORHAN' } }); assert.equal(r.status, 403);
}));

test('account ban, IP ban and legacy-compatible unban are transactional and audited', async () => withFixture(async ({ request, login }) => {
  const cookie = await login('ORHAN', 'owner-pass');
  assert.equal((await request('/sanctions', { method: 'POST', cookie, body: { character: 'osevinc', type: 'ACCOUNT', reason: 'account test' } })).status, 201);
  assert.equal((await request('/sanctions', { method: 'POST', cookie, body: { character: 'osevinc', type: 'IP', reason: 'ip test' } })).status, 201);
  const banned = await (await request('/characters/osevinc', { cookie })).json(); assert.equal(banned.character.banned, true); assert.equal(banned.character.ipBanned, true);
  assert.equal((await request('/sanctions/osevinc', { method: 'DELETE', cookie })).status, 200);
  const clear = await (await request('/characters/osevinc', { cookie })).json(); assert.equal(clear.character.banned, false); assert.equal(clear.character.ipBanned, false);
}));

test('duplicate serial query and serial history locate repeated items', async () => withFixture(async ({ request, login }) => {
  const cookie = await login('ORHAN', 'owner-pass'); const dupes = await (await request('/items/duplicates', { cookie })).json(); assert.ok(dupes.duplicates.some((d) => d.serial === 'DUP-SERIAL-778899' && d.count === 3));
  const history = await (await request('/items/DUP-SERIAL-778899/history', { cookie })).json(); assert.equal(history.entries.length, 3);
}));

test('GM command requests are staged server-side and critical commands require elevated permission', async () => withFixture(async ({ request, login }) => {
  const gm = await login('GMUSER', 'gm-pass');
  let r = await request('/commands', { method: 'POST', cookie: gm, body: { command: 'SUMMONUSER', target: 'osevinc', reason: 'gm test', actor: 'ORHAN', authority: 'ROOT_OWNER' } }); assert.equal(r.status, 202); let data = await r.json(); assert.equal(data.game.forwarded, false); assert.equal(data.game.request.requestedBy, 'GMUSER');
  r = await request('/commands', { method: 'POST', cookie: gm, body: { command: 'ATTACKDISABLE', reason: 'critical test' } }); assert.equal(r.status, 403);
}));

test('idempotency key prevents duplicate mutations/audit records', async () => withFixture(async ({ request, login }) => {
  const cookie = await login('ORHAN', 'owner-pass'); const headers = { 'idempotency-key': 'same-ban-request' }; const payload = { character: 'osevinc', type: 'ACCOUNT', reason: 'once only' };
  const a = await (await request('/sanctions', { method: 'POST', cookie, body: payload, headers })).json(); const b = await (await request('/sanctions', { method: 'POST', cookie, body: payload, headers })).json(); assert.equal(a.traceId, b.traceId);
  const audit = await (await request('/audit', { cookie })).json(); assert.equal(audit.entries.filter((e) => e.action === 'ACCOUNT_BAN').length, 1);
}));

test('frontend contract coverage endpoints return compatible envelopes', async () => withFixture(async ({ request, login }) => {
  const cookie = await login('ORHAN', 'owner-pass');
  const checks = ['/overview','/players','/characters/osevinc','/characters/osevinc/inventory','/characters/osevinc/inn','/characters/osevinc/transactions','/characters/osevinc/sanctions','/items/search?q=120310000','/items/DUP-SERIAL-778899/history','/audit'];
  for (const route of checks) assert.equal((await request(route, { cookie })).status, 200, route);
}));

test('OpenAPI spec declares all 22 admin HTTP operations', async () => {
  const fs = require('node:fs');
  const spec = fs.readFileSync(path.resolve(__dirname, '../../services/admin-api/openapi.yaml'), 'utf8');
  const operations = [...spec.matchAll(/^\s+operationId:\s+(.+)$/gm)].map((m) => m[1].trim());
  assert.equal(operations.length, 22);
  assert.equal(new Set(operations).size, 22);
});
