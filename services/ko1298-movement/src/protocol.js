'use strict';

const OPCODES = Object.freeze({
  MOVE: 0x06,
  ROTATE: 0x09,
  WARP: 0x1e,
});

const POSITION_SCALE = 10;
const MOVE_PAYLOAD_BYTES = 9;
const ROTATE_PAYLOAD_BYTES = 2;
const MOVE_FLAG_MOVING = 0x01;
const MOVE_FLAG_CONTINUOUS = 0x02;
const MOVE_FLAG_KNOWN_MASK = MOVE_FLAG_MOVING | MOVE_FLAG_CONTINUOUS;

class ProtocolError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ProtocolError';
    this.code = code;
  }
}

function assertBuffer(value, expectedLength, label) {
  if (!Buffer.isBuffer(value)) {
    throw new ProtocolError('invalid_buffer', `${label} must be a Buffer`);
  }
  if (value.length !== expectedLength) {
    throw new ProtocolError(
      'invalid_length',
      `${label} must be exactly ${expectedLength} bytes (got ${value.length})`,
    );
  }
}

function classifyMoveFlag(flag) {
  if (!Number.isInteger(flag) || flag < 0 || flag > 0xff) {
    throw new ProtocolError('invalid_move_flag', 'movement flag must be an unsigned byte');
  }
  if ((flag & ~MOVE_FLAG_KNOWN_MASK) !== 0) {
    throw new ProtocolError('unknown_move_flag_bits', `unsupported movement flag bits: 0x${flag.toString(16)}`);
  }

  const moving = (flag & MOVE_FLAG_MOVING) !== 0;
  const continuous = (flag & MOVE_FLAG_CONTINUOUS) !== 0;
  if (!moving && continuous) {
    throw new ProtocolError('invalid_move_flag_combination', 'continuous movement requires the moving bit');
  }

  return {
    moving,
    continuous,
    phase: moving ? (continuous ? 'update' : 'start') : 'end',
  };
}

function decodeMovePayload(payload) {
  assertBuffer(payload, MOVE_PAYLOAD_BYTES, 'WIZ_MOVE payload');

  const rawX = payload.readUInt16LE(0);
  const rawZ = payload.readUInt16LE(2);
  const rawY = payload.readInt16LE(4);
  const rawSpeed = payload.readUInt16LE(6);
  const flag = payload.readUInt8(8);
  const flags = classifyMoveFlag(flag);

  return {
    rawX,
    rawZ,
    rawY,
    rawSpeed,
    flag,
    ...flags,
    position: {
      x: rawX / POSITION_SCALE,
      z: rawZ / POSITION_SCALE,
      y: rawY / POSITION_SCALE,
    },
    speed: rawSpeed / POSITION_SCALE,
  };
}

function encodeMovePayload({ rawX, rawZ, rawY, rawSpeed, flag }) {
  for (const [name, value, min, max] of [
    ['rawX', rawX, 0, 0xffff],
    ['rawZ', rawZ, 0, 0xffff],
    ['rawY', rawY, -0x8000, 0x7fff],
    ['rawSpeed', rawSpeed, 0, 0xffff],
    ['flag', flag, 0, 0xff],
  ]) {
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new ProtocolError('integer_overflow', `${name} is outside its wire range`);
    }
  }
  classifyMoveFlag(flag);

  const payload = Buffer.alloc(MOVE_PAYLOAD_BYTES);
  payload.writeUInt16LE(rawX, 0);
  payload.writeUInt16LE(rawZ, 2);
  payload.writeInt16LE(rawY, 4);
  payload.writeUInt16LE(rawSpeed, 6);
  payload.writeUInt8(flag, 8);
  return payload;
}

function encodeMoveBroadcast(entityId, movement) {
  if (!Number.isInteger(entityId) || entityId < 0 || entityId > 0xffff) {
    throw new ProtocolError('invalid_entity_id', 'entityId must fit uint16');
  }
  const payload = encodeMovePayload(movement);
  const packet = Buffer.alloc(1 + 2 + payload.length);
  packet.writeUInt8(OPCODES.MOVE, 0);
  packet.writeUInt16LE(entityId, 1);
  payload.copy(packet, 3);
  return packet;
}

function decodeRotatePayload(payload) {
  assertBuffer(payload, ROTATE_PAYLOAD_BYTES, 'WIZ_ROTATE payload');
  return { headingRaw: payload.readInt16LE(0) };
}

function encodeRotateBroadcast(entityId, headingRaw) {
  if (!Number.isInteger(entityId) || entityId < 0 || entityId > 0xffff) {
    throw new ProtocolError('invalid_entity_id', 'entityId must fit uint16');
  }
  if (!Number.isInteger(headingRaw) || headingRaw < -0x8000 || headingRaw > 0x7fff) {
    throw new ProtocolError('invalid_heading', 'headingRaw must fit int16');
  }
  const packet = Buffer.alloc(5);
  packet.writeUInt8(OPCODES.ROTATE, 0);
  packet.writeUInt16LE(entityId, 1);
  packet.writeInt16LE(headingRaw, 3);
  return packet;
}

module.exports = {
  OPCODES,
  POSITION_SCALE,
  MOVE_PAYLOAD_BYTES,
  ROTATE_PAYLOAD_BYTES,
  MOVE_FLAG_MOVING,
  MOVE_FLAG_CONTINUOUS,
  ProtocolError,
  classifyMoveFlag,
  decodeMovePayload,
  encodeMovePayload,
  encodeMoveBroadcast,
  decodeRotatePayload,
  encodeRotateBroadcast,
};
