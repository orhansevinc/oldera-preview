'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  OPCODES, NPC_VISIBILITY, encodeNpcIn, encodeNpcOut, encodeNpcRegion,
  parseNpcInRequest, encodeNpcInResponse, parseNpcEventRequest, parseTargetHpRequest, encodeTargetHpResponse,
} = require('../../services/ko1298-npc');

const caspy = {
  instanceId: 10000, resourceId: 22000, npcType: 21, sellingGroup: 203002,
  size: 100, weapon1: 0, weapon2: 0, name: 'Caspy[Accessory]', group: 2,
  level: 50, x: 307, y: 12, z: 398, gateOpen: 1, objectType: 0, zoneId: 21,
};

test('WIZ_NPC_INOUT IN follows verified 1298 field order', () => {
  const p = encodeNpcIn(caspy);
  assert.equal(p[0], OPCODES.NPC_INOUT);
  assert.equal(p[1], NPC_VISIBILITY.IN);
  assert.equal(p.readUInt16LE(2), 10000);
  assert.equal(p.readUInt16LE(4), 22000);
  assert.equal(p[6], 21);
  assert.equal(p.readUInt32LE(7), 203002);
  assert.equal(p.readUInt16LE(11), 100);
  assert.equal(p.readUInt16LE(21), 16);
  assert.equal(p.subarray(23, 39).toString('latin1'), 'Caspy[Accessory]');
  assert.equal(p[39], 2);
  assert.equal(p[40], 50);
  assert.equal(p.readUInt16LE(41), 3070);
  assert.equal(p.readUInt16LE(43), 3980);
  assert.equal(p.readInt16LE(45), 120);
  assert.equal(p.readUInt32LE(47), 1);
  assert.equal(p[51], 0);
});

test('WIZ_NPC_INOUT OUT is opcode/type/id only', () => {
  assert.deepEqual([...encodeNpcOut(10000)], [0x0a, 0x02, 0x10, 0x27]);
});

test('WIZ_NPC_REGION is opcode, count, ids', () => {
  const p = encodeNpcRegion([10000, 10005]);
  assert.deepEqual([...p], [0x1c, 0x02, 0x00, 0x10, 0x27, 0x15, 0x27]);
});

test('WIZ_REQ_NPCIN request parses count and ids', () => {
  const p = Buffer.from([0x1d, 0x02, 0x00, 0x10, 0x27, 0x15, 0x27]);
  assert.deepEqual(parseNpcInRequest(p), { count: 2, instanceIds: [10000, 10005] });
});

test('WIZ_REQ_NPCIN response prefixes count then NPC records', () => {
  const p = encodeNpcInResponse([caspy]);
  assert.equal(p[0], 0x1d);
  assert.equal(p.readUInt16LE(1), 1);
  assert.equal(p.readUInt16LE(3), 10000);
});

test('interaction and target request packets parse exact client payloads', () => {
  assert.deepEqual(parseNpcEventRequest(Buffer.from([0x20, 0x10, 0x27])), { instanceId: 10000 });
  assert.deepEqual(parseTargetHpRequest(Buffer.from([0x22, 0x10, 0x27, 0x01])), { instanceId: 10000, immediate: 1 });
});

test('WIZ_TARGET_HP response follows client receive layout', () => {
  const p = encodeTargetHpResponse({ instanceId: 10000, immediate: 1, maxHp: 30000, hp: 30000, change: 0 });
  assert.equal(p.length, 14);
  assert.equal(p[0], 0x22);
  assert.equal(p.readUInt16LE(1), 10000);
  assert.equal(p[3], 1);
  assert.equal(p.readUInt32LE(4), 30000);
  assert.equal(p.readUInt32LE(8), 30000);
  assert.equal(p.readInt16LE(12), 0);
});
