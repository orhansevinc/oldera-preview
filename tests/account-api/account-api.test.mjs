import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { InMemoryAccountRepository } from '../../services/account-api/src/repository.js';
import { MemoryAuditSink } from '../../services/account-api/src/audit.js';
import { AccountService } from '../../services/account-api/src/service.js';
import { createHttpServer } from '../../services/account-api/src/http.js';
import { openApiDocument } from '../../services/account-api/src/openapi.js';
import { isGameCompatiblePassword, normalizeUsername, validatePassword } from '../../services/account-api/src/validation.js';

class CaptureDelivery {
  constructor() { this.verifications = []; this.resets = []; }
  async sendVerification(payload) { this.verifications.push(payload); return { accepted: true, provider: 'test', providerMessageId: `verify-${this.verifications.length}` }; }
  async sendPasswordReset(payload) { this.resets.push(payload); return { accepted: true, provider: 'test', providerMessageId: `reset-${this.resets.length}` }; }
}

function fixture() {
  const repository = new InMemoryAccountRepository();
  const delivery = new CaptureDelivery();
  const audit = new MemoryAuditSink();
  let now = 1_800_000_000_000;
  const service = new AccountService({ repository, delivery, audit, clock: () => now });
  return { repository, delivery, audit, service, tick: (ms) => { now += ms; } };
}

const ctx = (ip = '203.0.113.5') => ({ ip, requestId: 'test-request-0001' });
const account = { username: 'PlayerOne', email: 'player@example.test', password: 'Str0ng!Pwd12' };

test('KO1298 credential policy is byte-exact and never silently trims or normalizes', () => {
  assert.equal(Buffer.byteLength(account.password, 'utf8'), 12);
  assert.equal(isGameCompatiblePassword(account.password), true);
  assert.equal(validatePassword(account.password), account.password);
  assert.throws(() => validatePassword('Str0ng!Pwd123'), (e) => e.code === 'WEAK_PASSWORD');
  assert.throws(() => validatePassword('Ştr0ng!Pwd1'), (e) => e.code === 'WEAK_PASSWORD');
  assert.throws(() => validatePassword(' Str0ng!Pwd1'), (e) => e.code === 'WEAK_PASSWORD');
  assert.throws(() => normalizeUsername(' PlayerOne'), (e) => e.code === 'INVALID_USERNAME');
  assert.deepEqual(normalizeUsername('PlayerOne'), { username: 'PlayerOne', canonical: 'playerone' });
});

test('registration hashes password and enforces canonical uniqueness', async () => {
  const f = fixture();
  const created = await f.service.register(account, ctx());
  const stored = await f.repository.findByUsernameCanonical('playerone');
  assert.equal(created.username, 'PlayerOne');
  assert.match(stored.passwordHash, /^scrypt\$/);
  assert.equal(stored.passwordHash.includes(account.password), false);
  assert.equal(f.delivery.verifications.length, 1);
  await assert.rejects(() => f.service.register({ ...account, username: 'PLAYERONE', email: 'other@example.test' }, ctx('203.0.113.6')), (e) => e.code === 'USERNAME_TAKEN');
});

test('verification gates access and ban status is returned only after valid credentials', async () => {
  const f = fixture();
  await f.service.register(account, ctx());
  await assert.rejects(() => f.service.accessCheck({ username: account.username, password: account.password }, ctx()), (e) => e.code === 'ACCOUNT_UNVERIFIED');
  await f.service.confirmVerification({ token: f.delivery.verifications[0].token }, ctx());
  assert.equal((await f.service.accessCheck({ username: account.username, password: account.password }, ctx())).access, 'allowed');
  const stored = await f.repository.findByUsernameCanonical('playerone');
  await f.repository.updateAccount(stored.id, { ban: { active: true, code: 'GM_BAN', until: null } });
  await assert.rejects(() => f.service.accessCheck({ username: account.username, password: account.password }, ctx('203.0.113.8')), (e) => e.status === 423 && e.details.permanent === true);
  await assert.rejects(() => f.service.accessCheck({ username: account.username, password: 'Wrong!Pass123' }, ctx('203.0.113.9')), (e) => e.code === 'INVALID_CREDENTIALS');
});

test('legacy web credential can sign in only as upgrade-required and can migrate without truncation', async () => {
  const f = fixture();
  await f.service.register(account, ctx());
  await f.service.confirmVerification({ token: f.delivery.verifications[0].token }, ctx());
  const stored = await f.repository.findByUsernameCanonical('playerone');
  const legacyPassword = 'Legacy!Password123';
  await f.repository.updateAccount(stored.id, { passwordHash: await f.service.hasher.hash(legacyPassword) });
  const login = await f.service.login({ identifier: account.username, password: legacyPassword }, ctx('203.0.113.40'));
  assert.equal(login.credentialUpgradeRequired, true);
  await assert.rejects(() => f.service.accessCheck({ username: account.username, password: legacyPassword }, ctx('203.0.113.41')), (e) => e.code === 'CREDENTIAL_UPGRADE_REQUIRED');
  const nextPassword = 'N3w!Pass1234';
  await f.service.changePassword({ username: account.username, currentPassword: legacyPassword, newPassword: nextPassword }, ctx('203.0.113.42'));
  await assert.rejects(() => f.service.accessCheck({ username: account.username, password: legacyPassword }, ctx('203.0.113.43')), (e) => e.code === 'INVALID_CREDENTIALS');
  assert.equal((await f.service.accessCheck({ username: account.username, password: nextPassword }, ctx('203.0.113.44'))).access, 'allowed');
});

test('password reset is non-enumerating, stores only token digest, validates new password before consuming token, and rotates password version', async () => {
  const f = fixture();
  await f.service.register(account, ctx());
  const unknown = await f.service.requestPasswordReset({ email: 'missing@example.test' }, ctx('203.0.113.10'));
  assert.deepEqual(unknown, { accepted: true });
  assert.equal(f.delivery.resets.length, 0);
  await f.service.requestPasswordReset({ email: account.email }, ctx('203.0.113.11'));
  const token = f.delivery.resets[0].token;
  assert.equal(JSON.stringify([...f.repository.actionTokens.values()]).includes(token), false);
  const before = await f.repository.findByUsernameCanonical('playerone');
  await assert.rejects(() => f.service.confirmPasswordReset({ token, newPassword: 'Str0ng!Pwd123' }, ctx()), (e) => e.code === 'WEAK_PASSWORD');
  await f.service.confirmPasswordReset({ token, newPassword: 'N3w!Pass1234' }, ctx());
  const after = await f.repository.findByUsernameCanonical('playerone');
  assert.equal(after.passwordVersion, before.passwordVersion + 1);
  await assert.rejects(() => f.service.confirmPasswordReset({ token, newPassword: 'An0!Pass1234' }, ctx('203.0.113.12')), (e) => e.code === 'INVALID_OR_EXPIRED_TOKEN');
});

test('credential brute-force protection rate limits repeated failures', async () => {
  const f = fixture();
  await f.service.register(account, ctx());
  for (let i = 0; i < 8; i++) {
    await assert.rejects(() => f.service.changePassword({ username: account.username, currentPassword: 'Wrong!Pass123', newPassword: 'N3w!Pass1234' }, ctx('198.51.100.20')), (e) => e.code === 'INVALID_CREDENTIALS');
  }
  await assert.rejects(() => f.service.changePassword({ username: account.username, currentPassword: 'Wrong!Pass123', newPassword: 'N3w!Pass1234' }, ctx('198.51.100.20')), (e) => e.status === 429 && e.code === 'RATE_LIMITED');
});

test('health and OpenAPI endpoints are exposed without secrets', async () => {
  const f = fixture();
  const server = createHttpServer({ service: f.service, openApiDocument, allowedOrigins: ['https://oldkoweb.com'] });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  const health = await fetch(`http://127.0.0.1:${port}/healthz`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).service, 'oldko-account-api');
  const spec = await (await fetch(`http://127.0.0.1:${port}/openapi.json`)).json();
  assert.ok(spec.paths['/v1/accounts/register']);
  assert.equal(JSON.stringify(spec).includes('passwordHash'), false);
  server.close();
});

test('successful credential checks do not accumulate brute-force failures', async () => {
  const f = fixture();
  await f.service.register(account, ctx());
  await f.service.confirmVerification({ token: f.delivery.verifications[0].token }, ctx());
  for (let i = 0; i < 20; i++) {
    const result = await f.service.accessCheck({ username: account.username, password: account.password }, ctx('192.0.2.44'));
    assert.equal(result.access, 'allowed');
  }
});

test('delivery failure does not enumerate existing reset accounts', async () => {
  const repository = new InMemoryAccountRepository();
  const audit = new MemoryAuditSink();
  const failingDelivery = {
    async sendVerification() {},
    async sendPasswordReset() { throw new Error('provider down'); }
  };
  const service = new AccountService({ repository, delivery: failingDelivery, audit });
  await service.register(account, ctx('192.0.2.50'));
  const existing = await service.requestPasswordReset({ email: account.email }, ctx('192.0.2.51'));
  const missing = await service.requestPasswordReset({ email: 'missing@example.test' }, ctx('192.0.2.52'));
  assert.deepEqual(existing, { accepted: true });
  assert.deepEqual(missing, { accepted: true });
  assert.ok(audit.events.some((e) => e.event === 'delivery_failed' && e.kind === 'password_reset'));
});
