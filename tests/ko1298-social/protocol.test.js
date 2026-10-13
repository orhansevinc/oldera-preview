'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  OPCODES,
  CHAT_TYPES,
  PARTY_SUBOPCODES,
  ProtocolError,
  decodeClientPacket,
  encodeChatTargetResult,
  encodePartyPermit,
  encodePartyMemberInsert,
} = require('../../services/ko1298-social');

function lp(text) {
  const bytes = Buffer.from(text, 'latin1');
  const len = Buffer.alloc(2);
  len.writeUInt16LE(bytes.length);
  return Buffer.concat([len, bytes]);
}

test('decodes legacy WIZ_CHAT request as type + uint16 length + bytes', () => {
  const packet = Buffer.concat([Buffer.from([OPCODES.CHAT, CHAT_TYPES.GENERAL]), lp('hello')]);
  const decoded = decodeClientPacket(packet);
  assert.equal(decoded.opcode, 0x10);
  assert.equal(decoded.type, 0x01);
  assert.equal(decoded.message.toString('latin1'), 'hello');
});

test('rejects empty and >512-byte chat payloads', () => {
  const zero = Buffer.from([OPCODES.CHAT, CHAT_TYPES.GENERAL, 0, 0]);
  assert.throws(() => decodeClientPacket(zero), (error) => error instanceof ProtocolError && error.code === 'INVALID_MESSAGE_LENGTH');

  const len = Buffer.alloc(2);
  len.writeUInt16LE(513);
  const huge = Buffer.concat([Buffer.from([OPCODES.CHAT, CHAT_TYPES.GENERAL]), len, Buffer.alloc(513, 0x41)]);
  assert.throws(() => decodeClientPacket(huge), (error) => error instanceof ProtocolError && error.code === 'INVALID_MESSAGE_LENGTH');
});

test('decodes chat target and party request packet shapes', () => {
  const target = decodeClientPacket(Buffer.concat([Buffer.from([OPCODES.CHAT_TARGET]), lp('Target') ]));
  assert.equal(target.name.toString('latin1'), 'Target');

  const party = decodeClientPacket(Buffer.concat([Buffer.from([OPCODES.PARTY, PARTY_SUBOPCODES.CREATE]), lp('Target')]));
  assert.equal(party.subopcode, PARTY_SUBOPCODES.CREATE);
  assert.equal(party.name.toString('latin1'), 'Target');
});

test('encodes legacy chat target success/failure response', () => {
  assert.deepEqual(encodeChatTargetResult(null), Buffer.from([0x35, 0x00, 0x00]));
  assert.deepEqual(encodeChatTargetResult('Bob'), Buffer.from([0x35, 0x03, 0x00, 0x42, 0x6f, 0x62]));
});

test('encodes PARTY_PERMIT with leader SID and name', () => {
  const packet = encodePartyPermit({ leaderSid: 101, leaderName: 'Leader' });
  assert.equal(packet[0], 0x2f);
  assert.equal(packet[1], 0x02);
  assert.equal(packet.readInt16LE(2), 101);
  assert.equal(packet.readUInt16LE(4), 6);
  assert.equal(packet.subarray(6).toString('latin1'), 'Leader');
});

test('encodes PARTY_INSERT legacy member snapshot without owning combat state', () => {
  const packet = encodePartyMemberInsert({
    sid: 102,
    name: 'Member',
    maxHp: 1000,
    hp: 900,
    level: 60,
    classId: 106,
    maxMp: 500,
    mp: 450,
  });
  assert.equal(packet[0], 0x2f);
  assert.equal(packet[1], 0x03);
  assert.equal(packet.readInt16LE(2), 102);
  const nameLength = packet.readUInt16LE(4);
  assert.equal(packet.subarray(6, 6 + nameLength).toString('latin1'), 'Member');
  assert.equal(packet.readInt16LE(6 + nameLength), 1000);
});
