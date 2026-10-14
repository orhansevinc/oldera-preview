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
import { digestToken } from '../../services/account-api/src/security.js';

const enabled = process.env.OLDKO_POSTGRES_INTEGRATION === '1';
const integration = enabled ? test : test.skip;
const origin = 'https://oldkoweb.com';

class CaptureDelivery {
  constructor() { this.verifications = []; this.resets = []; }
  async sendVerification(payload) { this.verifications.push(payload); return { accepted: true, provider: 'ci-capture', providerMessageId: `verify-${this.verifications.length}` }; }
  async sendPasswordReset(payload) { this.resets.push(payload); return { accepted: true, provider: 'ci-capture', providerMessageId: `reset-${this.resets.length}` }; }
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
  return { username, email: `${username.toLowerCase()}@example.test`, password: 'Prod!Pwd1234' };
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

  async function registerOnly() {
    const register = await jsonRequest(base, '/api/account/v1/accounts/register', { method: 'POST', headers: { origin }, body: account });
    assert.equal(register.status, 201);
    assert.equal(delivery.verifications.length, 1);
    const stored = await repository.findByUsernameCanonical(account.username.toLowerCase());
    assert.ok(stored);
    accountId = stored.id;
    return stored;
  }

  async function verifyLatest() {
    assert.equal(delivery.verifications.length, 1);
    const verify = await jsonRequest(base, '/api/account/v1/accounts/verification/confirm', { method: 'POST', headers: { origin }, body: { token: delivery.verifications[0].token } });
    assert.equal(verify.status, 200);
    return repository.findById(accountId);
  }

  async function registerAndVerify() {
    await registerOnly();
    return verifyLatest();
  }

  async function cleanup() {
    const closed = new Promise((resolve) => server.close(resolve));
    server.closeAllConnections?.();
    await closed;
    await repository.db.query('TRUNCATE oldko.account_rate_limits');
    await rateLimitStore.close();
    await repository.db.end();
  }

  return { repository, delivery, base, account, ws07, registerOnly, verifyLatest, registerAndVerify, cleanup };
}

integration('production runtime pins the exact WS07 PostgreSQL adapter and shared rate limiter', async () => {
  const env = { ...process.env, NODE_ENV: 'production', OLDKO_ACCOUNT_ALLOWED_ORIGINS: 'https://oldkoweb.com', OLDKO_TRUST_PROXY: '1', OLDKO_ACCOUNT_DELIVERY_WEBHOOK_URL: 'https://delivery.example.invalid/account', OLDKO_ACCOUNT_DELIVERY_WEBHOOK_SECRET: 'ci-only-placeholder-secret', OLDKO_ACCOUNT_MAIL_FROM: 'accounts@oldkoweb.com' };
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

integration('PostgreSQL register persists canonical WS07-compatible hash', async () => {
  const f = await fixture('Reg');
  try {
    assert.equal((await fetch(`${f.base}/api/account/readyz`)).status, 200);
    const stored = await f.registerOnly();
    assert.match(stored.passwordHash, /^scrypt\$/);
    assert.equal(await f.ws07.verifyPassword(f.account.password, stored.passwordHash), true);
    assert.equal(await f.ws07.verifyPassword('Wrong!Password', stored.passwordHash), false);
    assert.equal(stored.verifiedAt, null);
  } finally { await f.cleanup(); }
});

integration('PostgreSQL verification confirms real action token', async () => {
  const f = await fixture('Ver');
  try {
    await f.registerOnly();
    const verified = await f.verifyLatest();
    assert.ok(verified.verifiedAt);
  } finally { await f.cleanup(); }
});

integration('PostgreSQL login current logout and revoked session', async () => {
  const f = await fixture('Sess');
  try {
    await f.registerAndVerify();
    const login = await jsonRequest(f.base, '/api/account/v1/session/login', { method: 'POST', headers: { origin }, body: { identifier: f.account.email, password: f.account.password } });
    assert.equal(login.status, 200);
    assert.equal((await login.clone().json()).credentialUpgradeRequired, false);
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
  const nextPassword = 'Prod!Pwd1235';
  try {
    await f.registerAndVerify();
    const login = await jsonRequest(f.base, '/api/account/v1/session/login', { method: 'POST', headers: { origin }, body: { identifier: f.account.username, password: f.account.password } });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';', 1)[0];
    const change = await jsonRequest(f.base, '/api/account/v1/password/change', { method: 'POST', headers: { origin, cookie }, body: { username: f.account.username, currentPassword: f.account.password, newPassword: nextPassword } });
    assert.equal(change.status, 200);
    assert.equal((await jsonRequest(f.base, '/api/account/v1/session/current', { headers: { cookie, origin } })).status, 401);
    assert.equal((await jsonRequest(f.base, '/api/account/v1/session/login', { method: 'POST', headers: { origin }, body: { identifier: f.account.username, password: f.account.password } })).status, 401);
    assert.equal((await jsonRequest(f.base, '/api/account/v1/session/login', { method: 'POST', headers: { origin }, body: { identifier: f.account.username, password: nextPassword } })).status, 200);
  } finally { await f.cleanup(); }
});

integration('PostgreSQL password reset rotates credential', async () => {
  const f = await fixture('Rst');
  const nextPassword = 'Prod!Pwd1236';
  try {
    await f.registerAndVerify();
    const resetRequest = await jsonRequest(f.base, '/api/account/v1/password-reset/request', { method: 'POST', headers: { origin }, body: { email: f.account.email } });
    assert.equal(resetRequest.status, 202);
    assert.equal(f.delivery.resets.length, 1);
    const resetConfirm = await jsonRequest(f.base, '/api/account/v1/password-reset/confirm', { method: 'POST', headers: { origin }, body: { token: f.delivery.resets[0].token, newPassword: nextPassword } });
    assert.equal(resetConfirm.status, 200);
    assert.equal((await jsonRequest(f.base, '/api/account/v1/session/login', { method: 'POST', headers: { origin }, body: { identifier: f.account.username, password: f.account.password } })).status, 401);
    assert.equal((await jsonRequest(f.base, '/api/account/v1/session/login', { method: 'POST', headers: { origin }, body: { identifier: f.account.username, password: nextPassword } })).status, 200);
  } finally { await f.cleanup(); }
});

integration('PostgreSQL credential envelope rejects unsupported writes, preserves reset token on policy failure, rejects bad Origin, and enforces token expiry/use-once', async () => {
  const f = await fixture('Env');
  try {
    const evilRegister = await jsonRequest(f.base, '/api/account/v1/accounts/register', { method: 'POST', headers: { origin: 'https://evil.example' }, body: f.account });
    assert.equal(evilRegister.status, 403);
    const tooLong = { ...f.account, password: 'Prod!Pwd12345' };
    assert.equal(Buffer.byteLength(tooLong.password, 'utf8'), 13);
    const badRegister = await jsonRequest(f.base, '/api/account/v1/accounts/register', { method: 'POST', headers: { origin }, body: tooLong });
    assert.equal(badRegister.status, 400);

    await f.registerAndVerify();
    const gameCheck = await jsonRequest(f.base, '/api/account/v1/accounts/access-check', { method: 'POST', body: { username: f.account.username, password: f.account.password } });
    assert.equal(gameCheck.status, 200);
    assert.equal((await gameCheck.json()).access, 'allowed');
    const evilLogin = await jsonRequest(f.base, '/api/account/v1/session/login', { method: 'POST', headers: { origin: 'https://evil.example' }, body: { identifier: f.account.username, password: f.account.password } });
    assert.equal(evilLogin.status, 403);
    const badChange = await jsonRequest(f.base, '/api/account/v1/password/change', { method: 'POST', headers: { origin }, body: { username: f.account.username, currentPassword: f.account.password, newPassword: 'Prod!Pwd12345' } });
    assert.equal(badChange.status, 400);

    assert.equal((await jsonRequest(f.base, '/api/account/v1/password-reset/request', { method: 'POST', headers: { origin }, body: { email: f.account.email } })).status, 202);
    const token = f.delivery.resets[0].token;
    const badReset = await jsonRequest(f.base, '/api/account/v1/password-reset/confirm', { method: 'POST', headers: { origin }, body: { token, newPassword: 'Prod!Pwd12345' } });
    assert.equal(badReset.status, 400);
    const goodReset = await jsonRequest(f.base, '/api/account/v1/password-reset/confirm', { method: 'POST', headers: { origin }, body: { token, newPassword: 'Prod!Pwd1237' } });
    assert.equal(goodReset.status, 200);
    assert.equal((await jsonRequest(f.base, '/api/account/v1/password-reset/confirm', { method: 'POST', headers: { origin }, body: { token, newPassword: 'Prod!Pwd1238' } })).status, 400);

    assert.equal((await jsonRequest(f.base, '/api/account/v1/password-reset/request', { method: 'POST', headers: { origin }, body: { email: f.account.email } })).status, 202);
    const expiredToken = f.delivery.resets[1].token;
    await f.repository.db.query('UPDATE oldko.account_action_tokens SET expires_at=now() - interval \'1 second\' WHERE token_hash=$1', [Buffer.from(digestToken(expiredToken), 'hex')]);
    assert.equal((await jsonRequest(f.base, '/api/account/v1/password-reset/confirm', { method: 'POST', headers: { origin }, body: { token: expiredToken, newPassword: 'Prod!Pwd1239' } })).status, 400);
  } finally { await f.cleanup(); }
});

integration('PostgreSQL official frontend password aliases execute against the production /api/account base', async () => {
  const f = await fixture('Ali');
  try {
    await f.registerAndVerify();
    const changed = 'Prod!Pwd1235';
    const change = await jsonRequest(f.base, '/api/account/v1/accounts/password/change', { method: 'POST', headers: { origin }, body: { username: f.account.username, currentPassword: f.account.password, newPassword: changed } });
    assert.equal(change.status, 200);
    const request = await jsonRequest(f.base, '/api/account/v1/accounts/password-reset/request', { method: 'POST', headers: { origin }, body: { username: f.account.username } });
    assert.equal(request.status, 202);
    const finalPassword = 'Prod!Pwd1236';
    const confirm = await jsonRequest(f.base, '/api/account/v1/accounts/password-reset/confirm', { method: 'POST', headers: { origin }, body: { token: f.delivery.resets[0].token, newPassword: finalPassword } });
    assert.equal(confirm.status, 200);
    assert.equal((await jsonRequest(f.base, '/api/account/v1/session/login', { method: 'POST', headers: { origin }, body: { identifier: f.account.username, password: finalPassword } })).status, 200);
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
