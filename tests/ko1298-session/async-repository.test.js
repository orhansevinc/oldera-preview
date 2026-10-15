'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { LOGIN, GAME, Writer } = require('../../services/ko1298-session/protocol');
const { MemoryRepository } = require('../../services/ko1298-session/repository');
const { AuthSession, GameSession } = require('../../services/ko1298-session/session');

class AsyncRepository {
  constructor(inner = new MemoryRepository()) { this.inner = inner; }
  normalizeAccountId(value) { return String(value).trim().toLowerCase(); }
  async authenticate(...args) { return this.inner.authenticate(...args); }
  async getNation(...args) { return this.inner.getNation(...args); }
  async setNation(...args) { return this.inner.setNation(...args); }
  async listCharacters(...args) { return this.inner.listCharacters(...args); }
  async createCharacter(...args) { return this.inner.createCharacter(...args); }
  async getCharacter(...args) { return this.inner.getCharacter(...args); }
}

function credentials(opcode, username = 'osevinc', password = 'osevinc') {
  return new Writer().u8(opcode).str16(username).str16(password).done();
}

function createCharacter(name = 'AsyncHero') {
  return new Writer()
    .u8(GAME.NEW_CHAR).u8(0).str16(name)
    .u8(12).i16(201).u8(1).u8(2)
    .u8(60).u8(60).u8(70).u8(50).u8(50)
    .done();
}

function selectCharacter(accountId = 'osevinc', name = 'AsyncHero') {
  return new Writer().u8(GAME.SEL_CHAR).str16(accountId).str16(name).u8(1).u8(21).done();
}

test('auth and character session chain awaits an asynchronous repository without breaking memory fixtures', async () => {
  const repo = new AsyncRepository();
  const auth = new AuthSession(repo);
  assert.deepEqual([...(await auth.handle(credentials(LOGIN.LOGIN_REQ)))[0]], [LOGIN.LOGIN_REQ, 1]);

  const worldSession = {
    async beginSelectedCharacter({ socketId }) {
      return {
        state: 'WAIT_GAMESTART_LOADING',
        clientPackets: [Buffer.from([GAME.SEL_CHAR, 1])],
        broadcastPackets: [],
        snapshot: { socketId, zoneId: 21, x: 312, y: 0, z: 402 },
      };
    },
  };
  const game = new GameSession(repo, { socketId: 901, worldSession });
  assert.deepEqual([...(await game.handle(credentials(GAME.LOGIN)))[0]], [GAME.LOGIN, 0]);
  assert.deepEqual([...(await game.handle(Buffer.from([GAME.SEL_NATION, 2])))[0]], [GAME.SEL_NATION, 2]);
  assert.equal((await game.handle(Buffer.from([GAME.ALLCHAR_INFO_REQ])))[0][0], GAME.ALLCHAR_INFO_REQ);
  assert.deepEqual([...(await game.handle(createCharacter()))[0]], [GAME.NEW_CHAR, 0]);
  assert.equal((await repo.listCharacters('osevinc'))[0].characterId, 'AsyncHero');
  assert.deepEqual([...(await game.handle(selectCharacter()))[0]], [GAME.SEL_CHAR, 1]);
});

test('production repository factory fails closed when DATABASE_URL is absent', async () => {
  const { createProductionPostgresRepository } = require('../../services/ko1298-session/postgres-repository');
  await assert.rejects(
    createProductionPostgresRepository({ env: {} }),
    (error) => error?.code === 'DATABASE_URL_REQUIRED',
  );
});
