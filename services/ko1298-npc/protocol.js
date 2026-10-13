'use strict';

const OPCODES = Object.freeze({
  NPC_INOUT: 0x0a,
  NPC_REGION: 0x1c,
  REQ_NPCIN: 0x1d,
  NPC_EVENT: 0x20,
  TARGET_HP: 0x22,
});

const NPC_VISIBILITY = Object.freeze({ IN: 0x01, OUT: 0x02 });
const NPC_BAND = 10000;
const INVALID_BAND = 30000;
const VIEW_DISTANCE = 48;

function assertInt(name, value, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer in [${min}, ${max}], got ${value}`);
  }
}

function assertFinite(name, value) {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
}

function writeU8(parts, value) { const b = Buffer.allocUnsafe(1); b.writeUInt8(value); parts.push(b); }
function writeU16(parts, value) { const b = Buffer.allocUnsafe(2); b.writeUInt16LE(value); parts.push(b); }
function writeI16(parts, value) { const b = Buffer.allocUnsafe(2); b.writeInt16LE(value); parts.push(b); }
function writeU32(parts, value) { const b = Buffer.allocUnsafe(4); b.writeUInt32LE(value); parts.push(b); }

function encodeName(name) {
  if (typeof name !== 'string' || name.length === 0) throw new TypeError('name must be a non-empty string');
  const bytes = Buffer.from(name, 'latin1');
  if (bytes.length > 30) throw new RangeError('1298 NPC name exceeds MAX_ID_SIZE=30 bytes');
  return bytes;
}

function encodeUnsignedKoCoord(value, field) {
  assertFinite(field, value);
  const scaled = Math.trunc(value) * 10;
  assertInt(`${field} encoded`, scaled, 0, 0xffff);
  return scaled;
}

function encodeSignedKoCoord(value, field) {
  assertFinite(field, value);
  const scaled = Math.trunc(value) * 10;
  assertInt(`${field} encoded`, scaled, -0x8000, 0x7fff);
  return scaled;
}

function validateNpcRecord(npc) {
  if (!npc || typeof npc !== 'object') throw new TypeError('npc is required');
  assertInt('instanceId', npc.instanceId, NPC_BAND, INVALID_BAND - 1);
  assertInt('resourceId', npc.resourceId, 0, 0xffff);
  assertInt('npcType', npc.npcType, 0, 0xff);
  assertInt('sellingGroup', npc.sellingGroup, 0, 0xffffffff);
  assertInt('size', npc.size, 0, 0xffff);
  assertInt('weapon1', npc.weapon1, 0, 0xffffffff);
  assertInt('weapon2', npc.weapon2, 0, 0xffffffff);
  encodeName(npc.name);
  assertInt('group', npc.group, 0, 0xff);
  assertInt('level', npc.level, 0, 0xff);
  encodeUnsignedKoCoord(npc.x, 'x');
  encodeUnsignedKoCoord(npc.z, 'z');
  encodeSignedKoCoord(npc.y, 'y');
  assertInt('gateOpen', npc.gateOpen, 0, 0xffffffff);
  assertInt('objectType', npc.objectType, 0, 0xff);
}

function encodeNpcRecord(npc) {
  validateNpcRecord(npc);
  const parts = [];
  const name = encodeName(npc.name);
  writeU16(parts, npc.instanceId);
  writeU16(parts, npc.resourceId);
  writeU8(parts, npc.npcType);
  writeU32(parts, npc.sellingGroup);
  writeU16(parts, npc.size);
  writeU32(parts, npc.weapon1);
  writeU32(parts, npc.weapon2);
  writeU16(parts, name.length);
  parts.push(name);
  writeU8(parts, npc.group);
  writeU8(parts, npc.level);
  writeU16(parts, encodeUnsignedKoCoord(npc.x, 'x'));
  writeU16(parts, encodeUnsignedKoCoord(npc.z, 'z'));
  writeI16(parts, encodeSignedKoCoord(npc.y, 'y'));
  writeU32(parts, npc.gateOpen);
  writeU8(parts, npc.objectType);
  return Buffer.concat(parts);
}

function encodeNpcIn(npc) {
  return Buffer.concat([Buffer.from([OPCODES.NPC_INOUT, NPC_VISIBILITY.IN]), encodeNpcRecord(npc)]);
}

function encodeNpcOut(instanceId) {
  assertInt('instanceId', instanceId, NPC_BAND, INVALID_BAND - 1);
  const b = Buffer.allocUnsafe(4);
  b.writeUInt8(OPCODES.NPC_INOUT, 0);
  b.writeUInt8(NPC_VISIBILITY.OUT, 1);
  b.writeUInt16LE(instanceId, 2);
  return b;
}

function encodeNpcRegion(instanceIds) {
  if (!Array.isArray(instanceIds)) throw new TypeError('instanceIds must be an array');
  assertInt('npc count', instanceIds.length, 0, 0xffff);
  const b = Buffer.allocUnsafe(3 + instanceIds.length * 2);
  b.writeUInt8(OPCODES.NPC_REGION, 0);
  b.writeUInt16LE(instanceIds.length, 1);
  instanceIds.forEach((id, i) => {
    assertInt(`instanceIds[${i}]`, id, NPC_BAND, INVALID_BAND - 1);
    b.writeUInt16LE(id, 3 + i * 2);
  });
  return b;
}

function parseNpcInRequest(packet) {
  if (!Buffer.isBuffer(packet)) packet = Buffer.from(packet);
  if (packet.length < 3 || packet.readUInt8(0) !== OPCODES.REQ_NPCIN) throw new Error('not WIZ_REQ_NPCIN');
  const count = packet.readUInt16LE(1);
  if (packet.length !== 3 + count * 2) throw new Error('malformed WIZ_REQ_NPCIN length');
  const instanceIds = [];
  for (let i = 0; i < count; i++) instanceIds.push(packet.readUInt16LE(3 + i * 2));
  return { count, instanceIds };
}

function encodeNpcInResponse(npcs) {
  if (!Array.isArray(npcs)) throw new TypeError('npcs must be an array');
  assertInt('npc count', npcs.length, 0, 0xffff);
  const head = Buffer.allocUnsafe(3);
  head.writeUInt8(OPCODES.REQ_NPCIN, 0);
  head.writeUInt16LE(npcs.length, 1);
  return Buffer.concat([head, ...npcs.map(encodeNpcRecord)]);
}

function parseNpcEventRequest(packet) {
  if (!Buffer.isBuffer(packet)) packet = Buffer.from(packet);
  if (packet.length !== 3 || packet.readUInt8(0) !== OPCODES.NPC_EVENT) throw new Error('malformed WIZ_NPC_EVENT');
  return { instanceId: packet.readUInt16LE(1) };
}

function encodeTargetHpResponse({ instanceId, immediate = 1, maxHp, hp, change = 0 }) {
  assertInt('instanceId', instanceId, NPC_BAND, INVALID_BAND - 1);
  assertInt('immediate', immediate, 0, 0xff);
  assertInt('maxHp', maxHp, 0, 0xffffffff);
  assertInt('hp', hp, 0, 0xffffffff);
  assertInt('change', change, -0x8000, 0x7fff);
  const b = Buffer.allocUnsafe(14);
  b.writeUInt8(OPCODES.TARGET_HP, 0);
  b.writeUInt16LE(instanceId, 1);
  b.writeUInt8(immediate, 3);
  b.writeUInt32LE(maxHp, 4);
  b.writeUInt32LE(hp, 8);
  b.writeInt16LE(change, 12);
  return b;
}

function parseTargetHpRequest(packet) {
  if (!Buffer.isBuffer(packet)) packet = Buffer.from(packet);
  if (packet.length !== 4 || packet.readUInt8(0) !== OPCODES.TARGET_HP) throw new Error('malformed WIZ_TARGET_HP request');
  return { instanceId: packet.readUInt16LE(1), immediate: packet.readUInt8(3) };
}

module.exports = {
  OPCODES,
  NPC_VISIBILITY,
  NPC_BAND,
  INVALID_BAND,
  VIEW_DISTANCE,
  encodeNpcRecord,
  encodeNpcIn,
  encodeNpcOut,
  encodeNpcRegion,
  parseNpcInRequest,
  encodeNpcInResponse,
  parseNpcEventRequest,
  parseTargetHpRequest,
  encodeTargetHpResponse,
  validateNpcRecord,
};
