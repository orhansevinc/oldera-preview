import net from 'node:net';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { LOGIN, GAME, Writer, frame, FrameDecoder } = require('../ko1298-session/protocol');
const { AuthSession, GameSession } = require('../ko1298-session/session');
const { createProductionPostgresRepository } = require('../ko1298-session/postgres-repository');
const { PgWs13AccountRepository } = await import('../oldko-data/src/adapters/ws13-account-api.js');
const { AccountService } = await import('../account-api/src/service.js');
const { MemoryAuditSink } = await import('../account-api/src/audit.js');

const mode = process.argv[2] || 'pre';
const username = process.env.CI_ACCOUNT_USER || 'Ws50Hero';
const password = process.env.CI_ACCOUNT_PASSWORD || 'Ko!Pass2026';
const characterName = process.env.CI_CHARACTER_NAME || 'Ws50Char';
const adminUser = process.env.CI_ADMIN_USER || 'owner';
const adminPassword = process.env.CI_ADMIN_PASSWORD;
const adminOrigin = process.env.CI_ADMIN_ORIGIN || 'http://localhost:18088';
const accountOrigin = process.env.CI_ACCOUNT_ORIGIN || 'http://localhost:18088';
const expectedLevel = Number(process.env.CI_EXPECTED_LEVEL || 3);
if (!adminPassword) throw new Error('CI_ADMIN_PASSWORD is required');

class CaptureDelivery {
  constructor() { this.verification = null; }
  async sendVerification(payload) { this.verification = structuredClone(payload); }
  async sendPasswordReset() {}
}

function credentials(opcode, user, pass) {
  return new Writer().u8(opcode).str16(user).str16(pass).done();
}
function createCharacter(name) {
  return new Writer().u8(GAME.NEW_CHAR).u8(0).str16(name).u8(1).i16(101).u8(1).u8(1).u8(65).u8(65).u8(60).u8(50).u8(50).done();
}
function selectCharacter(user, name) {
  return new Writer().u8(GAME.SEL_CHAR).str16(user).str16(name).u8(1).u8(21).done();
}

async function seedRealAccountAndCharacter() {
  const repo = await createProductionPostgresRepository();
  try {
    const websiteRepository = new PgWs13AccountRepository(repo.pool);
    const delivery = new CaptureDelivery();
    const website = new AccountService({ repository: websiteRepository, delivery, audit: new MemoryAuditSink() });
    const context = { ip: '127.0.0.1', requestId: 'ws50-real-smoke-seed', userAgent: 'ws50-ci' };
    await website.register({ username, email: 'ws50-real-smoke@example.test', password }, context);
    assert.ok(delivery.verification?.token, 'real WS13 verification token was not created');
    await website.confirmVerification({ token: delivery.verification.token }, context);
    const auth = await website.login({ username, password }, context);
    assert.equal(auth.user.verified, true);

    const game = new GameSession(repo, { socketId: 64000 });
    assert.deepEqual([...(await game.handle(credentials(GAME.LOGIN, username, password)))[0]], [GAME.LOGIN, 0]);
    assert.deepEqual([...(await game.handle(Buffer.from([GAME.SEL_NATION, 1])))[0]], [GAME.SEL_NATION, 1]);
    assert.deepEqual([...(await game.handle(createCharacter(characterName)))[0]], [GAME.NEW_CHAR, 0]);
    await game.disconnect({ reason: 'WS50_SEED_COMPLETE', useGrace: false });
  } finally {
    await repo.close().catch(() => {});
  }
}

async function openRealGameSession() {
  const socket = net.createConnection({ host: '127.0.0.1', port: Number(process.env.GAME_PORT || 15001) });
  const decoder = new FrameDecoder(65535);
  const queue = [];
  const waiters = [];
  let closed = false;
  socket.on('data', (chunk) => {
    for (const payload of decoder.push(chunk)) {
      const waiter = waiters.shift();
      if (waiter) waiter.resolve(payload); else queue.push(payload);
    }
  });
  socket.on('close', () => { closed = true; while (waiters.length) waiters.shift().reject(new Error('game socket closed')); });
  socket.on('error', (error) => { while (waiters.length) waiters.shift().reject(error); });
  await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject); });

  const next = (timeoutMs = 5000) => new Promise((resolve, reject) => {
    if (queue.length) return resolve(queue.shift());
    const entry = { resolve, reject };
    waiters.push(entry);
    const timer = setTimeout(() => {
      const index = waiters.indexOf(entry); if (index >= 0) waiters.splice(index, 1);
      reject(new Error('timed out waiting for KO1298 frame'));
    }, timeoutMs);
    entry.resolve = (value) => { clearTimeout(timer); resolve(value); };
    entry.reject = (error) => { clearTimeout(timer); reject(error); };
  });
  const send = async (payload, opcode) => {
    socket.write(frame(payload));
    const response = await next();
    assert.equal(response[0], opcode, `unexpected KO1298 opcode ${response[0]} expected ${opcode}`);
    return response;
  };

  const version = await send(Buffer.from([GAME.VERSION_CHECK]), GAME.VERSION_CHECK);
  assert.equal(version.readInt16LE(1), 1298);
  const login = await send(credentials(GAME.LOGIN, username, password), GAME.LOGIN);
  assert.equal(login[1], 1, 'real KO1298 transport login failed');
  await send(Buffer.from([GAME.ALLCHAR_INFO_REQ]), GAME.ALLCHAR_INFO_REQ);
  const selected = await send(selectCharacter(username, characterName), GAME.SEL_CHAR);
  assert.equal(selected[1], 1, 'real character selection failed');
  socket.write(frame(Buffer.from([GAME.GAMESTART, 1])));
  await new Promise((resolve) => setTimeout(resolve, 300));
  socket.write(frame(Buffer.from([GAME.GAMESTART, 2])));
  await new Promise((resolve) => setTimeout(resolve, 500));
  return { socket, isClosed: () => closed };
}

async function adminLogin() {
  const response = await fetch('http://127.0.0.1:8088/api/admin/session/login', {
    method: 'POST', headers: { 'content-type': 'application/json', origin: adminOrigin },
    body: JSON.stringify({ user: adminUser, password: adminPassword })
  });
  assert.equal(response.status, 200, `admin login failed: ${await response.text()}`);
  const payload = await response.json();
  const setCookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [response.headers.get('set-cookie') || ''];
  const cookie = setCookies.filter(Boolean).map((value) => value.split(';')[0]).join('; ');
  assert.match(cookie, /oldko_admin_session=/);
  assert.ok(payload.csrfToken);
  return { cookie, csrf: payload.csrfToken };
}

async function adminJson(path, auth, { method = 'GET', body = null, idempotencyKey = null } = {}) {
  const headers = { cookie: auth.cookie, origin: adminOrigin };
  if (body !== null) { headers['content-type'] = 'application/json'; headers['x-csrf-token'] = auth.csrf; }
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
  const response = await fetch(`http://127.0.0.1:8088${path}`, { method, headers, ...(body === null ? {} : { body: JSON.stringify(body) }) });
  const text = await response.text();
  let payload; try { payload = JSON.parse(text); } catch { payload = { raw: text }; }
  return { response, payload };
}

async function verifyAccountApiLogin() {
  const response = await fetch('http://account-api:8081/api/account/v1/session/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: accountOrigin },
    body: JSON.stringify({ username, password })
  });
  const text = await response.text();
  assert.equal(response.status, 200, `real account API login failed: ${text}`);
  const payload = JSON.parse(text);
  assert.equal(payload.user.username, username);
}

async function verifyPersistentRepository() {
  const repo = await createProductionPostgresRepository();
  try {
    const accepted = (await new AuthSession(repo).handle(credentials(LOGIN.LOGIN_REQ, username, password)))[0];
    assert.equal(accepted[1], 1, 'KO auth after restart failed');
    const chars = await repo.listCharacters(username);
    const character = chars.find((row) => row.characterId === characterName);
    assert.ok(character, 'character missing after restart');
    assert.equal(Number(character.level), expectedLevel, 'admin character edit did not persist');
  } finally { await repo.close().catch(() => {}); }
}

async function preRestart() {
  await seedRealAccountAndCharacter();
  await verifyAccountApiLogin();
  const game = await openRealGameSession();
  const auth = await adminLogin();

  const count = await adminJson('/api/admin/commands', auth, { method: 'POST', idempotencyKey: 'ws50-count-0001', body: { command: 'COUNT', reason: 'WS50 real downstream count' } });
  assert.equal(count.response.status, 200, JSON.stringify(count.payload));
  assert.equal(count.payload.game?.status, 'SUCCEEDED');
  assert.equal(count.payload.game?.data?.applied, true);
  assert.ok(Number(count.payload.game?.data?.count) >= 1, 'real runtime did not observe the online player');

  const before = await adminJson(`/api/admin/characters/${encodeURIComponent(characterName)}`, auth);
  assert.equal(before.response.status, 200, JSON.stringify(before.payload));
  assert.equal(before.payload.character?.online, true);
  const expectedVersion = Number(before.payload.character?.version);
  assert.ok(Number.isSafeInteger(expectedVersion) && expectedVersion >= 1);

  const edit = await adminJson(`/api/admin/characters/${encodeURIComponent(characterName)}`, auth, {
    method: 'PATCH', idempotencyKey: 'ws50-edit-0001',
    body: { level: expectedLevel, expectedVersion, reason: 'WS50 real online admin edit' }
  });
  assert.equal(edit.response.status, 200, JSON.stringify(edit.payload));
  assert.equal(edit.payload.value?.authority, 'WS03_SESSION_AUTHORITY+WS07_POSTGRES');

  const cutoff = await adminJson('/api/admin/commands', auth, {
    method: 'POST', idempotencyKey: 'ws50-cutoff-0001',
    body: { command: 'CUTOFF', target: characterName, reason: 'WS50 real downstream cutoff' }
  });
  assert.equal(cutoff.response.status, 200, JSON.stringify(cutoff.payload));
  assert.equal(cutoff.payload.game?.status, 'SUCCEEDED');
  assert.equal(cutoff.payload.game?.data?.applied, true);
  for (let i = 0; i < 30 && !game.isClosed(); i += 1) await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(game.isClosed(), true, 'CUTOFF did not close the real KO TCP session');
  console.log(JSON.stringify({ event: 'ws50-real-smoke', phase: 'pre-restart', accountLogin: 'PASS', characterReturn: 'PASS', onlineAdminMutation: 'PASS', count: 'PASS', cutoff: 'PASS' }));
}

async function postRestart() {
  await verifyAccountApiLogin();
  await verifyPersistentRepository();
  const game = await openRealGameSession();
  const auth = await adminLogin();
  const after = await adminJson(`/api/admin/characters/${encodeURIComponent(characterName)}`, auth);
  assert.equal(after.response.status, 200, JSON.stringify(after.payload));
  assert.equal(Number(after.payload.character?.level), expectedLevel);
  game.socket.end();
  console.log(JSON.stringify({ event: 'ws50-real-smoke', phase: 'post-restart', accountLogin: 'PASS', gameLoginAndCharacterReturn: 'PASS', adminPersistence: 'PASS' }));
}

if (mode === 'pre') await preRestart();
else if (mode === 'post') await postRestart();
else throw new Error(`unknown mode: ${mode}`);
