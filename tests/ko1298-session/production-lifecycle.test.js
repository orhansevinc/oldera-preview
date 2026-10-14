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

test('inventory/combat/economy trust boundary always injects canonical actor and never binds client opcode', async () => {
  const seen = [];
  const adapter = { execute(input) { seen.push(input); return { ok: true }; } };
  const session = await readySession({ inventoryAdapter: adapter, combatAdapter: adapter, economyAdapter: adapter });
  await session.trustedDomainCall('inventory', { kind: 'move', slot: 1 });
  await session.trustedDomainCall('combat', { kind: 'skill', targetId: 100 });
  await session.trustedDomainCall('economy', { kind: 'trade', npcId: 10001 });
  assert.equal(seen.length, 3);
  assert.ok(seen.every(({ actor }) => actor.accountId === 'osevinc' && actor.characterId === 'Hero' && actor.state === 'WORLD_READY'));
});

test('WS25/26/27 outbound events share one encoded session delivery contract', async () => {
  const seen = [];
  const domainEventAdapter = { encode(input) { seen.push(input); return { clientPackets: [Buffer.from([0x7f, seen.length])], broadcastPackets: [] }; } };
  const session = await readySession({ domainEventAdapter });
  assert.deepEqual([...(await session.deliverDomainEvent('WS25', { kind: 'mob_state' }))[0]], [0x7f, 1]);
  assert.deepEqual([...(await session.deliverDomainEvent('WS26', { kind: 'loot' }))[0]], [0x7f, 2]);
  assert.deepEqual([...(await session.deliverDomainEvent('WS27', { kind: 'xp' }))[0]], [0x7f, 3]);
  assert.deepEqual(seen.map((x) => x.source), ['WS25', 'WS26', 'WS27']);
});

test('WS45 account and character lease calls occur at verified coordinator boundaries', async () => {
  const calls = [];
  const ownership = {
    acquireAccount(args) { calls.push(['account', args]); return { ok: true }; },
    acquireCharacter(args) { calls.push(['character', args]); return { ok: true }; },
    disconnect(id, opts) { calls.push(['disconnect', id, opts]); },
  };
  const session = await readySession({ ownership, serverId: 'realm-a' });
  assert.equal(calls[0][0], 'account');
  assert.equal(calls[0][1].serverId, 'realm-a');
  assert.equal(calls[1][0], 'character');
  await session.disconnect({ reason: 'CLIENT_LOGOUT', useGrace: false });
  assert.deepEqual(calls[2], ['disconnect', 'game:77', { useGrace: false, reason: 'CLIENT_LOGOUT' }]);
});

test('same-account duplicate rejection keeps second socket out of authenticated state', async () => {
  const leased = new Set();
  const ownership = {
    acquireAccount({ accountId }) { if (leased.has(accountId)) return { ok: false, code: 'ACCOUNT_IN_USE' }; leased.add(accountId); return { ok: true }; },
    disconnect() {},
  };
  const a = new GameSession(new MemoryRepository(), { socketId: 1, ownership });
  const b = new GameSession(new MemoryRepository(), { socketId: 2, ownership });
  assert.deepEqual([...(await a.handle(login()))[0]], [GAME.LOGIN, 0]);
  assert.deepEqual([...(await b.handle(login()))[0]], [GAME.LOGIN, 0xff]);
  assert.equal(a.phase, SESSION_STATES.AUTHENTICATED);
  assert.equal(b.phase, SESSION_STATES.CONNECTED);
});

test('disconnect cleanup is deterministic and duplicate cleanup is idempotent', async () => {
  const order = [];
  const session = await readySession({
    movementSession: { registerSession() {}, disconnect() { order.push('WS15'); } },
    npcRouter: { cleanup() { order.push('WS16'); } },
    combatAdapter: { cleanup() { order.push('WS19'); } },
    inventoryAdapter: { cleanup() { order.push('WS17'); } },
    economyAdapter: { cleanup() { order.push('WS22'); } },
    domainEventAdapter: { cleanup() { order.push('WS25/26/27'); } },
    worldSession: { ...worldMock(), disconnect() { order.push('WS14'); } },
    ownership: { acquireAccount() { return { ok: true }; }, acquireCharacter() { return { ok: true }; }, disconnect() { order.push('WS45'); } },
  });
  await Promise.all([session.disconnect({ reason: 'TRANSPORT_LOST' }), session.disconnect({ reason: 'TRANSPORT_LOST' })]);
  assert.deepEqual(order, ['WS15', 'WS16', 'WS19', 'WS17', 'WS22', 'WS25/26/27', 'WS14', 'WS45']);
  assert.equal(session.phase, SESSION_STATES.CLOSED);
});

test('cleanup continues after one downstream cleanup exception', async () => {
  const order = [];
  const session = await readySession({
    movementSession: { registerSession() {}, disconnect() { order.push('WS15'); throw new Error('boom'); } },
    npcRouter: { cleanup() { order.push('WS16'); } },
  });
  await session.disconnect();
  assert.deepEqual(order, ['WS15', 'WS16']);
  assert.equal(session.phase, SESSION_STATES.CLOSED);
});

test('downstream NPC exception becomes controlled session-level rejection, not process failure', async () => {
  const session = await readySession({ npcRouter: { route() { throw Object.assign(new Error('npc down'), { code: 'NPC_DOWN' }); } } });
  assert.deepEqual(await session.handle(Buffer.from([GAME.NPC_EVENT, 1, 0])), []);
  assert.equal(session.phase, SESSION_STATES.WORLD_READY);
});

test('SessionDispatcher preserves async packet ordering', async () => {
  const order = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const session = { async handle(packet) { order.push(`start${packet[0]}`); if (packet[0] === 1) await gate; order.push(`end${packet[0]}`); return [packet]; }, async disconnect() {} };
  const dispatcher = new SessionDispatcher(session);
  const first = dispatcher.enqueue(Buffer.from([1]));
  const second = dispatcher.enqueue(Buffer.from([2]));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ['start1']);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(order, ['start1', 'end1', 'start2', 'end2']);
});

test('disconnect during pending async operation waits active packet and cancels queued packet', async () => {
  const order = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const session = {
    async handle(packet) { order.push(`handle${packet[0]}`); if (packet[0] === 1) await gate; return []; },
    async disconnect() { order.push('cleanup'); },
  };
  const dispatcher = new SessionDispatcher(session);
  const first = dispatcher.enqueue(Buffer.from([1]));
  const second = dispatcher.enqueue(Buffer.from([2]));
  second.catch(() => {});
  await new Promise((resolve) => setImmediate(resolve));
  const closing = dispatcher.close();
  release();
  await first;
  await assert.rejects(second, /closed|closing/i);
  await closing;
  assert.deepEqual(order, ['handle1', 'cleanup']);
});

test('backpressure overflow is classified fatal', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const dispatcher = new SessionDispatcher({ async handle() { await gate; return []; }, async disconnect() {} }, { maxQueuedPackets: 1 });
  const first = dispatcher.enqueue(Buffer.from([1]));
  await assert.rejects(dispatcher.enqueue(Buffer.from([2])), (e) => e.code === 'BACKPRESSURE_LIMIT' && e.fatal === true);
  release();
  await first;
});

test('rapid connect/disconnect equivalent lifecycle closes once', async () => {
  let cleanups = 0;
  const session = new GameSession(new MemoryRepository(), { socketId: 9, ownership: { disconnect() { cleanups += 1; } } });
  await Promise.all(Array.from({ length: 20 }, () => session.disconnect()));
  assert.equal(cleanups, 1);
  assert.equal(session.phase, SESSION_STATES.CLOSED);
});

test('two concurrent game sessions keep canonical state isolated', async () => {
  const [a, b] = await Promise.all([readySession({ socketId: 100 }), readySession({ socketId: 101 })]);
  assert.equal(a.actorContext().entityId, 100);
  assert.equal(b.actorContext().entityId, 101);
  assert.equal(a.phase, 'WORLD_READY');
  assert.equal(b.phase, 'WORLD_READY');
});
