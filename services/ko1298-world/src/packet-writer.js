'use strict';

class PacketWriter {
  constructor() {
    this.parts = [];
  }

  u8(value) {
    assertIntegerRange(value, 0, 0xff, 'u8');
    const b = Buffer.allocUnsafe(1);
    b.writeUInt8(value, 0);
    this.parts.push(b);
    return this;
  }

  u16(value) {
    assertIntegerRange(value, 0, 0xffff, 'u16');
    const b = Buffer.allocUnsafe(2);
    b.writeUInt16LE(value, 0);
    this.parts.push(b);
    return this;
  }

  i16(value) {
    assertIntegerRange(value, -0x8000, 0x7fff, 'i16');
    const b = Buffer.allocUnsafe(2);
    b.writeInt16LE(value, 0);
    this.parts.push(b);
    return this;
  }

  u32(value) {
    assertIntegerRange(value, 0, 0xffffffff, 'u32');
    const b = Buffer.allocUnsafe(4);
    b.writeUInt32LE(value, 0);
    this.parts.push(b);
    return this;
  }

  i64(value) {
    const v = typeof value === 'bigint' ? value : BigInt(value);
    if (v < -(1n << 63n) || v > ((1n << 63n) - 1n)) {
      throw new RangeError(`i64 out of range: ${String(value)}`);
    }
    const b = Buffer.allocUnsafe(8);
    b.writeBigInt64LE(v, 0);
    this.parts.push(b);
    return this;
  }

  bytes(value) {
    this.parts.push(Buffer.from(value));
    return this;
  }

  string(value) {
    this.parts.push(Buffer.from(String(value), 'latin1'));
    return this;
  }

  toBuffer() {
    return Buffer.concat(this.parts);
  }
}

function assertIntegerRange(value, min, max, label) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${label} out of range: ${String(value)}`);
  }
}

module.exports = { PacketWriter, assertIntegerRange };
