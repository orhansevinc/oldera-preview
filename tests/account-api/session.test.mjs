import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { InMemoryAccountRepository } from '../../services/account-api/src/repository.js';
import { MemoryAuditSink } from '../../services/account-api/src/audit.js';
import { AccountService } from '../../services/account-api/src/service.js';
import { createHttpServer } from '../../services/account-api/src/http.js';
import { openApiDocument } from '../../services/account-api/src/openapi.js';

class CaptureDelivery {
  constructor() { this.verifications = []; }
  async sendVerification(payload) { this.verifications.push(payload); }
  async sendPasswordReset() {}
}

async function fixture() {
  const repository = new InMemoryAccountRepository();
  const delivery = new CaptureDelivery();
  const service = new AccountService({ repository, delivery, audit: new MemoryAuditSink() });
  await service.register({ username: 'PlayerOne', email: 'player@example.test', password: 'Str0ng!Pwd12' }, { ip: '127.0.0.1', requestId: 'register-0001' });
  await service.confirmVerification({ token: delivery.verifications[0].token }, { ip: '127.0.0.1', requestId: 'verify-0001' });
  const account = await repository.findByUsernameCanonical('playerone');
  repository.characters.set(account.id, [{ id: '1001', slot: 0, name: 'KnightOne', nation: 1, level: 1, classId: 101, clan: null, np: 0 }]);
  return { repository, service };
}

async function request(base, path, options = {}) {
  return fetch(`${base}${path}`, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } });
}

test('web session uses secure HttpOnly cookie, authorizes dashboard data, and logout revokes it', async () => {
  const { service } = await fixture();
  const origin = 'https://oldkoweb.com';
  const server = createHttpServer({ service, openApiDocument, allowedOrigins: [origin] });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const missing = await fetch(`${base}/v1/session/current`);
    assert.equal(missing.status, 401);
    const bad = await request(base, '/v1/session/login', { method: 'POST', headers: { origin }, body: JSON.stringify({ identifier: 'PlayerOne', password: 'wrong-password' }) });
    assert.equal(bad.status, 401);
    const login = await request(base, '/v1/session/login', { method: 'POST', headers: { origin }, body: JSON.stringify({ identifier: 'player@example.test', password: 'Str0ng!Pwd12' }) });
    assert.equal(login.status, 200);
    const loginBody = await login.clone().json();
    assert.equal(loginBody.credentialUpgradeRequired, false);
    const setCookie = login.headers.get('set-cookie');
    assert.match(setCookie, /^oldko_session=/);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /Secure/i);
    assert.match(setCookie, /SameSite=Strict/i);
    assert.equal(JSON.stringify(loginBody).includes('oldko_session'), false);
    const cookie = setCookie.split(';', 1)[0];
    const current = await fetch(`${base}/v1/session/current`, { headers: { cookie } });
    assert.equal(current.status, 200);
    const currentBody = await current.json();
    assert.equal(currentBody.user.username, 'PlayerOne');
    assert.equal(currentBody.characters[0].name, 'KnightOne');
    const logout = await request(base, '/v1/session/logout', { method: 'POST', headers: { origin, cookie }, body: '{}' });
    assert.equal(logout.status, 200);
    assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
    const after = await fetch(`${base}/v1/session/current`, { headers: { cookie } });
    assert.equal(after.status, 401);
  } finally { server.close(); }
});

test('logout rejects untrusted origin', async () => {
  const { service } = await fixture();
  const server = createHttpServer({ service, openApiDocument, allowedOrigins: ['https://oldkoweb.com'] });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const res = await request(`http://127.0.0.1:${server.address().port}`, '/v1/session/logout', { method: 'POST', headers: { origin: 'https://evil.example' }, body: '{}' });
    assert.equal(res.status, 403);
  } finally { server.close(); }
});
