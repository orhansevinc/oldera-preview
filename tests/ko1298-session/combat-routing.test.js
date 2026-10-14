'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { GAME, Writer } = require('../../services/ko1298-session/protocol');
const { MemoryRepository } = require('../../services/ko1298-session/repository');
const { GameSession } = require('../../services/ko1298-session/session');
const { SESSION_STATES, OPCODE_CONTRACTS } = require('../../services/ko1298-session/contracts');
const { MAGIC_COMMAND } = require('../../services/ko1298-session/combat-protocol');

function login() { return new Writer().u8(GAME.LOGIN).str16('osevinc').str16('osevinc').done(); }
function create() { return new Writer().u8(GAME.NEW_CHAR).u8(0).str16('Hero').u8(12).i16(201).u8(1).u8(2).u8(60).u8(60).u8(70).u8(50).u8(50).done(); }
function select() { return new Writer().u8(GAME.SEL_CHAR).str16('osevinc').str16('Hero').u8(1).u8(21).done(); }
function attack(targetId, { intervalRaw = 123, distanceRaw = 45 } = {}) {
  const b = Buffer.alloc(8);
  b[0] = GAME.ATTACK;
  b[1] = 1;
  b.writeInt16LE(targetId, 2);
  b.writeInt16LE(intervalRaw, 4);
  b.writeInt16LE(distanceRaw, 6);
  return b;
}
function magic(command, { skillId = 104001, clientSourceId = 32000, targetId = 77, data = [1, 2, 3, 4, 5, 6] } = {}) {
  const b = Buffer.alloc(22);
  b[0] = GAME.MAGIC_PROCESS;
  b[1] = command;
  b.writeUInt32LE(skillId, 2);
  b.writeInt16LE(clientSourceId, 6);
  b.writeInt16LE(targetId, 8);
  for (let i = 0; i < 6; i += 1) b.writeInt16LE(data[i] ?? 0, 10 + i * 2);
  return b;
}
function worldMock() {
  return {
    async beginSelectedCharacter(args) {
      return { state: 'WAIT_GAMESTART_LOADING', clientPackets: [Buffer.from([GAME.SEL_CHAR, 1])], broadcastPackets: [], snapshot: { socketId: args.socketId, zoneId: 21, x: 312, y: 0, z: 402 } };
    },
    async handleClientPacket(socketId, packet) {
      if (packet[0] === GAME.GAMESTART && packet[1] === 2) return { state: 'WORLD_READY', clientPackets: [], broadcastPackets: [], snapshot: { socketId, zoneId: 21, x: 312, y: 0, z: 402 } };
      return { state: 'WAIT_GAMESTART_LOADED', clientPackets: [Buffer.from([GAME.GAMESTART])], broadcastPackets: [], snapshot: { socketId, zoneId: 21, x: 312, y: 0, z: 402 } };
    },
  };
}
async function readySession(options = {}) {
  const session = new GameSession(new MemoryRepository(), { socketId: 77, worldSession: worldMock(), ...options });
  await session.handle(login());
  await session.handle(Buffer.from([GAME.SEL_NATION, 2]));
  await session.handle(create());
  await session.handle(select());
  await session.handle(Buffer.from([GAME.GAMESTART, 1]));
  await session.handle(Buffer.from([GAME.GAMESTART, 2]));
  assert.equal(session.phase, SESSION_STATES.WORLD_READY);
  return session;
}

test('WS11 verified combat opcodes are WS19-owned and WORLD_READY-only', () => {
  assert.equal(OPCODE_CONTRACTS.get(GAME.ATTACK).owner, 'WS19');
  assert.deepEqual([...OPCODE_CONTRACTS.get(GAME.ATTACK).allowedStates], [SESSION_STATES.WORLD_READY]);
  assert.equal(OPCODE_CONTRACTS.get(GAME.MAGIC_PROCESS).owner, 'WS19');
  assert.deepEqual([...OPCODE_CONTRACTS.get(GAME.MAGIC_PROCESS).allowedStates], [SESSION_STATES.WORLD_READY]);
});

test('WIZ_ATTACK uses session identity, exact signed target id and server request metadata; client interval/distance stay observation-only', async () => {
  const calls = [];
  const events = [];
  const combatAdapter = { execute: async (request) => { calls.push(request); return Object.freeze({ ok: true, reason: 'DOMAIN_RESULT' }); } };
  const session = await readySession({ combatAdapter, onCombatEvent: (event) => events.push(event) });
  assert.deepEqual(await session.handle(attack(20001), { receiveSequence: 41 }), []);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].actor.entityId, 77);
  assert.equal(calls[0].actor.characterId, 'Hero');
  assert.equal(calls[0].operation.sourceEntityId, 77);
  assert.equal(calls[0].operation.sourceCharacterId, 'Hero');
  assert.equal(calls[0].operation.targetRuntimeId, 20001);
  assert.equal(calls[0].operation.requestKey, 'game:77:08:41');
  assert.equal(calls[0].operation.clientObservation.intervalSeconds, 1.23);
  assert.equal(calls[0].operation.clientObservation.distance, 4.5);
  assert.equal(calls[0].operation.clientObservation.authoritative, false);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'NORMAL_ATTACK_RESULT');
  assert.equal(events[0].outcome.reason, 'DOMAIN_RESULT');

  await session.handle(attack(20001), { receiveSequence: 41 });
  assert.equal(calls[1].operation.requestKey, calls[0].operation.requestKey);
});

test('WIZ_MAGIC_PROCESS commands 1..6 preserve lifecycle fields but never trust client source identity', async () => {
  const calls = [];
  const combatAdapter = { execute: async (request) => { calls.push(request); return Object.freeze({ ok: true, kind: 'SEMANTIC' }); } };
  const session = await readySession({ combatAdapter });
  const commands = Object.values(MAGIC_COMMAND);
  for (const command of commands) await session.handle(magic(command), { receiveSequence: 100 + command });
  assert.equal(calls.length, 6);
  for (let i = 0; i < calls.length; i += 1) {
    const call = calls[i];
    assert.equal(call.actor.entityId, 77);
    assert.equal(call.operation.sourceEntityId, 77);
    assert.equal(call.operation.clientClaimedSourceId, 32000);
    assert.equal(call.operation.targetRuntimeId, 77);
    assert.equal(call.operation.command, commands[i]);
    assert.equal(call.operation.skillId, 104001);
    assert.deepEqual([...call.operation.data], [1, 2, 3, 4, 5, 6]);
  }
});

test('combat wrong-state packets fail closed before adapter execution', async () => {
  let calls = 0;
  const session = new GameSession(new MemoryRepository(), { socketId: 77, combatAdapter: { execute() { calls += 1; } } });
  session.state.phase = SESSION_STATES.CHARACTER_SELECTED;
  assert.deepEqual(await session.handle(attack(20001)), []);
  session.state.phase = SESSION_STATES.WORLD_LOADING;
  assert.deepEqual(await session.handle(magic(MAGIC_COMMAND.EFFECTING)), []);
  assert.equal(calls, 0);
});

test('malformed combat bodies fail closed and never reach WS19 adapter', async () => {
  let calls = 0;
  const session = await readySession({ combatAdapter: { execute() { calls += 1; return {}; } } });
  await assert.rejects(session.handle(Buffer.from([GAME.ATTACK, 1, 2])), (error) => error.code === 'MALFORMED_PACKET');
  await assert.rejects(session.handle(Buffer.alloc(21, GAME.MAGIC_PROCESS)), (error) => error.code === 'MALFORMED_PACKET');
  const badCommand = magic(6); badCommand[1] = 9;
  await assert.rejects(session.handle(badCommand), (error) => error.code === 'MALFORMED_PACKET');
  assert.equal(calls, 0);
});
