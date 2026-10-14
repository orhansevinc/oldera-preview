'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { GAME, Writer } = require('../../services/ko1298-session/protocol');
const { MemoryRepository } = require('../../services/ko1298-session/repository');
const { GameSession } = require('../../services/ko1298-session/session');
const { SESSION_STATES } = require('../../services/ko1298-session/contracts');
const { WorldSessionService } = require('../../services/ko1298-world');
const { MovementService } = require('../../services/ko1298-movement');
const { NpcInteractionRouter } = require('../../services/ko1298-npc');
const { SessionOwnershipService, InMemoryLeaseStore } = require('../../services/session-ownership');

function login() {
  return new Writer().u8(GAME.LOGIN).str16('osevinc').str16('osevinc').done();
}
function create() {
  return new Writer().u8(GAME.NEW_CHAR).u8(0).str16('ComposedHero').u8(12).i16(201).u8(1).u8(2).u8(60).u8(60).u8(70).u8(50).u8(50).done();
}
function select() {
  return new Writer().u8(GAME.SEL_CHAR).str16('osevinc').str16('ComposedHero').u8(1).u8(21).done();
}
function stopMove(position) {
  const packet = Buffer.alloc(10);
  packet[0] = GAME.MOVE;
  packet.writeUInt16LE(Math.round(position.x * 10), 1);
  packet.writeUInt16LE(Math.round(position.z * 10), 3);
  packet.writeInt16LE(Math.round(position.y * 10), 5);
  packet.writeUInt16LE(0, 7);
  packet[9] = 0;
  return packet;
}

test('real WS14 + WS15 + WS16 + WS45 contracts compose through WS03', async () => {
  const repo = new MemoryRepository();
  const worldSession = new WorldSessionService({ repository: repo });
  const movementBroadcasts = [];
  const movementSession = new MovementService({
    zoneBounds: { isValidPosition: () => true },
    broadcast: (event) => movementBroadcasts.push(event),
  });
  let npcQuestCalls = 0;
  const npcRouter = new NpcInteractionRouter({
    world: {
      nearby: () => [],
      get: (instanceId) => ({ instanceId, zoneId: 21, npcType: 1, maxHp: 100, hp: 100 }),
    },
    quest: () => { npcQuestCalls += 1; return { kind: 'packets', packets: [] }; },
  });
  const ownership = new SessionOwnershipService({ store: new InMemoryLeaseStore() });
  const session = new GameSession(repo, {
    socketId: 500,
    serverId: 'ws03-ci',
    worldSession,
    movementSession,
    npcRouter,
    ownership,
  });

  assert.deepEqual([...(await session.handle(Buffer.from([GAME.VERSION_CHECK])))[0]].slice(0, 3), [GAME.VERSION_CHECK, 0x12, 0x05]);
  assert.deepEqual([...(await session.handle(login()))[0]], [GAME.LOGIN, 0]);
  assert.deepEqual([...(await session.handle(Buffer.from([GAME.SEL_NATION, 2])))[0]], [GAME.SEL_NATION, 2]);
  assert.deepEqual([...(await session.handle(create()))[0]], [GAME.NEW_CHAR, 0]);
  assert.equal((await session.handle(select()))[0][0], GAME.SEL_CHAR);
  await session.handle(Buffer.from([GAME.GAMESTART, 1]));
  await session.handle(Buffer.from([GAME.GAMESTART, 2]));
  assert.equal(session.phase, SESSION_STATES.WORLD_READY);
  assert.equal(movementSession.hasSession('game:500'), true);

  await session.handle(stopMove(session.actorContext().position));
  assert.equal(movementBroadcasts.length, 1);
  assert.equal(movementBroadcasts[0].senderSessionId, 'game:500');

  await session.handle(Buffer.from([GAME.NPC_EVENT, 0x11, 0x27]));
  assert.equal(npcQuestCalls, 1);

  const owner = await ownership.getAccountOwner('osevinc');
  assert.equal(owner.sessionId, 'game:500');
  await session.disconnect({ reason: 'CLIENT_LOGOUT', useGrace: false });
  assert.equal(session.phase, SESSION_STATES.CLOSED);
  assert.equal(movementSession.hasSession('game:500'), false);
  assert.equal(await ownership.getAccountOwner('osevinc'), null);
});
