'use strict';

const { OPCODES, CHAT_TYPES, PARTY_SUBOPCODES, LIMITS } = require('./constants');

class ProtocolError extends Error {
  constructor(code, message) { super(message); this.name = 'ProtocolError'; this.code = code; }
}

function ensureBuffer(value, field = 'value') {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (typeof value === 'string') return Buffer.from(value, 'latin1');
  throw new TypeError(`${field} must be a Buffer or string`);
}

function need(buffer, offset, length, field) {
  if (!Buffer.isBuffer(buffer) || offset < 0 || length < 0 || offset + length > buffer.length) {
    throw new ProtocolError('TRUNCATED_PACKET', `truncated ${field}`);
  }
}
function readU8(buffer, state, field) { need(buffer, state.offset, 1, field); return buffer[state.offset++]; }
function readU16(buffer, state, field) { need(buffer, state.offset, 2, field); const v = buffer.readUInt16LE(state.offset); state.offset += 2; return v; }
function readI16(buffer, state, field) { need(buffer, state.offset, 2, field); const v = buffer.readInt16LE(state.offset); state.offset += 2; return v; }
function readBytes(buffer, state, n, field) { need(buffer, state.offset, n, field); const v = Buffer.from(buffer.subarray(state.offset, state.offset + n)); state.offset += n; return v; }
function lp(bytes) { const b = ensureBuffer(bytes); const out = Buffer.alloc(2 + b.length); out.writeUInt16LE(b.length, 0); b.copy(out, 2); return out; }
function i16(v) { const b = Buffer.alloc(2); b.writeInt16LE(v, 0); return b; }

function decodeClientPacket(packet) {
  const b = ensureBuffer(packet, 'packet');
  if (!b.length) throw new ProtocolError('EMPTY_PACKET', 'empty packet');
  const opcode = b[0];
  const payload = b.subarray(1);
  const s = { offset: 0 };
  if (opcode === OPCODES.CHAT) {
    const type = readU8(payload, s, 'chat type');
    const n = readU16(payload, s, 'chat length');
    if (n < 1 || n > LIMITS.MAX_MESSAGE_BYTES) throw new ProtocolError('INVALID_MESSAGE_LENGTH', 'chat message must be 1..512 bytes');
    return { opcode, type, message: readBytes(payload, s, n, 'chat message') };
  }
  if (opcode === OPCODES.CHAT_TARGET) {
    const n = readU16(payload, s, 'target name length');
    if (n < 1 || n > LIMITS.MAX_NAME_BYTES) throw new ProtocolError('INVALID_TARGET_LENGTH', 'target name must be 1..30 bytes');
    return { opcode, name: readBytes(payload, s, n, 'target name') };
  }
  if (opcode === OPCODES.PARTY) {
    const subopcode = readU8(payload, s, 'party subopcode');
    if (subopcode === PARTY_SUBOPCODES.CREATE || subopcode === PARTY_SUBOPCODES.INSERT) {
      const n = readU16(payload, s, 'party target length');
      if (n < 1 || n > LIMITS.MAX_NAME_BYTES) throw new ProtocolError('INVALID_TARGET_LENGTH', 'party target must be 1..30 bytes');
      return { opcode, subopcode, name: readBytes(payload, s, n, 'party target') };
    }
    if (subopcode === PARTY_SUBOPCODES.PERMIT) return { opcode, subopcode, accepted: readU8(payload, s, 'party permit') !== 0 };
    if (subopcode === PARTY_SUBOPCODES.REMOVE) return { opcode, subopcode, memberSid: readI16(payload, s, 'party member sid') };
    if (subopcode === PARTY_SUBOPCODES.DELETE) return { opcode, subopcode };
    return { opcode, subopcode };
  }
  return { opcode, payload: Buffer.from(payload) };
}

function encodeChatPacket({ type, nation, sid, text }) {
  const t = ensureBuffer(text, 'text');
  return Buffer.concat([Buffer.from([OPCODES.CHAT, type & 0xff, nation & 0xff]), i16(sid), lp(t)]);
}
function encodeChatTargetResult(nameBytes) { return Buffer.concat([Buffer.from([OPCODES.CHAT_TARGET]), nameBytes ? lp(nameBytes) : Buffer.from([0, 0])]); }
function encodePartyPermit({ leaderSid, leaderName }) { return Buffer.concat([Buffer.from([OPCODES.PARTY, PARTY_SUBOPCODES.PERMIT]), i16(leaderSid), lp(leaderName)]); }
function encodePartyInsertFailure(code) { return Buffer.concat([Buffer.from([OPCODES.PARTY, PARTY_SUBOPCODES.INSERT]), i16(code)]); }
function encodePartyMemberInsert(member) {
  const name = ensureBuffer(member.nameBytes ?? member.name, 'member.name');
  const tail = Buffer.alloc(11);
  tail.writeInt16LE(member.maxHp ?? 0, 0); tail.writeInt16LE(member.hp ?? 0, 2); tail.writeUInt8(member.level ?? 1, 4);
  tail.writeInt16LE(member.classId ?? 0, 5); tail.writeInt16LE(member.maxMp ?? 0, 7); tail.writeInt16LE(member.mp ?? 0, 9);
  return Buffer.concat([Buffer.from([OPCODES.PARTY, PARTY_SUBOPCODES.INSERT]), i16(member.sid), lp(name), tail]);
}
function encodePartyRemove(sid) { return Buffer.concat([Buffer.from([OPCODES.PARTY, PARTY_SUBOPCODES.REMOVE]), i16(sid)]); }
function encodePartyDelete() { return Buffer.from([OPCODES.PARTY, PARTY_SUBOPCODES.DELETE]); }

module.exports = {
  ProtocolError, ensureBuffer, decodeClientPacket, encodeChatPacket, encodeChatTargetResult,
  encodePartyPermit, encodePartyInsertFailure, encodePartyMemberInsert, encodePartyRemove, encodePartyDelete,
};
