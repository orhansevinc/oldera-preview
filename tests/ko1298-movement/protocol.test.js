'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  OPCODES,
  ProtocolError,
  decodeMovePayload,
  encodeMoveBroadcast,
  decodeRotatePayload,
  encodeRotateBroadcast,
} = require('../../services/ko1298-movement/src');

function movePayload({ x = 1000, z = 2000, y = 50, speed = 45, flag = 0x01 } = {}) {
  const buf = Buffer.alloc(9);
  buf.writeUInt16LE(x, 0);
  buf.writeUInt16LE(z, 2);
  buf.writeInt16LE(y, 4);
  buf.writeUInt16LE(speed, 6);
  buf.writeUInt8(flag, 8);
  return buf;
}

test('decodes the verified 1298 WIZ_MOVE payload and classifies phases', () => {
  const start = decodeMovePayload(movePayload({ flag: 0x01 }));
  assert.deepEqual(start.position, { x: 100, z: 200, y: 5 });
  assert.equal(start.speed, 4.5);
  assert.equal(start.phase, 'start');

  const update = decodeMovePayload(movePayload({ flag: 0x03 }));
  assert.equal(update.phase, 'update');

  const end = decodeMovePayload(movePayload({ speed: 0, flag: 0x00 }));
  assert.equal(end.phase, 'end');
});

test('rejects malformed move flags and payload lengths', () => {
  assert.throws(() => decodeMovePayload(Buffer.alloc(8)), (error) => error instanceof ProtocolError && error.code === 'invalid_length');
  assert.throws(() => decodeMovePayload(movePayload({ flag: 0x02 })), (error) => error.code === 'invalid_move_flag_combination');
  assert.throws(() => decodeMovePayload(movePayload({ flag: 0x80 })), (error) => error.code === 'unknown_move_flag_bits');
});

test('encodes movement broadcast with opcode and entity id in little-endian order', () => {
  const decoded = decodeMovePayload(movePayload({ x: 1234, z: 4321, y: -42, speed: 61, flag: 0x03 }));
  const packet = encodeMoveBroadcast(0x1234, decoded);
  assert.equal(packet.length, 12);
  assert.equal(packet.readUInt8(0), OPCODES.MOVE);
  assert.equal(packet.readUInt16LE(1), 0x1234);
  assert.equal(packet.readUInt16LE(3), 1234);
  assert.equal(packet.readUInt16LE(5), 4321);
  assert.equal(packet.readInt16LE(7), -42);
  assert.equal(packet.readUInt16LE(9), 61);
  assert.equal(packet.readUInt8(11), 0x03);
});

test('decodes and encodes WIZ_ROTATE heading as signed int16', () => {
  const payload = Buffer.alloc(2);
  payload.writeInt16LE(-1234, 0);
  assert.deepEqual(decodeRotatePayload(payload), { headingRaw: -1234 });
  const packet = encodeRotateBroadcast(77, -1234);
  assert.equal(packet.readUInt8(0), OPCODES.ROTATE);
  assert.equal(packet.readUInt16LE(1), 77);
  assert.equal(packet.readInt16LE(3), -1234);
});
