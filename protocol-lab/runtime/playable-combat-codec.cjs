'use strict';

// KO1298 playable-combat runtime codec.
// Wire authority is frozen in ../PLAYABLE_COMBAT_PROTOCOL_PROFILE.json and ../gameplay-authority.json.
// This module owns payload encoding/decoding only. It intentionally does NOT duplicate AA55 framing,
// damage/HP authority, target lifecycle, or any other combat-domain decision.

class CombatRuntimeCodecError extends RangeError {}

const OPCODE = Object.freeze({
  WIZ_NPC_INOUT: 0x0a,
  WIZ_ATTACK: 0x08,
  WIZ_DEAD: 0x11,
  WIZ_HP_CHANGE: 0x17,
  WIZ_MSP_CHANGE: 0x18,
  WIZ_TARGET_HP: 0x22,
  WIZ_MAGIC_PROCESS: 0x31,
});

const ATTACK_TYPE = Object.freeze({ DIRECT: 1, MAGIC: 2, DURATION: 3 });
const ATTACK_RESULT = Object.freeze({
  FAIL: 0,
  SUCCESS: 1,
  SUCCESS_AND_DEAD: 2,
  TARGET_DEAD_OK: 3,
  MAGIC_ATTACK_TARGET_DEAD: 4,
});
const MAGIC_COMMAND = Object.freeze({
  CASTING: 1,
  FLYING: 2,
  EFFECTING: 3,
  MAGIC_FAIL: 4,
  DURATION_EXPIRED: 5,
  CANCEL: 6,
});
const SLASH_101003_RESULT = Object.freeze({
  EFFECTING_SUCCESS: 'EFFECTING_SUCCESS',
  EFFECTING_MISS: 'EFFECTING_MISS',
  MAGIC_FAIL: 'MAGIC_FAIL',
});

const ATTACK_TYPE_NAME = reverseEnum(ATTACK_TYPE);
const ATTACK_RESULT_NAME = reverseEnum(ATTACK_RESULT);
const MAGIC_COMMAND_NAME = reverseEnum(MAGIC_COMMAND);

function reverseEnum(source) {
  return Object.freeze(Object.fromEntries(Object.entries(source).map(([name, value]) => [value, name])));
}

function requireSemanticEnum(value, values, label) {
  if (typeof value !== 'string' || !Object.prototype.hasOwnProperty.call(values, value)) {
    throw new CombatRuntimeCodecError(`${label} is not a verified semantic enum: ${String(value)}`);
  }
  return values[value];
}

function requireDecodedEnum(value, names, label) {
  const name = names[value];
  if (!name) throw new CombatRuntimeCodecError(`${label} has unknown wire enum ${value}`);
  return name;
}

function requireInteger(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new CombatRuntimeCodecError(`${label} out of range [${min}, ${max}]: ${String(value)}`);
  }
  return value;
}

function u8(value, label) { return requireInteger(value, 0, 0xff, label); }
function u16(value, label) { return requireInteger(value, 0, 0xffff, label); }
function i16(value, label) { return requireInteger(value, -0x8000, 0x7fff, label); }
function u32(value, label) { return requireInteger(value, 0, 0xffffffff, label); }

function exactPayload(input, bytes, opcode, label) {
  if (!Buffer.isBuffer(input) && !(input instanceof Uint8Array)) {
    throw new TypeError(`${label} payload must be Buffer or Uint8Array`);
  }
  const payload = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (payload.length !== bytes) {
    throw new CombatRuntimeCodecError(`${label} payload must be exactly ${bytes} bytes, got ${payload.length}`);
  }
  if (payload[0] !== opcode) {
    throw new CombatRuntimeCodecError(`${label} opcode mismatch: 0x${payload[0].toString(16).padStart(2, '0')}`);
  }
  return payload;
}

function encodeAttackResult({ attackType, result, attackerId, targetId }) {
  const payload = Buffer.alloc(7);
  payload[0] = OPCODE.WIZ_ATTACK;
  payload.writeUInt8(requireSemanticEnum(attackType, ATTACK_TYPE, 'attackType'), 1);
  payload.writeUInt8(requireSemanticEnum(result, ATTACK_RESULT, 'result'), 2);
  payload.writeInt16LE(i16(attackerId, 'attackerId'), 3);
  payload.writeInt16LE(i16(targetId, 'targetId'), 5);
  return payload;
}

function decodeAttackResult(input) {
  const payload = exactPayload(input, 7, OPCODE.WIZ_ATTACK, 'WIZ_ATTACK S2C');
  const attackTypeWire = payload.readUInt8(1);
  const resultWire = payload.readUInt8(2);
  return Object.freeze({
    attackType: requireDecodedEnum(attackTypeWire, ATTACK_TYPE_NAME, 'attackType'),
    result: requireDecodedEnum(resultWire, ATTACK_RESULT_NAME, 'result'),
    attackerId: payload.readInt16LE(3),
    targetId: payload.readInt16LE(5),
    wire: Object.freeze({ attackType: attackTypeWire, result: resultWire }),
  });
}

function decodeTargetHpQuery(input) {
  const payload = exactPayload(input, 4, OPCODE.WIZ_TARGET_HP, 'WIZ_TARGET_HP C2S');
  return Object.freeze({
    targetId: payload.readInt16LE(1),
    updateImmediately: payload.readUInt8(3),
  });
}

function encodeTargetHp({ targetId, updateImmediately, maxHp, currentHp, hpDelta }) {
  const payload = Buffer.alloc(14);
  payload[0] = OPCODE.WIZ_TARGET_HP;
  payload.writeInt16LE(i16(targetId, 'targetId'), 1);
  payload.writeUInt8(u8(updateImmediately, 'updateImmediately'), 3);
  payload.writeUInt32LE(u32(maxHp, 'maxHp'), 4);
  payload.writeUInt32LE(u32(currentHp, 'currentHp'), 8);
  payload.writeInt16LE(i16(hpDelta, 'hpDelta'), 12);
  return payload;
}

function decodeTargetHp(input) {
  const payload = exactPayload(input, 14, OPCODE.WIZ_TARGET_HP, 'WIZ_TARGET_HP S2C');
  return Object.freeze({
    targetId: payload.readInt16LE(1),
    updateImmediately: payload.readUInt8(3),
    maxHp: payload.readUInt32LE(4),
    currentHp: payload.readUInt32LE(8),
    hpDelta: payload.readInt16LE(12),
  });
}

function encodeDead({ targetId }) {
  const payload = Buffer.alloc(3);
  payload[0] = OPCODE.WIZ_DEAD;
  payload.writeInt16LE(i16(targetId, 'targetId'), 1);
  return payload;
}

function decodeDead(input) {
  const payload = exactPayload(input, 3, OPCODE.WIZ_DEAD, 'WIZ_DEAD S2C');
  return Object.freeze({ targetId: payload.readInt16LE(1) });
}

function encodePlayerHp({ maxHp, currentHp }) {
  const payload = Buffer.alloc(5);
  payload[0] = OPCODE.WIZ_HP_CHANGE;
  payload.writeInt16LE(i16(maxHp, 'maxHp'), 1);
  payload.writeInt16LE(i16(currentHp, 'currentHp'), 3);
  return payload;
}

function decodePlayerHp(input) {
  const payload = exactPayload(input, 5, OPCODE.WIZ_HP_CHANGE, 'WIZ_HP_CHANGE S2C');
  return Object.freeze({ maxHp: payload.readInt16LE(1), currentHp: payload.readInt16LE(3) });
}

function encodePlayerMsp({ maxMsp, currentMsp }) {
  const payload = Buffer.alloc(5);
  payload[0] = OPCODE.WIZ_MSP_CHANGE;
  payload.writeInt16LE(i16(maxMsp, 'maxMsp'), 1);
  payload.writeInt16LE(i16(currentMsp, 'currentMsp'), 3);
  return payload;
}

function decodePlayerMsp(input) {
  const payload = exactPayload(input, 5, OPCODE.WIZ_MSP_CHANGE, 'WIZ_MSP_CHANGE S2C');
  return Object.freeze({ maxMsp: payload.readInt16LE(1), currentMsp: payload.readInt16LE(3) });
}

function encodeMagicProcess({ command, skillId, sourceId, targetId, data }) {
  if (!Array.isArray(data) || data.length !== 6) {
    throw new CombatRuntimeCodecError('WIZ_MAGIC_PROCESS data must contain exactly six i16 fields');
  }
  const payload = Buffer.alloc(22);
  payload[0] = OPCODE.WIZ_MAGIC_PROCESS;
  payload.writeUInt8(requireSemanticEnum(command, MAGIC_COMMAND, 'command'), 1);
  payload.writeUInt32LE(u32(skillId, 'skillId'), 2);
  payload.writeInt16LE(i16(sourceId, 'sourceId'), 6);
  payload.writeInt16LE(i16(targetId, 'targetId'), 8);
  data.forEach((value, index) => payload.writeInt16LE(i16(value, `data[${index}]`), 10 + (index * 2)));
  return payload;
}

function decodeMagicProcess(input) {
  const payload = exactPayload(input, 22, OPCODE.WIZ_MAGIC_PROCESS, 'WIZ_MAGIC_PROCESS full');
  const commandWire = payload.readUInt8(1);
  const data = [];
  for (let offset = 10; offset < 22; offset += 2) data.push(payload.readInt16LE(offset));
  return Object.freeze({
    command: requireDecodedEnum(commandWire, MAGIC_COMMAND_NAME, 'command'),
    skillId: payload.readUInt32LE(2),
    sourceId: payload.readInt16LE(6),
    targetId: payload.readInt16LE(8),
    data: Object.freeze(data),
    wire: Object.freeze({ command: commandWire }),
  });
}

function encodeSlash101003Result({ result, sourceId, targetId }) {
  let command;
  let data;
  switch (result) {
    case SLASH_101003_RESULT.EFFECTING_SUCCESS:
      command = 'EFFECTING';
      data = [1, 1, 0, 0, 0, 0];
      break;
    case SLASH_101003_RESULT.EFFECTING_MISS:
      command = 'EFFECTING';
      data = [1, 0, 0, 0, 0, -104];
      break;
    case SLASH_101003_RESULT.MAGIC_FAIL:
      command = 'MAGIC_FAIL';
      data = [0, 0, 0, 0, 0, 0];
      break;
    default:
      throw new CombatRuntimeCodecError(`Slash 101003 result is not verified: ${String(result)}`);
  }
  return encodeMagicProcess({ command, skillId: 101003, sourceId, targetId, data });
}

function decodeSlash101003Result(input) {
  const decoded = decodeMagicProcess(input);
  if (decoded.skillId !== 101003) {
    throw new CombatRuntimeCodecError(`expected Slash skill 101003, got ${decoded.skillId}`);
  }
  const key = decoded.data.join(',');
  if (decoded.command === 'EFFECTING' && key === '1,1,0,0,0,0') {
    return Object.freeze({ ...decoded, result: SLASH_101003_RESULT.EFFECTING_SUCCESS });
  }
  if (decoded.command === 'EFFECTING' && key === '1,0,0,0,0,-104') {
    return Object.freeze({ ...decoded, result: SLASH_101003_RESULT.EFFECTING_MISS });
  }
  if (decoded.command === 'MAGIC_FAIL' && key === '0,0,0,0,0,0') {
    return Object.freeze({ ...decoded, result: SLASH_101003_RESULT.MAGIC_FAIL });
  }
  throw new CombatRuntimeCodecError('Slash 101003 payload is not one of the verified playable-slice results');
}

function encodeLatin1Strict(value, label) {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value !== 'string') throw new TypeError(`${label} must be a latin-1 string or bytes`);
  for (let i = 0; i < value.length; i += 1) {
    if (value.charCodeAt(i) > 0xff) throw new CombatRuntimeCodecError(`${label} contains non-latin-1 code point`);
  }
  return Buffer.from(value, 'latin1');
}

function encodeNpcDetailRecord(record) {
  if (!record || typeof record !== 'object') throw new TypeError('NPC_DETAIL_RECORD object is required');
  const name = encodeLatin1Strict(record.name_bytes ?? record.name, 'name');
  u8(name.length, 'name length');
  const payload = Buffer.alloc(38 + name.length);
  let offset = 0;
  payload.writeInt16LE(i16(record.runtime_id, 'runtime_id'), offset); offset += 2;
  payload.writeInt16LE(i16(record.template_resource_id, 'template_resource_id'), offset); offset += 2;
  payload.writeUInt8(u8(record.npc_type, 'npc_type'), offset); offset += 1;
  payload.writeUInt32LE(u32(record.selling_group, 'selling_group'), offset); offset += 4;
  payload.writeInt16LE(i16(record.scale_percent, 'scale_percent'), offset); offset += 2;
  payload.writeUInt32LE(u32(record.weapon_1_item_id, 'weapon_1_item_id'), offset); offset += 4;
  payload.writeUInt32LE(u32(record.weapon_2_item_id, 'weapon_2_item_id'), offset); offset += 4;
  payload.writeUInt8(name.length, offset); offset += 1;
  name.copy(payload, offset); offset += name.length;
  payload.writeUInt8(u8(record.group_nation, 'group_nation'), offset); offset += 1;
  payload.writeUInt8(u8(record.level, 'level'), offset); offset += 1;
  payload.writeUInt16LE(u16(record.x10, 'x10'), offset); offset += 2;
  payload.writeUInt16LE(u16(record.z10, 'z10'), offset); offset += 2;
  payload.writeInt16LE(i16(record.y10, 'y10'), offset); offset += 2;
  payload.writeUInt32LE(u32(record.state_gate_open, 'state_gate_open'), offset); offset += 4;
  payload.writeUInt8(u8(record.object_type, 'object_type'), offset); offset += 1;
  payload.writeInt16LE(i16(record.client_idk0, 'client_idk0'), offset); offset += 2;
  payload.writeInt16LE(i16(record.client_idk1, 'client_idk1'), offset); offset += 2;
  payload.writeUInt8(u8(record.direction, 'direction'), offset); offset += 1;
  if (offset !== payload.length) throw new Error('internal NPC_DETAIL_RECORD length mismatch');
  return payload;
}

function decodeNpcDetailRecord(input, startOffset = 0) {
  if (!Buffer.isBuffer(input) && !(input instanceof Uint8Array)) throw new TypeError('NPC_DETAIL_RECORD bytes required');
  const payload = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (!Number.isSafeInteger(startOffset) || startOffset < 0 || startOffset > payload.length) {
    throw new CombatRuntimeCodecError('NPC_DETAIL_RECORD startOffset out of range');
  }
  let offset = startOffset;
  const need = (bytes, label) => {
    if (offset + bytes > payload.length) throw new CombatRuntimeCodecError(`truncated NPC_DETAIL_RECORD ${label}`);
  };
  need(20, 'prefix');
  const runtime_id = payload.readInt16LE(offset); offset += 2;
  const template_resource_id = payload.readInt16LE(offset); offset += 2;
  const npc_type = payload.readUInt8(offset); offset += 1;
  const selling_group = payload.readUInt32LE(offset); offset += 4;
  const scale_percent = payload.readInt16LE(offset); offset += 2;
  const weapon_1_item_id = payload.readUInt32LE(offset); offset += 4;
  const weapon_2_item_id = payload.readUInt32LE(offset); offset += 4;
  const nameLength = payload.readUInt8(offset); offset += 1;
  need(nameLength + 18, 'suffix');
  const name_bytes = Buffer.from(payload.subarray(offset, offset + nameLength)); offset += nameLength;
  const group_nation = payload.readUInt8(offset); offset += 1;
  const level = payload.readUInt8(offset); offset += 1;
  const x10 = payload.readUInt16LE(offset); offset += 2;
  const z10 = payload.readUInt16LE(offset); offset += 2;
  const y10 = payload.readInt16LE(offset); offset += 2;
  const state_gate_open = payload.readUInt32LE(offset); offset += 4;
  const object_type = payload.readUInt8(offset); offset += 1;
  const client_idk0 = payload.readInt16LE(offset); offset += 2;
  const client_idk1 = payload.readInt16LE(offset); offset += 2;
  const direction = payload.readUInt8(offset); offset += 1;
  return Object.freeze({
    record: Object.freeze({
      runtime_id, template_resource_id, npc_type, selling_group, scale_percent,
      weapon_1_item_id, weapon_2_item_id, name_bytes, name: name_bytes.toString('latin1'),
      group_nation, level, x10, z10, y10, state_gate_open, object_type, client_idk0, client_idk1, direction,
    }),
    nextOffset: offset,
  });
}

function encodeNpcIn(record) {
  const detail = encodeNpcDetailRecord(record);
  return Buffer.concat([Buffer.from([OPCODE.WIZ_NPC_INOUT, 1]), detail]);
}

function decodeNpcIn(input) {
  if (!Buffer.isBuffer(input) && !(input instanceof Uint8Array)) throw new TypeError('WIZ_NPC_INOUT IN payload bytes required');
  const payload = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (payload.length < 3) throw new CombatRuntimeCodecError('truncated WIZ_NPC_INOUT IN payload');
  if (payload[0] !== OPCODE.WIZ_NPC_INOUT) throw new CombatRuntimeCodecError('WIZ_NPC_INOUT opcode mismatch');
  if (payload[1] !== 1) throw new CombatRuntimeCodecError(`WIZ_NPC_INOUT semantic enum is not IN(1): ${payload[1]}`);
  const decoded = decodeNpcDetailRecord(payload, 2);
  if (decoded.nextOffset !== payload.length) throw new CombatRuntimeCodecError('trailing bytes after NPC_DETAIL_RECORD');
  return Object.freeze({ inout: 'IN', record: decoded.record });
}

module.exports = Object.freeze({
  CombatRuntimeCodecError,
  OPCODE,
  ATTACK_TYPE,
  ATTACK_RESULT,
  MAGIC_COMMAND,
  SLASH_101003_RESULT,
  encodeAttackResult,
  decodeAttackResult,
  decodeTargetHpQuery,
  encodeTargetHp,
  decodeTargetHp,
  encodeDead,
  decodeDead,
  encodePlayerHp,
  decodePlayerHp,
  encodePlayerMsp,
  decodePlayerMsp,
  encodeMagicProcess,
  decodeMagicProcess,
  encodeSlash101003Result,
  decodeSlash101003Result,
  encodeNpcDetailRecord,
  decodeNpcDetailRecord,
  encodeNpcIn,
  decodeNpcIn,
});
