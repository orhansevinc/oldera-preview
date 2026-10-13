'use strict';

const {
  OPCODES,
  CHAT_TYPES,
  PARTY_SUBOPCODES,
  LIMITS,
} = require('./constants');

class ProtocolError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ProtocolError';
    this.code = code;
  }
}

function ensureBuffer(value, field = 'value') {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (typeof value === 'string') return Buffer.from(value, 'latin1');
  throw new TypeError(`${field} must be a Buffer or string`);
}

function ensureAvailable(buffer, offset, length, field) {
  if (!Buffer.isBuffer(buffer)) throw new TypeError('packet must be a Buffer');
  if (offset < 0 || length < 0 || offset + length > buffer.length) {
    throw new ProtocolError('TRUNCATED_PACKET', `truncated ${field}`);
  }
}

function readUInt8(buffer, state, field) {
  ensureAvailable(buffer, state.offset, 1, field);
  return buffer[state.offset++];
}

function readUInt16LE(buffer, state, field) {
  ensureAvailable(buffer, state.offset, 2, field);
  const value = buffer.readUInt16LE(state.offset);
  state.offset += 2;
  return value;
}

function readInt16LE(buffer, state, field) {
  ensureAvailable(buffer, state.offset, 2, field);
  const value = buffer.readInt16LE(state.offset);
  state.offset += 2;
  return value;
}

function readBytes(buffer, state, length, field) {
  ensureAvailable(buffer, state.offset, length, field);
  const value = Buffer.from(buffer.subarray(state.offset, state.offset + length));
  state.offset += length;
  return value;
}

function lengthPrefixedBytes(bytes) {
  const data = ensureBuffer(bytes, 'bytes');
  if (data.length > 0xffff) throw new RangeError('length exceeds uint16');
  const out = Buffer.allocUnsafe(2 + data.length);
  out.writeUInt16LE(data.length, 0);
  data.copy(out, 2);
  return out;
}

function int16(value, field) {
  if (!Number.isInteger(value) || value < -0x8000 || value > 0x7fff) {
    throw new RangeError(`${field} must fit int16`);
  }
  const out = Buffer.allocUnsafe(2);
  out.writeInt16LE(value, 0);
  return out;
}

function uint8(value, field) {
  if (!Number.isInteger(value) || value < 0 || value > 0xff) {
    throw new RangeError(`${field} must fit uint8`);
  }
  return Buffer.from([value]);
}

function decodeChatPayload(payload) {
  const state = { offset: 0 };
  const type = readUInt8(payload, state, 'chat type');
  const messageLength = readUInt16LE(payload, state, 'chat length');
  if (messageLength < 1 || messageLength > LIMITS.MAX_MESSAGE_BYTES) {
    throw new ProtocolError('INVALID_MESSAGE_LENGTH', 'chat message must be 1..512 bytes');
  }
  const message = readBytes(payload, state, messageLength, 'chat message');
  return { type, message };
}

function decodeChatTargetPayload(payload) {
  const state = { offset: 0 };
  const nameLength = readUInt16LE(payload, state, 'target name length');
  if (nameLength < 1 || nameLength > LIMITS.MAX_NAME_BYTES) {
    throw new ProtocolError('INVALID_TARGET_LENGTH', 'target name must be 1..30 bytes');
  }
  const name = readBytes(payload, state, nameLength, 'target name');
  return { name };
}

function decodePartyPayload(payload) {
  const state = { offset: 0 };
  const subopcode = readUInt8(payload, state, 'party subopcode');

  if (subopcode === PARTY_SUBOPCODES.CREATE || subopcode === PARTY_SUBOPCODES.INSERT) {
    const nameLength = readUInt16LE(payload, state, 'party target length');
    if (nameLength < 1 || nameLength > LIMITS.MAX_NAME_BYTES) {
      throw new ProtocolError('INVALID_TARGET_LENGTH', 'party target must be 1..30 bytes');
    }
    return { subopcode, name: readBytes(payload, state, nameLength, 'party target') };
  }

  if (subopcode === PARTY_SUBOPCODES.PERMIT) {
    return { subopcode, accepted: readUInt8(payload, state, 'party permit') !== 0 };
  }

  if (subopcode === PARTY_SUBOPCODES.REMOVE) {
    return { subopcode, memberSid: readInt16LE(payload, state, 'party member sid') };
  }

  if (subopcode === PARTY_SUBOPCODES.DELETE) return { subopcode };
  throw new ProtocolError('UNSUPPORTED_PARTY_SUBOPCODE', `unsupported party subopcode ${subopcode}`);
}

function encodeChatPacket({ type, nation, sid, text }) {
  const textBytes = ensureBuffer(text, 'text');
  return Buffer.concat([
    Buffer.from([OPCODES.CHAT]),
    uint8(type, 'chat type'),
    uint8(nation ?? 0, 'nation'),
    int16(sid, 'sid'),
    lengthPrefixedBytes(textBytes),
  ]);
}

function encodeChatTargetResult(name) {
  const bytes = name == null ? Buffer.alloc(0) : ensureBuffer(name, 'name');
  if (bytes.length > LIMITS.MAX_NAME_BYTES) throw new RangeError('name exceeds legacy MAX_ID_SIZE');
  return Buffer.concat([Buffer.from([OPCODES.CHAT_TARGET]), lengthPrefixedBytes(bytes)]);
}

function encodePartyPermit({ leaderSid, leaderName }) {
  const name = ensureBuffer(leaderName, 'leaderName');
  return Buffer.concat([
    Buffer.from([OPCODES.PARTY, PARTY_SUBOPCODES.PERMIT]),
    int16(leaderSid, 'leaderSid'),
    lengthPrefixedBytes(name),
  ]);
}

function encodePartyInsertFailure(code = -1) {
  return Buffer.concat([
    Buffer.from([OPCODES.PARTY, PARTY_SUBOPCODES.INSERT]),
    int16(code, 'party result'),
  ]);
}

function encodePartyMemberInsert(member) {
  const name = ensureBuffer(member.name, 'member.name');
  return Buffer.concat([
    Buffer.from([OPCODES.PARTY, PARTY_SUBOPCODES.INSERT]),
    int16(member.sid, 'member.sid'),
    lengthPrefixedBytes(name),
    int16(member.maxHp ?? 0, 'member.maxHp'),
    int16(member.hp ?? 0, 'member.hp'),
    uint8(member.level ?? 1, 'member.level'),
    int16(member.classId ?? 0, 'member.classId'),
    int16(member.maxMp ?? 0, 'member.maxMp'),
    int16(member.mp ?? 0, 'member.mp'),
  ]);
}

function encodePartyRemove(memberSid) {
  return Buffer.concat([
    Buffer.from([OPCODES.PARTY, PARTY_SUBOPCODES.REMOVE]),
    int16(memberSid, 'memberSid'),
  ]);
}

function encodePartyDelete() {
  return Buffer.from([OPCODES.PARTY, PARTY_SUBOPCODES.DELETE]);
}

function decodeClientPacket(packet) {
  if (!Buffer.isBuffer(packet) || packet.length < 1) {
    throw new ProtocolError('EMPTY_PACKET', 'packet must contain an opcode');
  }
  const opcode = packet[0];
  const payload = packet.subarray(1);
  if (opcode === OPCODES.CHAT) return { opcode, ...decodeChatPayload(payload) };
  if (opcode === OPCODES.CHAT_TARGET) return { opcode, ...decodeChatTargetPayload(payload) };
  if (opcode === OPCODES.PARTY) return { opcode, ...decodePartyPayload(payload) };
  throw new ProtocolError('UNSUPPORTED_OPCODE', `unsupported opcode ${opcode}`);
}

module.exports = {
  ProtocolError,
  ensureBuffer,
  decodeChatPayload,
  decodeChatTargetPayload,
  decodePartyPayload,
  decodeClientPacket,
  encodeChatPacket,
  encodeChatTargetResult,
  encodePartyPermit,
  encodePartyInsertFailure,
  encodePartyMemberInsert,
  encodePartyRemove,
  encodePartyDelete,
};
