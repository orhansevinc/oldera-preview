import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { once } from 'node:events';
import { MemoryAuditSink } from '../../services/account-api/src/audit.js';
import { AccountService } from '../../services/account-api/src/service.js';
import { SecurityGate } from '../../services/account-api/src/rate-limit.js';
import { PostgresRateLimitStore } from '../../services/account-api/src/postgres-rate-limit.js';
import { buildProductionRuntime } from '../../services/account-api/src/production-runtime.js';
import { createHttpServer } from '../../services/account-api/src/http.js';
import { openApiDocument } from '../../services/account-api/src/openapi.js';

const enabled = process.env.OLDKO_POSTGRES_INTEGRATION === '1';
const integration = enabled ? test : test.skip;
const origin = 'https://oldkoweb.com';

class CaptureDelivery {
  constructor() { this.verifications = []; this.resets = []; }
  async sendVerification(payload) { this.verifications.push(payload); }
  async sendPasswordReset(payload) { this.resets.push(payload); }
}

async function jsonRequest(base, route, { method = 'GET', body, headers = {} } = {}) {
  const options = { method, headers: { accept: 'application/json', ...headers } };
  if (body !== undefined) {
    options.headers['content-type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  return fetch(`${base}${route}`, options);
}

function uniqueAccount(label) {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const username = `${label}${suffix}`.replace(/[^A-Za-z0-9_]/g, '').slice(0, 20);
  return { username, email: `${username.toLowerCase()}@example.test`, password: 'Str0ng!ProdPass1' };
}

async function loadWs07() {
  const adapterPath = path.resolve(process.env.OLDKO_ACCOUNT_REPOSITORY_MODULE);
  const adapter = await import(pathToFileURL(adapterPath).href);
  const ws07 = await import(pathToFileURL(path.resolve(path.dirname(adapterPath), '../index.js')).href);
  return { adapter, ws07 };
}

async function fixture(label = 'Prod') {
  const { adapter, ws07 } = await loadWs07();
  const repository = await adapter.createAccountRepository({ env: process.env });
  const rateLimitStore = new PostgresRateLimitStore({ env: process.env });
  const delivery = new CaptureDelivery();
  const service = new AccountService({ repository, delivery, audit: new MemoryAuditSink(), securityGate: new SecurityGate(rateLimitStore) });
  const readinessCheck = async () => { await repository.db.query('SELECT 1'); await rateLimitStore.ready(); };
  const server = createHttpServer({ service, openApiDocument, allowedOrigins: [origin], readinessCheck });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const account = uniqueAccount(label);
  let accountId = null;

  async function registerAndVerify() {
    const register = await jsonRequest(base, '/api/account/v1/accounts/register', { method: 'POST', headers: { origin }, body: account });
    assert.equal(register.status, 201);
    assert.equal(delivery.verifications.length, 1);
    const stored = await repository.findByUsernameCanonical(account.username.toLowerCase());
    assert.ok(stored);
    accountId = stored.id;
    const verify = await jsonRequest(base, '/api/account/v1/accounts/verification/confirm', { method: 'POST', headers: { origin }, body: { token: delivery.verifications[0].token } });
    assert.equal(verify.status, 200);
    return repository.findById(accountId);
  }

  async function cleanup() {
    await new Promise((resolve) => server.close(resolve));
    if (accountId) {
      await repository.db.query('DELETE FROM oldko.account_sessions WHERE account_id=$1', [accountId]);
      await repository.db.query('DELETE FROM oldko.account_action_tokens WHERE account_id=$1', [accountId]);
      await repository.db.query('DELETE FROM oldko.accounts WHERE id=$1', [accountId]);
    }
    await rateLimitStore.close();
    await repository.db.end();
  }

  return { repository, delivery, base, account, ws07, registerAndVerify, cleanup };
}

integration('production runtime pins the exact WS07 PostgreSQL adapter and shared rate limiter', async () => {
  const env = { ...process.env, NODE_ENV: 'production', OLDKO_ACCOUNT_ALLOWED_ORIGINS: 'https://oldkoweb.com', OLDKO_TRUST_PROXY: '1', OLDKO_ACCOUNT_DELIVERY_WEBHOOK_URL: 'https://delivery.example.invalid/account', OLDKO_ACCOUNT_DELIVERY_WEBHOOK_SECRET: 'ci-only-placeholder-secret' };
  const runtime = await buildProductionRuntime(env);
  try {
    assert.equal(runtime.repository.constructor.name, 'PgWs13AccountRepository');
    assert.equal(runtime.rateLimitStore.kind, 'postgres');
    assert.equal(runtime.trustProxy, true);
    await runtime.readinessCheck();
  } finally {
    await runtime.rateLimitStore.close();
    await runtime.repository.db.end();
  }
});

integration('PostgreSQL register verify and WS07 game hash compatibility', async () => {
  const f = await fixture('Reg');
  try {
    assert.equal((await fetch(`${f.base}/api/account/readyz`)).status, 200);
    const stored = await f.registerAndVerify();
    assert.match(stored.passwordHash, /^scrypt\$/);
    assert.equal(await f.ws07.verifyPassword(f.account.password, stored.passwordHash), true);
    assert.equal(await f.ws07.verifyPassword('Wrong!Password', stored.passwordHash), false);
    assert.ok(stored.verifiedAt);
  } finally { await f.cleanup(); }
});

integration('PostgreSQL login current logout and revoked session', async () => {
  const f = await fixture('Sess');
  try {
    await f.registerAndVerify();
    const login = await jsonRequest(f.base, '/api/account/v1/session/login', { method: 'POST', headers: { origin }, body: { identifier: f.account.email, password: f.account.password } });
    assert.equal(login.status, 200);
    const setCookie = login.headers.get('set-cookie');
    assert.match(setCookie, /^oldko_session=/);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /Secure/i);
    assert.match(setCookie, /SameSite=Strict/i);
    assert.match(setCookie, /Path=\//i);
    const cookie = setCookie.split(';', 1)[0];
    const current = await jsonRequest(f.base, '/api/account/v1/session/current', { headers: { cookie, origin } });
    assert.equal(current.status, 200);
    assert.equal((await current.json()).user.username, f.account.username);
    const logout = await jsonRequest(f.base, '/api/account/v1/session/logout', { method: 'POST', headers: { origin, cookie }, body: {} });
    assert.equal(logout.status, 200);
    assert.equal((await jsonRequest(f.base, '/api/account/v1/session/current', { headers: { cookie, origin } })).status, 401);
    const evilLogout = await jsonRequest(f.base, '/api/account/v1/session/logout', { method: 'POST', headers: { origin: 'https://evil.example', cookie }, body: {} });
    assert.equal(evilLogout.status, 403);
  } finally { await f.cleanup(); }
});

integration('PostgreSQL password change invalidates prior session and credential', async () => {
  const f = await fixture('Chg');
  const nextPassword = 'Str0ng!ProdPass2';
  try {
    await f.registerAndVerify();
    const login = await jsonRequest(f.base, '/api/account/v1/session/login', { method: 'POST', headers: { origin }, body: { identifier: f.account.username, password: f.account.password } });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';', 1)[0];
    const change = await jsonRequest(f.base, '/api/account/v1/accounts/password/change', { method: 'POST', headers: { origin, cookie }, body: { username: f.account.username, currentPassword: f.account.password, newPassword: nextPassword } });
    assert.equal(change.status, 200);
    assert.equal((await jsonRequest(f.base, '/api/account/v1/session/current', { headers: { cookie, origin } })).status, 401);
    assert.equal((await jsonRequest(f.base, '/api/account/v1/session/login', { method: 'POST', headers: { origin }, body: { identifier: f.account.username, password: f.account.password } })).status, 401);
    assert.equal((await jsonRequest(f.base, '/api/account/v1/session/login', { method: 'POST', headers: { origin }, body: { identifier: f.account.username, password: nextPassword } })).status, 200);
  } finally { await f.cleanup(); }
});

integration('PostgreSQL password reset rotates credential', async () => {
  const f = await fixture('Rst');
  const nextPassword = 'Str0ng!ProdPass3';
  try {
    await f.registerAndVerify();
    const resetRequest = await jsonRequest(f.base, '/api/account/v1/accounts/password-reset/request', { method: 'POST', headers: { origin }, body: { email: f.account.email } });
    assert.equal(resetRequest.status, 202);
    assert.equal(f.delivery.resets.length, 1);
    const resetConfirm = await jsonRequest(f.base, '/api/account/v1/accounts/password-reset/confirm', { method: 'POST', headers: { origin }, body: { token: f.delivery.resets[0].token, newPassword: nextPassword } });
    assert.equal(resetConfirm.status, 200);
    assert.equal((await jsonRequest(f.base, '/api/account/v1/session/login', { method: 'POST', headers: { origin }, body: { identifier: f.account.username, password: f.account.password } })).status, 401);
    assert.equal((await jsonRequest(f.base, '/api/account/v1/session/login', { method: 'POST', headers: { origin }, body: { identifier: f.account.username, password: nextPassword } })).status, 200);
  } finally { await f.cleanup(); }
});

integration('PostgreSQL rate-limit state is shared across independent service instances', async () => {
  const a = new PostgresRateLimitStore({ env: process.env });
  const b = new PostgresRateLimitStore({ env: process.env });
  const key = `ci-shared-${Date.now()}-${Math.random()}`;
  try {
    assert.equal((await a.consume(key, 2, 60_000)).allowed, true);
    assert.equal((await b.consume(key, 2, 60_000)).allowed, true);
    assert.equal((await a.consume(key, 2, 60_000)).allowed, false);
    await b.reset(key);
    assert.equal((await a.check(key, 2, 60_000)).allowed, true);
  } finally { await Promise.all([a.close(), b.close()]); }
});
