'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { GAME, Writer, FrameDecoder } = require('../../services/ko1298-session/protocol');
const { MemoryRepository } = require('../../services/ko1298-session/repository');
const { GameSession } = require('../../services/ko1298-session/session');
const { SessionDispatcher } = require('../../services/ko1298-session/dispatcher');
const { SESSION_STATES, OPCODE_CONTRACTS, UNBOUND_DOMAIN_CONTRACTS } = require('../../services/ko1298-session/contracts');
const { SocketIdPool, sanitizeLogMetadata } = require('../../services/ko1298-session/server');

function login(username = 'osevinc', password = 'osevinc') {
  return new Writer().u8(GAME.LOGIN).str16(username).str16(password).done();
}
function create(name = 'Hero') {
  return new Writer().u8(GAME.NEW_CHAR).u8(0).str16(name).u8(12).i16(201).u8(1).u8(2).u8(60).u8(60).u8(70).u8(50).u8(50).done();
}
function select(name = 'Hero') {
  return new Writer().u8(GAME.SEL_CHAR).str16('osevinc').str16(name).u8(1).u8(21).done();
}
function movePacket() {
  const b = Buffer.alloc(10); b[0] = GAME.MOVE; b.writeUInt16LE(3120, 1); b.writeUInt16LE(4020, 3); b.writeInt16LE(0, 5); b.writeUInt16LE(10, 7); b[9] = 1; return b;
}
function rotatePacket() {
  const b = Buffer.alloc(3); b[0] = GAME.ROTATE; b.writeInt16LE(123, 1); return b;
}
function npcRequest(...ids) {
  const b = Buffer.alloc(3 + ids.length * 2); b[0] = GAME.REQUEST_NPC_IN; b.writeUInt16LE(ids.length, 1); ids.forEach((id, i) => b.writeUInt16LE(id, 3 + i * 2)); return b;
}
function worldMock({ delay = null } = {}) {
  return {
    async beginSelectedCharacter(args) {
      return { state: 'WAIT_GAMESTART_LOADING', clientPackets: [Buffer.from([GAME.SEL_CHAR, 1])], broadcastPackets: [], snapshot: { socketId: args.socketId, zoneId: 21, x: 312, y: 0, z: 402 } };
    },
    async handleClientPacket(socketId, packet) {
      if (delay) await delay(packet);
      if (packet[0] === GAME.GAMESTART && packet[1] === 2) return { state: 'WORLD_READY', clientPackets: [], broadcastPackets: [Buffer.from([0x0a, 1])], snapshot: { socketId, zoneId: 21, x: 312, y: 0, z: 402 } };
      if (packet[0] === GAME.REQUEST_USER_IN || packet[0] === GAME.REQUEST_NPC_IN) return { state: 'WORLD_READY', clientPackets: [], broadcastPackets: [], snapshot: { socketId, zoneId: 21, x: 312, y: 0, z: 402 } };
      return { state: 'WAIT_GAMESTART_LOADED', clientPackets: [Buffer.from([GAME.GAMESTART])], broadcastPackets: [], snapshot: { socketId, zoneId: 21, x: 312, y: 0, z: 402 } };
    },
  };
}
async function readySession(options = {}) {
  const repo = options.repo || new MemoryRepository();
  const session = new GameSession(repo, { socketId: options.socketId || 77, worldSession: options.worldSession || worldMock(), ...options });
  await session.handle(login());
  await session.handle(Buffer.from([GAME.SEL_NATION, 2]));
  await session.handle(create());
  await session.handle(select());
  await session.handle(Buffer.from([GAME.GAMESTART, 1]));
  await session.handle(Buffer.from([GAME.GAMESTART, 2]));
  return session;
}

test('canonical state transition table reaches WORLD_READY with one identity record', async () => {
  const transitions = [];
  const session = await readySession({ onStateChange: (e) => transitions.push([e.previous, e.next]) });
  assert.equal(session.phase, SESSION_STATES.WORLD_READY);
  assert.deepEqual(session.actorContext(), {
    socketId: 77, sessionId: 'game:77', accountId: 'osevinc', characterId: 'Hero', zoneId: 21, entityId: 77,
    position: { x: 312, y: 0, z: 402 }, state: SESSION_STATES.WORLD_READY,
  });
  assert.deepEqual(transitions, [
    ['CONNECTED', 'AUTHENTICATED'], ['AUTHENTICATED', 'CHARACTER_SELECTED'], ['CHARACTER_SELECTED', 'WORLD_LOADING'], ['WORLD_LOADING', 'WORLD_READY'],
  ]);
});

test('verified opcode matrix binds WS15/WS16/WS19 and leaves WS17/22 unguessed', () => {
  assert.equal(OPCODE_CONTRACTS.get(0x06).owner, 'WS15');
  assert.equal(OPCODE_CONTRACTS.get(0x09).owner, 'WS15');
  assert.equal(OPCODE_CONTRACTS.get(0x08).owner, 'WS19');
  assert.equal(OPCODE_CONTRACTS.get(0x31).owner, 'WS19');
  assert.equal(OPCODE_CONTRACTS.get(0x20).owner, 'WS16');
  assert.equal(OPCODE_CONTRACTS.get(0x22).owner, 'WS16');
  assert.equal(OPCODE_CONTRACTS.get(0x1d).owner, 'WS14/WS16-CONFLICT');
  assert.match(UNBOUND_DOMAIN_CONTRACTS.WS17, /no additional client opcode/i);
  assert.equal(UNBOUND_DOMAIN_CONTRACTS.WS19, undefined);
  assert.match(UNBOUND_DOMAIN_CONTRACTS.WS22, /no client opcode/i);
});

test('wrong-state gameplay opcodes are ignored without mixing auth/world state', async () => {
  const session = new GameSession(new MemoryRepository(), { socketId: 1, worldSession: worldMock() });
  assert.deepEqual(await session.handle(movePacket()), []);
  assert.deepEqual(await session.handle(Buffer.from([GAME.GAMESTART, 1])), []);
  assert.equal(session.phase, SESSION_STATES.CONNECTED);
  await session.handle(login());
  assert.deepEqual(await session.handle(login()), []);
  assert.equal(session.phase, SESSION_STATES.AUTHENTICATED);
});

test('malformed known packet fails closed with structured classification', async () => {
  const session = new GameSession(new MemoryRepository());
  await session.handle(login());
  await assert.rejects(session.handle(Buffer.from([GAME.SEL_NATION])), (error) => error.code === 'MALFORMED_PACKET' && error.fatal === true && error.category === 'MALFORMED_PACKET');
});

test('unknown opcode is controlled ignore and does not close session', async () => {
  const session = new GameSession(new MemoryRepository());
  assert.deepEqual(await session.handle(Buffer.from([0xee, 1, 2, 3])), []);
  assert.equal(session.phase, SESSION_STATES.CONNECTED);
});

test('WS15 movement and rotate route exact payload bytes and surface broadcast metadata', async () => {
  const calls = []; const broadcasts = [];
  const movementSession = {
    registerSession(args) { calls.push(['register', args]); },
    handleMovePacket(id, payload) { calls.push(['move', id, Buffer.from(payload)]); return { packet: Buffer.from([GAME.MOVE, 77, 0]), recipients: [77, 88] }; },
    handleRotatePacket(id, payload) { calls.push(['rotate', id, Buffer.from(payload)]); return { packet: Buffer.from([GAME.ROTATE, 77, 0]), recipients: [88] }; },
    disconnect(id) { calls.push(['disconnect', id]); },
  };
  const session = await readySession({ movementSession, onGameplayBroadcast: (e) => broadcasts.push(e) });
  await session.handle(movePacket());
  await session.handle(rotatePacket());
  assert.equal(calls[0][0], 'register');
  assert.equal(calls[0][1].entityId, 77);
  assert.deepEqual([...calls[1][2]], [...movePacket().subarray(1)]);
  assert.deepEqual([...calls[2][2]], [...rotatePacket().subarray(1)]);
  assert.equal(broadcasts.length, 2);
  assert.deepEqual(broadcasts[0].recipients, [77, 88]);
});

test('malformed movement packet never reaches WS15 adapter', async () => {
  let calls = 0;
  const movementSession = { registerSession() {}, handleMovePacket() { calls += 1; }, disconnect() {} };
  const session = await readySession({ movementSession });
  await assert.rejects(session.handle(Buffer.from([GAME.MOVE, 1, 2])), (e) => e.code === 'MALFORMED_PACKET');
  assert.equal(calls, 0);
});


test('WS14 zone transition resets WS15 baseline through verified teleport contract', async () => {
  const calls = [];
  const world = worldMock();
  const base = world.handleClientPacket;
  world.handleClientPacket = async (socketId, packet) => {
    if (packet[0] === GAME.ZONE_CHANGE && packet[1] === 1) {
      return { state: 'ZONE_CHANGE_WAIT_LOADED', clientPackets: [], broadcastPackets: [], snapshot: { socketId, zoneId: 21, x: 320, y: 0, z: 410 } };
    }
    if (packet[0] === GAME.ZONE_CHANGE && packet[1] === 2) {
      return { state: 'WORLD_READY', clientPackets: [], broadcastPackets: [], snapshot: { socketId, zoneId: 21, x: 320, y: 0, z: 410 } };
    }
    return base(socketId, packet);
  };
  const movementSession = {
    registerSession() { calls.push('register'); },
    teleport(id, args) { calls.push(['teleport', id, args]); },
    disconnect() { calls.push('disconnect'); },
  };
  const session = await readySession({ worldSession: world, movementSession });
  await session.handle(Buffer.from([GAME.ZONE_CHANGE, 1]));
  assert.equal(session.phase, SESSION_STATES.WORLD_LOADING);
  await session.handle(Buffer.from([GAME.ZONE_CHANGE, 2]));
  assert.equal(session.phase, SESSION_STATES.WORLD_READY);
  assert.equal(calls.filter((x) => x === 'register').length, 1);
  assert.equal(calls[1][0], 'teleport');
  assert.equal(calls[1][1], 'game:77');
  assert.deepEqual(calls[1][2].position, { x: 320, y: 0, z: 410 });
});

test('WS16 NPC event/target packets receive immutable authenticated actor context', async () => {
  const calls = [];
  const npcRouter = { async route(packet, actor) { calls.push([Buffer.from(packet), actor]); return { kind: 'packets', packets: [Buffer.from([packet[0], 1])] }; } };
  const session = await readySession({ npcRouter });
  const [eventReply] = await session.handle(Buffer.from([GAME.NPC_EVENT, 0x10, 0x27]));
  const [hpReply] = await session.handle(Buffer.from([GAME.TARGET_HP, 0x10, 0x27, 1]));
  assert.deepEqual([...eventReply], [GAME.NPC_EVENT, 1]);
  assert.deepEqual([...hpReply], [GAME.TARGET_HP, 1]);
  assert.equal(calls[0][1].accountId, 'osevinc');
  assert.equal(calls[0][1].characterId, 'Hero');
  assert.equal(calls[0][1].state, 'WORLD_READY');
  assert.ok(Object.isFrozen(calls[0][1]));
});

test('0x1D remains WS14 by default and can move to WS16 only by explicit capability', async () => {
  let worldCalls = 0; let npcCalls = 0;
  const world = worldMock();
  const original = world.handleClientPacket;
  world.handleClientPacket = async (...args) => { worldCalls += 1; return original(...args); };
  const npcRouter = { route() { npcCalls += 1; return { packets: [Buffer.from([GAME.REQUEST_NPC_IN, 0, 0])] }; } };
  const session = await readySession({ worldSession: world, npcRouter });
  const before = worldCalls;
  await session.handle(npcRequest(10001));
  assert.equal(worldCalls, before + 1);
  assert.equal(npcCalls, 0);

  const second = await readySession({ socketId: 78, npcRouter, npcRoutesRequestNpcIn: true });
  await second.handle(npcRequest(10001));
  assert.equal(npcCalls, 1);
});
