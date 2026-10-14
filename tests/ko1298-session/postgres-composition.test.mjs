import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { LOGIN, GAME, Writer } = require('../../services/ko1298-session/protocol');
const { AuthSession, GameSession } = require('../../services/ko1298-session/session');
const { createProductionPostgresRepository } = require('../../services/ko1298-session/postgres-repository');
const { WorldSessionService } = require('../../services/ko1298-world');

const { PgWs13AccountRepository } = await import('../../services/oldko-data/src/adapters/ws13-account-api.js');
const { AccountService } = await import('../../services/account-api/src/service.js');
const { MemoryAuditSink } = await import('../../services/account-api/src/audit.js');

class CaptureDelivery {
  constructor() { this.verification = null; }
  async sendVerification(payload) { this.verification = structuredClone(payload); }
  async sendPasswordReset() {}
}

function credentials(opcode, username, password) {
  return new Writer().u8(opcode).str16(username).str16(password).done();
}

function createCharacter(name) {
  return new Writer()
    .u8(GAME.NEW_CHAR).u8(0).str16(name)
    .u8(1).i16(101).u8(1).u8(1)
    .u8(65).u8(65).u8(60).u8(50).u8(50)
    .done();
}

function selectCharacter(accountId, name) {
  return new Writer().u8(GAME.SEL_CHAR).str16(accountId).str16(name).u8(1).u8(21).done();
}

test('one PostgreSQL row powers WS13 register/verify/login and WS03 KO1298 auth + character world runtime', async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be provided by the PostgreSQL composition harness');
  const gameRepository = await createProductionPostgresRepository();
  try {
    const websiteRepository = new PgWs13AccountRepository(gameRepository.pool);
    const delivery = new CaptureDelivery();
    const website = new AccountService({
      repository: websiteRepository,
      delivery,
      audit: new MemoryAuditSink(),
    });

    const username = 'WebHero';
    const password = 'Ko!Pass2026';
    assert.ok(Buffer.byteLength(password, 'latin1') <= 12, 'KO1298 login credential envelope permits at most 12 password bytes');
    const context = { ip: '127.0.0.1', requestId: 'ws03-one-db-e2e', userAgent: 'ws03-ci' };

    const registration = await website.register({
      username,
      email: 'webhero@example.test',
      password,
    }, context);
    assert.equal(registration.username, username);
    assert.ok(delivery.verification?.token);

    assert.deepEqual(
      await website.confirmVerification({ token: delivery.verification.token }, context),
      { verified: true },
    );
    const websiteLogin = await website.login({ username, password }, context);
    assert.equal(websiteLogin.user.username, username);
    assert.equal(websiteLogin.user.verified, true);

    const { rows: accountRows } = await gameRepository.pool.query(
      `SELECT id,username,username_key,password_hash,verified_at
       FROM oldko.accounts WHERE username_key=$1`,
      ['webhero'],
    );
    assert.equal(accountRows.length, 1);
    assert.equal(accountRows[0].username, username);
    assert.equal(accountRows[0].username_key, 'webhero');
    assert.match(accountRows[0].password_hash, /^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9+/]+=*\$[A-Za-z0-9+/]+=*$/);
    assert.ok(accountRows[0].verified_at);

    const auth = new AuthSession(gameRepository);
    assert.deepEqual([...(await auth.handle(credentials(LOGIN.LOGIN_REQ, username, password)))[0]], [LOGIN.LOGIN_REQ, 1]);

    const world = new WorldSessionService({ repository: gameRepository });
    const game = new GameSession(gameRepository, { socketId: 777, worldSession: world });

    const version = (await game.handle(Buffer.from([GAME.VERSION_CHECK])))[0];
    assert.equal(version.readInt16LE(1), 1298);
    assert.deepEqual([...(await game.handle(credentials(GAME.LOGIN, username, password)))[0]], [GAME.LOGIN, 0]);
    assert.equal(game.account, 'webhero');

    assert.deepEqual([...(await game.handle(Buffer.from([GAME.SEL_NATION, 1])))[0]], [GAME.SEL_NATION, 1]);
    assert.equal((await game.handle(Buffer.from([GAME.ALLCHAR_INFO_REQ])))[0][0], GAME.ALLCHAR_INFO_REQ);

    const characterName = 'DbHero';
    assert.deepEqual([...(await game.handle(createCharacter(characterName)))[0]], [GAME.NEW_CHAR, 0]);

    const { rows: characterRows } = await gameRepository.pool.query(
      `SELECT c.id,c.account_id,a.id AS expected_account_id
       FROM oldko.characters c JOIN oldko.accounts a ON a.id=c.account_id
       WHERE c.name_key=lower($1)`,
      [characterName],
    );
    assert.equal(characterRows.length, 1);
    assert.equal(String(characterRows[0].account_id), String(accountRows[0].id));
    assert.equal(String(characterRows[0].expected_account_id), String(accountRows[0].id));

    assert.deepEqual([...(await game.handle(selectCharacter(username, characterName)))[0]].slice(0, 2), [GAME.SEL_CHAR, 1]);
    const loadingPackets = await game.handle(Buffer.from([GAME.GAMESTART, 1]));
    assert.ok(loadingPackets.some((packet) => packet[0] === GAME.GAMESTART));
    await game.handle(Buffer.from([GAME.GAMESTART, 2]));
    assert.equal(game.phase, 'WORLD_READY');

    await gameRepository.saveWorldPosition({
      accountId: username,
      characterId: characterName,
      zoneId: 21,
      x: 313,
      y: 0,
      z: 403,
    });
    const restored = await gameRepository.loadReconnectSnapshot(username, characterName);
    assert.equal(restored.accountId, 'webhero');
    assert.equal(restored.characterId, characterName);
    assert.equal(restored.zoneId, 21);
    assert.equal(restored.x, 313);
    assert.equal(restored.z, 403);

    const { rows: duplicateRows } = await gameRepository.pool.query(
      `SELECT username_key,count(*)::int AS copies FROM oldko.accounts
       WHERE username_key=$1 GROUP BY username_key`,
      ['webhero'],
    );
    assert.deepEqual(duplicateRows.map((row) => row.copies), [1]);
  } finally {
    await gameRepository.close();
  }
});
