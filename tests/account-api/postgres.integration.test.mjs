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

integration('production runtime pins the exact WS07 PostgreSQL adapter and shared rate limiter', async () => {
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    OLDKO_ACCOUNT_ALLOWED_ORIGINS: 'https://oldkoweb.com',
    OLDKO_TRUST_PROXY: '1',
    OLDKO_ACCOUNT_DELIVERY_WEBHOOK_URL: 'https://delivery.example.invalid/account',
    OLDKO_ACCOUNT_DELIVERY_WEBHOOK_SECRET: 'ci-only-placeholder-secret'
  };
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

integration('PostgreSQL-backed account lifecycle passes through the exact public API and WS07 game verifier', async () => {
  const adapterPath = path.resolve(process.env.OLDKO_ACCOUNT_REPOSITORY_MODULE);
  const adapter = await import(pathToFileURL(adapterPath).href);
  const ws07 = await import(pathToFileURL(path.resolve(path.dirname(adapterPath), '../index.js')).href);
  const repository = await adapter.createAccountRepository({ env: process.env });
  const rateLimitStore = new PostgresRateLimitStore({ env: process.env });
  const delivery = new CaptureDelivery();
  const service = new AccountService({
    repository,
    delivery,
    audit: new MemoryAuditSink(),
    securityGate: new SecurityGate(rateLimitStore)
  });
  const readinessCheck = async () => {
    await repository.db.query('SELECT 1');
    await rateLimitStore.ready();
  };
  const origin = 'https://oldkoweb.com';
  const server = createHttpServer({ service, openApiDocument, allowedOrigins: [origin], readinessCheck });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const username = `Prod${suffix}`.slice(0, 30);
  const email = `${username.toLowerCase()}@example.test`;
  const password1 = 'Str0ng!ProdPass1';
  const password2 = 'Str0ng!ProdPass2';
  const password3 = 'Str0ng!ProdPass3';
  let accountId = null;

  try {
    const ready = await fetch(`${base}/api/account/readyz`);
    assert.equal(ready.status, 200);

    const register = await jsonRequest(base, '/api/account/v1/accounts/register', {
      method: 'POST', headers: { origin }, body: { username, email, password: password1 }
    });
    assert.equal(register.status, 201);
    assert.equal(delivery.verifications.length, 1);
    accountId = (await repository.findByUsernameCanonical(username.toLowerCase())).id;

    const stored = await repository.findById(accountId);
    assert.match(stored.passwordHash, /^scrypt\$/);
    assert.equal(await ws07.verifyPassword(password1, stored.passwordHash), true);
    assert.equal(await ws07.verifyPassword('Wrong!Password', stored.passwordHash), false);

    const verify = await jsonRequest(base, '/api/account/v1/accounts/verification/confirm', {
      method: 'POST', headers: { origin }, body: { token: delivery.verifications[0].token }
    });
    assert.equal(verify.status, 200);

    const login1 = await jsonRequest(base, '/api/account/v1/session/login', {
      method: 'POST', headers: { origin }, body: { identifier: email, password: password1 }
    });
    assert.equal(login1.status, 200);
    const setCookie1 = login1.headers.get('set-cookie');
    assert.match(setCookie1, /^oldko_session=/);
    assert.match(setCookie1, /HttpOnly/i);
    assert.match(setCookie1, /Secure/i);
    assert.match(setCookie1, /SameSite=Strict/i);
    assert.match(setCookie1, /Path=\//i);
    const cookie1 = setCookie1.split(';', 1)[0];

    const current1 = await jsonRequest(base, '/api/account/v1/session/current', { headers: { cookie: cookie1, origin } });
    assert.equal(current1.status, 200);
    assert.equal((await current1.json()).user.username, username);

    const change = await jsonRequest(base, '/api/account/v1/accounts/password/change', {
      method: 'POST', headers: { origin, cookie: cookie1 }, body: { username, currentPassword: password1, newPassword: password2 }
    });
    assert.equal(change.status, 200);
    const invalidatedByPasswordVersion = await jsonRequest(base, '/api/account/v1/session/current', { headers: { cookie: cookie1, origin } });
    assert.equal(invalidatedByPasswordVersion.status, 401);

    const oldPasswordLogin = await jsonRequest(base, '/api/account/v1/session/login', {
      method: 'POST', headers: { origin }, body: { identifier: username, password: password1 }
    });
    assert.equal(oldPasswordLogin.status, 401);

    const resetRequest = await jsonRequest(base, '/api/account/v1/accounts/password-reset/request', {
      method: 'POST', headers: { origin }, body: { email }
    });
    assert.equal(resetRequest.status, 202);
    assert.equal(delivery.resets.length, 1);
    const resetConfirm = await jsonRequest(base, '/api/account/v1/accounts/password-reset/confirm', {
      method: 'POST', headers: { origin }, body: { token: delivery.resets[0].token, newPassword: password3 }
    });
    assert.equal(resetConfirm.status, 200);

    const login2 = await jsonRequest(base, '/api/account/v1/session/login', {
      method: 'POST', headers: { origin }, body: { identifier: username, password: password3 }
    });
    assert.equal(login2.status, 200);
    const cookie2 = login2.headers.get('set-cookie').split(';', 1)[0];
    const current2 = await jsonRequest(base, '/api/account/v1/session/current', { headers: { cookie: cookie2, origin } });
    assert.equal(current2.status, 200);

    const logout = await jsonRequest(base, '/api/account/v1/session/logout', {
      method: 'POST', headers: { origin, cookie: cookie2 }, body: {}
    });
    assert.equal(logout.status, 200);
    const revoked = await jsonRequest(base, '/api/account/v1/session/current', { headers: { cookie: cookie2, origin } });
    assert.equal(revoked.status, 401);

    const evilLogout = await jsonRequest(base, '/api/account/v1/session/logout', {
      method: 'POST', headers: { origin: 'https://evil.example', cookie: cookie2 }, body: {}
    });
    assert.equal(evilLogout.status, 403);
  } finally {
    server.close();
    if (accountId) {
      await repository.db.query('DELETE FROM oldko.account_sessions WHERE account_id=$1', [accountId]);
      await repository.db.query('DELETE FROM oldko.account_action_tokens WHERE account_id=$1', [accountId]);
      await repository.db.query('DELETE FROM oldko.accounts WHERE id=$1', [accountId]);
    }
    await rateLimitStore.close();
    await repository.db.end();
  }
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
  } finally {
    await Promise.all([a.close(), b.close()]);
  }
});
