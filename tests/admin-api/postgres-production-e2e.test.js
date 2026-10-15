'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');

const adminRoot = path.resolve(__dirname, '../../services/admin-api/src');
const { createProductionAdminApi } = require(path.join(adminRoot, 'production-app'));
const { createWs28CommandExecutor } = require(path.join(adminRoot, 'ws28-command-executor'));
const { createAdminRepository, PINNED_WS07_SOURCE } = require(path.join(adminRoot, 'ws07-admin-repository-module'));
const { hashPassword } = require(path.join(adminRoot, 'security'));

const ORIGIN = 'https://admin.oldkoweb.com';
const SECRET = 'ws08-postgres-production-test-secret-000000000000';

function cookieJar(setCookie) {
  const values = Array.isArray(setCookie) ? setCookie : [setCookie];
  return values.filter(Boolean).map((value) => value.split(';')[0]).join('; ');
}

async function startApi(repository, users, commandBus) {
  const runtimeAuthority = {
    async listOnlineCharacters() { return []; },
    async getCharacterState(name) { return { name, online: false }; },
    async mutateOnlineCharacter() { throw new Error('offline test must not use runtime mutation'); }
  };
  const commandExecutor = createWs28CommandExecutor({ repository, commandBus });
  const api = createProductionAdminApi({
    repository,
    runtimeAuthority,
    commandExecutor,
    users,
    rootOwnerId: users[0].id,
    sessionSecret: SECRET,
    allowedOrigins: [ORIGIN],
    secureCookies: false
  });
  const server = http.createServer(api.handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/admin`;
  return {
    base,
    async close() {
      server.closeIdleConnections?.();
      await new Promise((resolve) => server.close(resolve));
    },
    async request(route, { method = 'GET', cookie, csrf, body, idempotencyKey } = {}) {
      const headers = { origin: ORIGIN, connection: 'close' };
      if (cookie) headers.cookie = cookie;
      if (csrf) headers['x-csrf-token'] = csrf;
      if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
      if (body !== undefined) headers['content-type'] = 'application/json';
      return fetch(`${base}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    }
  };
}

async function closeQuietly(resource) {
  try { await resource?.close?.(); } catch {}
}

test('WS08 real PostgreSQL production persistence survives restart and keeps authoritative outbox status', { skip: !process.env.DATABASE_URL, timeout: 60_000 }, async () => {
  const stamp = `${Date.now()}${process.pid}`.slice(-12);
  const username = `w8${stamp}`.slice(0, 30);
  const character = `W8${stamp.slice(-8)}`.slice(0, 20);
  const adminId = `ws08-owner-${stamp}`;
  const adminName = `WS08OWNER${stamp}`.slice(0, 64);
  const password = 'root-pass';
  const users = [{ id: adminId, username: adminName, passwordHash: hashPassword(password, `salt-${stamp}`), roles: ['VIEWER'] }];
  const env = {
    ...process.env,
    ADMIN_USERS_JSON: JSON.stringify(users),
    ADMIN_ROOT_OWNER_ID: adminId,
    DATABASE_URL: process.env.DATABASE_URL
  };

  const { createPool } = await import(`file://${path.resolve(__dirname, '../../services/oldko-data/src/index.js')}`);
  const seedPool = createPool({ connectionString: process.env.DATABASE_URL, applicationName: 'ws08-e2e-seed', max: 2 });
  try {
    const account = await seedPool.query(
      `INSERT INTO oldko.accounts(username,username_key,password_hash,email,status,nation,verified_at)
       VALUES($1,$2,'fixture-hash',$3,'active',1,now()) RETURNING id`,
      [username, username.toLowerCase(), `${username}@example.test`]
    );
    const accountId = account.rows[0].id;
    const created = await seedPool.query(
      `INSERT INTO oldko.characters(account_id,slot,name,name_key,nation,race,class_id,zone_id,pos_x,pos_y,pos_z)
       VALUES($1,0,$2,$3,1,1,101,21,321,0,654) RETURNING id`,
      [accountId, character, character.toLowerCase()]
    );
    await seedPool.query(
      `INSERT INTO oldko.character_stats(character_id,level,loyalty,gold,str,sta,dex,intel,cha)
       VALUES($1,3,111,222,60,61,62,63,64)`,
      [created.rows[0].id]
    );
  } finally {
    await seedPool.end();
  }

  const pendingBus = { async execute(request) { return { requestId: request.requestId, status: 'pending', code: 'QUEUED', forwarded: false }; } };
  let repositoryA; let repositoryB; let repositoryC;
  let appA; let appB; let appC;

  try {
    repositoryA = await createAdminRepository({ env });
    assert.equal(repositoryA.ws07SourceCommit, PINNED_WS07_SOURCE);
    appA = await startApi(repositoryA, users, pendingBus);

    let response = await appA.request('/session/login', { method: 'POST', body: { user: adminName, password } });
    assert.equal(response.status, 200);
    const login = await response.json();
    assert.deepEqual(login.user.roles, ['VIEWER', 'OWNER']);
    const cookie = cookieJar(response.headers.getSetCookie ? response.headers.getSetCookie() : response.headers.get('set-cookie'));
    const csrf = login.csrfToken;

    response = await appA.request('/overview', { cookie });
    assert.equal(response.status, 200);
    assert.ok((await response.json()).overview.characters >= 1);

    response = await appA.request(`/players?q=${encodeURIComponent(character)}`, { cookie });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).players[0].name, character);

    response = await appA.request(`/characters/${encodeURIComponent(character)}`, { cookie });
    assert.equal(response.status, 200);
    const before = (await response.json()).character;
    assert.equal(before.level, 3);
    assert.equal(before.version, 1);

    const mutation = { level: 4, expectedVersion: before.version, reason: 'controlled offline mutation' };
    response = await appA.request(`/characters/${encodeURIComponent(character)}`, {
      method: 'PATCH', cookie, csrf, idempotencyKey: `mut-${stamp}`, body: mutation
    });
    assert.equal(response.status, 200);
    const firstMutation = await response.json();
    assert.equal(firstMutation.value.level, 4);
    assert.equal(firstMutation.value.version, 2);
    assert.equal(firstMutation.idempotentReplay, false);

    response = await appA.request(`/characters/${encodeURIComponent(character)}`, {
      method: 'PATCH', cookie, csrf, idempotencyKey: `mut-${stamp}`, body: mutation
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).idempotentReplay, true);

    response = await appA.request(`/characters/${encodeURIComponent(character)}`, {
      method: 'PATCH', cookie, csrf, idempotencyKey: `cas-${stamp}`, body: { level: 5, expectedVersion: 1, reason: 'stale cas must fail' }
    });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error, 'VERSION_CONFLICT');

    response = await appA.request('/audit?limit=50', { cookie });
    assert.equal(response.status, 200);
    assert.ok((await response.json()).entries.some((entry) => entry.action === 'CHARACTER_EDIT'));

    await appA.close(); appA = null;
    await repositoryA.close(); repositoryA = null;

    repositoryB = await createAdminRepository({ env });
    appB = await startApi(repositoryB, users, pendingBus);
    response = await appB.request('/session', { cookie });
    assert.equal(response.status, 200, 'session created by app A must survive app restart');

    response = await appB.request('/commands', {
      method: 'POST', cookie, csrf, idempotencyKey: `cmd-${stamp}`, body: { command: 'COUNT', reason: 'queue count command' }
    });
    assert.equal(response.status, 202);
    const queued = await response.json();
    assert.equal(queued.game.status, 'PENDING');
    assert.equal(queued.command.status, 'PENDING');

    response = await appB.request(`/commands/${queued.command.id}`, { cookie });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).command.status, 'PENDING');

    response = await appB.request('/session/logout', { method: 'POST', cookie, csrf });
    assert.equal(response.status, 200);
    await appB.close(); appB = null;
    await repositoryB.close(); repositoryB = null;

    repositoryC = await createAdminRepository({ env });
    appC = await startApi(repositoryC, users, pendingBus);
    response = await appC.request('/session', { cookie });
    assert.equal(response.status, 401, 'revoked session must remain revoked after another restart');
  } finally {
    await closeQuietly(appC);
    await closeQuietly(repositoryC);
    await closeQuietly(appB);
    await closeQuietly(repositoryB);
    await closeQuietly(appA);
    await closeQuietly(repositoryA);
  }
});
