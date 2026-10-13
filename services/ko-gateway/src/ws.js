'use strict';

const crypto = require('node:crypto');

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function acceptKey(clientKey) {
  return crypto.createHash('sha1').update(clientKey + WS_GUID).digest('base64');
}

function encodeFrame(opcode, payload = Buffer.alloc(0)) {
  if (!Buffer.isBuffer(payload)) payload = Buffer.from(payload);
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.allocUnsafe(2);
    header[1] = len;
  } else if (len <= 0xffff) {
    header = Buffer.allocUnsafe(4);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.allocUnsafe(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  header[0] = 0x80 | (opcode & 0x0f);
  return Buffer.concat([header, payload]);
}

function closePayload(code, reason = '') {
  const text = Buffer.from(reason, 'utf8');
  const out = Buffer.allocUnsafe(2 + Math.min(text.length, 123));
  out.writeUInt16BE(code, 0);
  text.copy(out, 2, 0, out.length - 2);
  return out;
}

class FrameParser {
  constructor({ maxMessageBytes, onBinary, onPing, onPong, onClose, onProtocolError }) {
    this.maxMessageBytes = maxMessageBytes;
    this.onBinary = onBinary;
    this.onPing = onPing;
    this.onPong = onPong;
    this.onClose = onClose;
    this.onProtocolError = onProtocolError;
    this.buffer = Buffer.alloc(0);
    this.fragments = [];
    this.fragmentBytes = 0;
    this.fragmentOpcode = null;
  }

  push(chunk) {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    while (this._parseOne()) {}
  }

  _fail(code, reason) {
    this.buffer = Buffer.alloc(0);
    this.fragments = [];
    this.fragmentBytes = 0;
    this.fragmentOpcode = null;
    this.onProtocolError(code, reason);
    return false;
  }

  _parseOne() {
    if (this.buffer.length < 2) return false;
    const b0 = this.buffer[0];
    const b1 = this.buffer[1];
    const fin = Boolean(b0 & 0x80);
    const rsv = b0 & 0x70;
    const opcode = b0 & 0x0f;
    const masked = Boolean(b1 & 0x80);
    let len = b1 & 0x7f;
    let offset = 2;

    if (rsv) return this._fail(1002, 'RSV bits unsupported');
    if (!masked) return this._fail(1002, 'Client frames must be masked');
    if (len === 126) {
      if (this.buffer.length < 4) return false;
      len = this.buffer.readUInt16BE(2);
      offset = 4;
    } else if (len === 127) {
      if (this.buffer.length < 10) return false;
      const n = this.buffer.readBigUInt64BE(2);
      if (n > BigInt(Number.MAX_SAFE_INTEGER)) return this._fail(1009, 'Frame too large');
      len = Number(n);
      offset = 10;
    }

    const isControl = opcode >= 0x8;
    if (isControl && (!fin || len > 125)) return this._fail(1002, 'Invalid control frame');
    if (len > this.maxMessageBytes && !isControl) return this._fail(1009, 'Message too large');
    if (this.buffer.length < offset + 4 + len) return false;

    const mask = this.buffer.subarray(offset, offset + 4);
    offset += 4;
    const payload = Buffer.from(this.buffer.subarray(offset, offset + len));
    this.buffer = this.buffer.subarray(offset + len);
    for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];

    if (opcode === 0x8) {
      this.onClose(payload);
      return true;
    }
    if (opcode === 0x9) {
      this.onPing(payload);
      return true;
    }
    if (opcode === 0xA) {
      this.onPong(payload);
      return true;
    }
    if (opcode === 0x1) return this._fail(1003, 'Text frames unsupported');
    if (opcode !== 0x0 && opcode !== 0x2) return this._fail(1002, 'Unsupported opcode');

    if (opcode === 0x2) {
      if (this.fragmentOpcode !== null) return this._fail(1002, 'Unexpected data frame');
      if (fin) {
        this.onBinary(payload);
      } else {
        this.fragmentOpcode = 0x2;
        this.fragments = [payload];
        this.fragmentBytes = payload.length;
      }
      return true;
    }

    if (this.fragmentOpcode === null) return this._fail(1002, 'Unexpected continuation');
    this.fragments.push(payload);
    this.fragmentBytes += payload.length;
    if (this.fragmentBytes > this.maxMessageBytes) return this._fail(1009, 'Message too large');
    if (fin) {
      const message = Buffer.concat(this.fragments, this.fragmentBytes);
      this.fragments = [];
      this.fragmentBytes = 0;
      this.fragmentOpcode = null;
      this.onBinary(message);
    }
    return true;
  }
}

module.exports = { acceptKey, encodeFrame, closePayload, FrameParser };
