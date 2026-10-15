'use strict';

const FRAME_HEAD = Buffer.from([0xaa, 0x55]);
const FRAME_TAIL = Buffer.from([0x55, 0xaa]);
const LOGIN = { SERVER_LIST: 0xF5, LOGIN_REQ: 0xF3, NEWS: 0xF6 };
const GAME = {
  LOGIN: 0x01,
  NEW_CHAR: 0x02,
  SEL_CHAR: 0x04,
  SEL_NATION: 0x05,
  MOVE: 0x06,
  ATTACK: 0x08,
  ROTATE: 0x09,
  ALLCHAR_INFO_REQ: 0x0C,
  GAMESTART: 0x0D,
  REQUEST_USER_IN: 0x16,
  REQUEST_NPC_IN: 0x1D,
  NPC_EVENT: 0x20,
  TARGET_HP: 0x22,
  ZONE_CHANGE: 0x27,
  VERSION_CHECK: 0x2B,
  MAGIC_PROCESS: 0x31,
};

const CHARACTER_SLOT_COUNT = 3;
const CHARACTER_EQUIPMENT = [
  'helmet',
  'upper',
  'cloak',
  'rightHand',
  'leftHand',
  'lower',
  'gloves',
  'shoes',
];

class Reader {
  constructor(buf) {
    this.b = Buffer.from(buf);
    this.o = 0;
  }

  u8() {
    if (this.o + 1 > this.b.length) throw Error('truncated u8');
    return this.b[this.o++];
  }

  u16() {
    if (this.o + 2 > this.b.length) throw Error('truncated u16');
    const value = this.b.readUInt16LE(this.o);
    this.o += 2;
    return value;
  }

  i16() {
    if (this.o + 2 > this.b.length) throw Error('truncated i16');
    const value = this.b.readInt16LE(this.o);
    this.o += 2;
    return value;
  }

  u32() {
    if (this.o + 4 > this.b.length) throw Error('truncated u32');
    const value = this.b.readUInt32LE(this.o);
    this.o += 4;
    return value;
  }

  str16(max = 255) {
    const length = this.i16();
    if (length < 0 || length > max || this.o + length > this.b.length) throw Error('invalid str16');
    const value = this.b.subarray(this.o, this.o + length).toString('latin1');
    this.o += length;
    return value;
  }

  assertEnd() {
    if (this.o !== this.b.length) throw Error(`unexpected trailing bytes: ${this.b.length - this.o}`);
  }
}

class Writer {
  constructor() {
    this.p = [];
  }

  u8(value) {
    this.p.push(Buffer.from([value & 0xff]));
    return this;
  }

  u16(value) {
    const b = Buffer.alloc(2);
    b.writeUInt16LE(value);
    this.p.push(b);
    return this;
  }

  i16(value) {
    const b = Buffer.alloc(2);
    b.writeInt16LE(value);
    this.p.push(b);
    return this;
  }

  u32(value) {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(value >>> 0);
    this.p.push(b);
    return this;
  }

  u64(value) {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(BigInt(value));
    this.p.push(b);
    return this;
  }

  str16(value) {
    const b = Buffer.from(String(value), 'latin1');
    if (b.length > 0x7fff) throw Error('str16 too long');
    this.i16(b.length);
    this.p.push(b);
    return this;
  }

  raw(value) {
    this.p.push(Buffer.from(value));
    return this;
  }

  done() {
    return Buffer.concat(this.p);
  }
}

function frame(payload) {
  const p = Buffer.from(payload);
  const length = Buffer.alloc(2);
  length.writeUInt16LE(p.length);
  return Buffer.concat([FRAME_HEAD, length, p, FRAME_TAIL]);
}

class FrameDecoder {
  constructor(max = 8192) {
    this.pending = Buffer.alloc(0);
    this.max = max;
  }

  push(chunk) {
    this.pending = Buffer.concat([this.pending, Buffer.from(chunk)]);
    const out = [];
    for (;;) {
      if (this.pending.length < 6) break;
      if (this.pending[0] !== 0xaa || this.pending[1] !== 0x55) throw Error('bad frame header');
      const length = this.pending.readUInt16LE(2);
      if (length < 1 || length > this.max) throw Error('bad frame length');
      const total = length + 6;
      if (this.pending.length < total) break;
      if (this.pending[length + 4] !== 0x55 || this.pending[length + 5] !== 0xaa) throw Error('bad frame tail');
      out.push(this.pending.subarray(4, 4 + length));
      this.pending = this.pending.subarray(total);
    }
    return out;
  }
}

function parseCredentials(payload, opcode) {
  const r = new Reader(payload);
  if (r.u8() !== opcode) throw Error('opcode mismatch');
  const result = { username: r.str16(20), password: r.str16(12) };
  r.assertEnd();
  return result;
}

function parseCharacterCreate(payload) {
  const r = new Reader(payload);
  if (r.u8() !== GAME.NEW_CHAR) throw Error('opcode mismatch');
  const result = {
    slot: r.u8(),
    name: r.str16(20),
    race: r.u8(),
    classId: r.i16(),
    face: r.u8(),
    hair: r.u8(),
    str: r.u8(),
    sta: r.u8(),
    dex: r.u8(),
    intel: r.u8(),
    magicAttack: r.u8(),
  };
  r.assertEnd();
  return result;
}

function parseCharacterSelect(payload) {
  const r = new Reader(payload);
  if (r.u8() !== GAME.SEL_CHAR) throw Error('opcode mismatch');
  const result = {
    accountId: r.str16(20),
    characterId: r.str16(20),
    zoneInit: r.u8(),
    zoneCurrent: r.u8(),
  };
  r.assertEnd();
  return result;
}

function buildCharacterList(slots) {
  const normalized = Array.from({ length: CHARACTER_SLOT_COUNT }, (_, index) => slots?.[index] || null);
  const w = new Writer().u8(GAME.ALLCHAR_INFO_REQ).u8(1);
  for (const character of normalized) writeCharacterRecord(w, character);
  return w.done();
}

function writeCharacterRecord(w, character) {
  if (!character) {
    w.raw(Buffer.alloc(57));
    return;
  }

  w.str16(character.characterId || character.name || '')
    .u8(character.race || 0)
    .i16(character.classId || 0)
    .u8(character.level || 0)
    .u8(character.face || 0)
    .u8(character.hair || 0)
    .u8(character.zone || 0);

  for (const key of CHARACTER_EQUIPMENT) {
    const item = character.equipment?.[key] || {};
    w.u32(item.itemId || 0).i16(item.durability || 0);
  }
}

module.exports = {
  LOGIN,
  GAME,
  CHARACTER_SLOT_COUNT,
  CHARACTER_EQUIPMENT,
  Reader,
  Writer,
  frame,
  FrameDecoder,
  parseCredentials,
  parseCharacterCreate,
  parseCharacterSelect,
  buildCharacterList,
};
