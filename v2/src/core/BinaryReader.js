export class BinaryReader {
  constructor(input) {
    if (input instanceof ArrayBuffer) {
      this.bytes = new Uint8Array(input);
    } else if (ArrayBuffer.isView(input)) {
      this.bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    } else {
      throw new TypeError('BinaryReader expects an ArrayBuffer or typed-array view');
    }

    this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
    this.offset = 0;
  }

  get length() {
    return this.bytes.byteLength;
  }

  get remaining() {
    return this.length - this.offset;
  }

  ensure(size, label = 'read') {
    if (!Number.isInteger(size) || size < 0) {
      throw new RangeError(`Invalid ${label} size: ${size}`);
    }
    if (this.offset + size > this.length) {
      throw new RangeError(`${label} exceeds buffer: need ${size} bytes at ${this.offset}, only ${this.remaining} remain`);
    }
  }

  readInt32() {
    this.ensure(4, 'int32');
    const value = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return value;
  }

  readUint32() {
    this.ensure(4, 'uint32');
    const value = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return value;
  }

  readFloat32() {
    this.ensure(4, 'float32');
    const value = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return value;
  }

  readBytes(length) {
    this.ensure(length, 'byte block');
    const value = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  readByteString(length) {
    const bytes = this.readBytes(length);
    let value = '';
    for (let i = 0; i < bytes.length; i += 1) value += String.fromCharCode(bytes[i]);
    return value;
  }
}
