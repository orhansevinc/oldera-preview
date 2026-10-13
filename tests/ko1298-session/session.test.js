'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  LOGIN,
  GAME,
  CHARACTER_EQUIPMENT,
  Reader,
  Writer,
  frame,
  FrameDecoder,
} = require('../../services/ko1298-session/protocol');
const { MemoryRepository } = require('../../services/ko1298-session/repository');
const { AuthSession, GameSession } = require('../../services/ko1298-session/session');

function gameLogin(username = 'osevinc', password = 'osevinc') {
  return new Writer().u8(GAME.LOGIN).str16(username).str16(password).done();
}

function createRequest({
  slot = 1,
  name = 'MoradonHero',
  race = 12,
  classId = 201,
  face = 1,
  hair = 2,
  str = 60,
  sta = 60,
  dex = 70,
  intel = 50,
  magicAttack = 50,
} = {}) {
  return new Writer()
    .u8(GAME.NEW_CHAR)
    .u8(slot)
    .str16(name)
    .u8(race)
    .i16(classId)
    .u8(face)
    .u8(hair)
    .u8(str)
    .u8(sta)
    .u8(dex)
    .u8(intel)
    .u8(magicAttack)
    .done();
}

function selectRequest({ accountId = 'osevinc', characterId = 'MoradonHero', zoneInit = 1, zoneCurrent = 21 } = {}) {
  return new Writer()
    .u8(GAME.SEL_CHAR)
    .str16(accountId)
    .str16(characterId)
    .u8(zoneInit)
    .u8(zoneCurrent)
    .done();
}

function decodeCharacterList(payload) {
  const r = new Reader(payload);
  assert.equal(r.u8(), GAME.ALLCHAR_INFO_REQ);
  assert.equal(r.u8(), 1);
  const slots = [];
  for (let slot = 0; slot < 3; slot += 1) {
    const characterId = r.str16(20);
    const record = {
      characterId,
      race: r.u8(),
      classId: r.i16(),
      level: r.u8(),
      face: r.u8(),
      hair: r.u8(),
      zone: r.u8(),
      equipment: {},
    };
    for (const key of CHARACTER_EQUIPMENT) {
      record.equipment[key] = { itemId: r.u32(), durability: r.i16() };
    }
    slots.push(record);
  }
  r.assertEnd();
  return slots;
}

async function authenticatedGameSession({ repo = new MemoryRepository(), worldSession = null, socketId = 42 } = {}) {
  const session = new GameSession(repo, { worldSession, socketId });
  assert.deepEqual([...((await session.handle(gameLogin()))[0])], [GAME.LOGIN, 0]);
  assert.deepEqual([...((await session.handle(Buffer.from([GAME.SEL_NATION, 2])))[0])], [GAME.SEL_NATION, 2]);
  return { session, repo };
}

test('1298 frame AA55/size/payload/55AA round-trip and fragmentation', () => {
  const payload = Buffer.from([0x2b]);
  const framed = frame(payload);
  assert.deepEqual([...framed], [0xaa, 0x55, 1, 0, 0x2b, 0x55, 0xaa]);
  const decoder = new FrameDecoder();
  assert.equal(decoder.push(framed.subarray(0, 3)).length, 0);
  assert.deepEqual(decoder.push(framed.subarray(3)), [payload]);
});

test('auth server list matches 1298 layout', () => {
  const session = new AuthSession(new MemoryRepository(), { gameHost: '127.0.0.1', gameName: 'OldKO', concurrent: 7 });
  const [response] = session.handle(Buffer.from([LOGIN.SERVER_LIST]));
  assert.equal(response[0], LOGIN.SERVER_LIST);
  assert.equal(response[1], 1);
  assert.ok(response.includes(Buffer.from('OldKO')));
});

test('development fixture osevinc authenticates and bad password fails', () => {
  const session = new AuthSession(new MemoryRepository());
  const request = (password) => new Writer().u8(LOGIN.LOGIN_REQ).str16('osevinc').str16(password).done();
  assert.deepEqual([...session.handle(request('osevinc'))[0]], [LOGIN.LOGIN_REQ, 1]);
  assert.deepEqual([...session.handle(request('bad'))[0]], [LOGIN.LOGIN_REQ, 3]);
});

test('version response is 1298 plus zero JV public key, then login/nation stays plaintext', async () => {
  const repo = new MemoryRepository();
  const session = new GameSession(repo);
  assert.deepEqual(
    [...((await session.handle(Buffer.from([GAME.VERSION_CHECK])))[0])],
    [GAME.VERSION_CHECK, 0x12, 0x05, 0, 0, 0, 0, 0, 0, 0, 0],
  );
  assert.deepEqual([...((await session.handle(gameLogin()))[0])], [GAME.LOGIN, 0]);
  assert.deepEqual([...((await session.handle(Buffer.from([GAME.SEL_NATION, 2])))[0])], [GAME.SEL_NATION, 2]);
  assert.equal(repo.getNation('osevinc'), 2);
  assert.throws(() => new GameSession(repo, { publicKey: 1n }), /non-zero JV publicKey/);
});

test('successful all-character response always carries exactly three 57-byte empty records', async () => {
  const { session } = await authenticatedGameSession();
  const [response] = await session.handle(Buffer.from([GAME.ALLCHAR_INFO_REQ]));
  assert.equal(response.length, 2 + 57 * 3);
  assert.equal(frame(response).length, 179);
  assert.deepEqual(decodeCharacterList(response).map((slot) => slot.characterId), ['', '', '']);
});

test('WS04 path: WIZ_NEW_CHAR succeeds, client refresh sees occupied center slot', async () => {
  const { session } = await authenticatedGameSession();
  const request = createRequest();
  assert.equal(request[0], GAME.NEW_CHAR);
  assert.deepEqual([...((await session.handle(request))[0])], [GAME.NEW_CHAR, 0]);

  const [refresh] = await session.handle(Buffer.from([GAME.ALLCHAR_INFO_REQ]));
  const slots = decodeCharacterList(refresh);
  assert.equal(slots[0].characterId, '');
  assert.equal(slots[1].characterId, 'MoradonHero');
  assert.equal(slots[1].race, 12);
  assert.equal(slots[1].classId, 201);
  assert.equal(slots[1].level, 1);
  assert.equal(slots[1].zone, 21);
  assert.equal(slots[2].characterId, '');
  assert.equal(refresh.length, 2 + 57 * 3 + Buffer.byteLength('MoradonHero'));
});

test('WIZ_SEL_CHAR validates ownership and invokes WS14 beginSelectedCharacter boundary', async () => {
  const calls = [];
  const ws14SelectSuccess = Buffer.from([0x04, 0x01, 0x15, 0x30, 0x0c, 0xb4, 0x0f, 0x00, 0x00, 0x00]);
  const worldSession = {
    async beginSelectedCharacter(args) {
      calls.push({ type: 'begin', ...args });
      return { clientPackets: [ws14SelectSuccess], broadcastPackets: [], snapshot: { zoneId: 21 } };
    },
    async handleClientPacket(socketId, payload) {
      calls.push({ type: 'packet', socketId, payload: Buffer.from(payload) });
      return { clientPackets: [Buffer.from([GAME.GAMESTART])], broadcastPackets: [] };
    },
  };
  const { session } = await authenticatedGameSession({ worldSession, socketId: 321 });
  assert.deepEqual([...((await session.handle(createRequest()))[0])], [GAME.NEW_CHAR, 0]);

  const [selectResponse] = await session.handle(selectRequest());
  assert.deepEqual(selectResponse, ws14SelectSuccess);
  assert.deepEqual(calls[0], {
    type: 'begin',
    accountId: 'osevinc',
    characterId: 'MoradonHero',
    socketId: 321,
  });

  const [gameStartAck] = await session.handle(Buffer.from([GAME.GAMESTART, 0x01]));
  assert.deepEqual([...gameStartAck], [GAME.GAMESTART]);
  assert.equal(calls[1].type, 'packet');
  assert.equal(calls[1].socketId, 321);
  assert.deepEqual([...calls[1].payload], [GAME.GAMESTART, 0x01]);
});

test('WIZ_SEL_CHAR refuses account mismatch/nonexistent character and never fabricates world success', async () => {
  let beginCalls = 0;
  const worldSession = {
    async beginSelectedCharacter() {
      beginCalls += 1;
      throw new Error('should not be called');
    },
  };
  const { session } = await authenticatedGameSession({ worldSession });
  await session.handle(createRequest());
  assert.deepEqual([...((await session.handle(selectRequest({ accountId: 'other' })))[0])], [GAME.SEL_CHAR, 0]);
  assert.deepEqual([...((await session.handle(selectRequest({ characterId: 'Missing' })))[0])], [GAME.SEL_CHAR, 0]);
  assert.equal(beginCalls, 0);
});

test('without WS14 integration, select fails instead of reimplementing world logic in WS03', async () => {
  const { session } = await authenticatedGameSession();
  await session.handle(createRequest());
  assert.deepEqual([...((await session.handle(selectRequest()))[0])], [GAME.SEL_CHAR, 0]);
});

test('byte-framed character create -> refresh -> select sequence remains packet-exact', async () => {
  const ws14SelectSuccess = Buffer.from([0x04, 0x01, 0x15, 0x30, 0x0c, 0xb4, 0x0f, 0x00, 0x00, 0x00]);
  const worldSession = {
    async beginSelectedCharacter() {
      return { clientPackets: [ws14SelectSuccess], broadcastPackets: [] };
    },
  };
  const { session } = await authenticatedGameSession({ worldSession });
  const decoder = new FrameDecoder();
  const requests = [createRequest(), Buffer.from([GAME.ALLCHAR_INFO_REQ]), selectRequest()];
  const responses = [];

  for (const request of requests) {
    const [decoded] = decoder.push(frame(request));
    const packets = await session.handle(decoded);
    responses.push(...packets.map((packet) => frame(packet)));
  }

  assert.deepEqual([...responses[0].subarray(4, 6)], [GAME.NEW_CHAR, 0]);
  const refreshedPayload = responses[1].subarray(4, responses[1].length - 2);
  assert.equal(decodeCharacterList(refreshedPayload)[1].characterId, 'MoradonHero');
  assert.deepEqual(responses[2].subarray(4, responses[2].length - 2), ws14SelectSuccess);
});
