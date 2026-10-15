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

test('SocketIdPool never reuses an active uint16 id and releases deterministically', () => {
  const pool = new SocketIdPool();
  const a = pool.allocate(); const b = pool.allocate();
  assert.notEqual(a, b);
  assert.equal(pool.release(a), true);
  assert.equal(pool.release(a), false);
});

test('packet logging sanitizer strips secret/payload-shaped metadata', () => {
  assert.deepEqual(sanitizeLogMetadata({ opcode: 1, length: 10, password: 'x', payload: Buffer.from([1]), secretToken: 'x' }), { opcode: 1, length: 10 });
});

test('FrameDecoder rejects malformed frame header for fail-closed transport', () => {
  const decoder = new FrameDecoder();
  assert.throws(() => decoder.push(Buffer.from([0, 0, 1, 0, 1, 0x55, 0xaa])), /bad frame header/);
});

test('public-staging contract keeps version 1298 and auth/game session paths packet-compatible', async () => {
  const session = new GameSession(new MemoryRepository(), { socketId: 300, worldSession: worldMock() });
  const version = (await session.handle(Buffer.from([GAME.VERSION_CHECK])))[0];
  assert.equal(version.readInt16LE(1), 1298);
  assert.equal(version.readBigUInt64LE(3), 0n);
  assert.deepEqual([...(await session.handle(login()))[0]], [GAME.LOGIN, 0]);
});

test('deterministic integration fixture login -> char select -> world ready -> movement -> NPC -> disconnect', async () => {
  const calls = [];
  const movementSession = {
    registerSession() { calls.push('movement-register'); },
    handleMovePacket() { calls.push('movement'); return { packet: Buffer.from([GAME.MOVE, 77, 0]), recipients: [] }; },
    disconnect() { calls.push('movement-cleanup'); },
  };
  const npcRouter = { route() { calls.push('npc'); return { packets: [] }; }, cleanup() { calls.push('npc-cleanup'); } };
  const session = await readySession({ movementSession, npcRouter });
  await session.handle(movePacket());
  await session.handle(Buffer.from([GAME.NPC_EVENT, 1, 0]));
  await session.disconnect({ reason: 'CLIENT_LOGOUT', useGrace: false });
  assert.deepEqual(calls, ['movement-register', 'movement', 'npc', 'movement-cleanup', 'npc-cleanup']);
  assert.equal(session.phase, SESSION_STATES.CLOSED);
});
