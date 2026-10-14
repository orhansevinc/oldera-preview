#!/usr/bin/env node
import crypto from 'node:crypto';
import tls from 'node:tls';

const input = process.argv[2] || 'https://play.oldkoweb.com';
const url = new URL(input);
if (url.protocol !== 'https:') {
  console.error('usage: ko-auth-roundtrip-smoke.mjs https://play.oldkoweb.com');
  process.exit(2);
}

const origin = url.origin;
const hostname = url.hostname;
const port = Number(url.port || 443);
const hostHeader = url.port ? url.host : hostname;
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function makeKoFrame(payload) {
  const body = Buffer.from(payload);
  const len = Buffer.alloc(2);
  len.writeUInt16LE(body.length);
  return Buffer.concat([Buffer.from([0xaa, 0x55]), len, body, Buffer.from([0x55, 0xaa])]);
}

function parseKoFrame(frame) {
  if (frame.length < 7) throw new Error(`KO frame too short: ${frame.length}`);
  if (frame[0] !== 0xaa || frame[1] !== 0x55) throw new Error('KO frame header mismatch');
  const length = frame.readUInt16LE(2);
  const total = length + 6;
  if (frame.length !== total) throw new Error(`KO frame length mismatch: frame=${frame.length} declared=${length}`);
  if (frame[total - 2] !== 0x55 || frame[total - 1] !== 0xaa) throw new Error('KO frame tail mismatch');
  return frame.subarray(4, 4 + length);
}

function maskedClientFrame(opcode, payload) {
  const data = Buffer.from(payload);
  let header;
  if (data.length < 126) {
    header = Buffer.from([0x80 | opcode, 0x80 | data.length]);
  } else if (data.length <= 0xffff) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(data.length, 2);
  } else {
    throw new Error('smoke payload unexpectedly large');
  }
  const mask = crypto.randomBytes(4);
  const masked = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i += 1) masked[i] = data[i] ^ mask[i % 4];
  return Buffer.concat([header, mask, masked]);
}

function consumeServerFrame(buffer) {
  if (buffer.length < 2) return null;
  const first = buffer[0];
  const second = buffer[1];
  const fin = Boolean(first & 0x80);
  const opcode = first & 0x0f;
  const masked = Boolean(second & 0x80);
  if (!fin) throw new Error('fragmented WebSocket frame is unsupported by smoke');
  if (masked) throw new Error('server WebSocket frame must not be masked');

  let length = second & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < 4) return null;
    length = buffer.readUInt16BE(2);
    offset = 4;
  } else if (length === 127) {
    if (buffer.length < 10) return null;
    const n = buffer.readBigUInt64BE(2);
    if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('WebSocket frame too large');
    length = Number(n);
    offset = 10;
  }
  if (buffer.length < offset + length) return null;
  return {
    opcode,
    payload: buffer.subarray(offset, offset + length),
    rest: buffer.subarray(offset + length),
  };
}

function connectWebSocket(path, onOpen) {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString('base64');
    const expectedAccept = crypto
      .createHash('sha1')
      .update(key + WS_GUID)
      .digest('base64');

    const socket = tls.connect({ host: hostname, port, servername: hostname });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`WSS ${path} timed out`));
    }, 15000);

    let handshakeDone = false;
    let pending = Buffer.alloc(0);

    function fail(error) {
      clearTimeout(timer);
      socket.destroy();
      reject(error instanceof Error ? error : new Error(String(error)));
    }

    socket.once('secureConnect', () => {
      socket.write([
        `GET ${path} HTTP/1.1`,
        `Host: ${hostHeader}`,
        'Connection: Upgrade',
        'Upgrade: websocket',
        'Sec-WebSocket-Version: 13',
        `Sec-WebSocket-Key: ${key}`,
        `Origin: ${origin}`,
        '',
        '',
      ].join('\r\n'));
    });

    socket.on('data', chunk => {
      pending = Buffer.concat([pending, Buffer.from(chunk)]);

      if (!handshakeDone) {
        const marker = pending.indexOf(Buffer.from('\r\n\r\n'));
        if (marker < 0) return;
        const head = pending.subarray(0, marker).toString('latin1');
        pending = pending.subarray(marker + 4);
        const lines = head.split('\r\n');
        if (!/^HTTP\/1\.[01] 101\b/.test(lines[0])) return fail(new Error(`WSS ${path} expected 101, got ${lines[0]}`));
        const headers = new Map();
        for (const line of lines.slice(1)) {
          const i = line.indexOf(':');
          if (i > 0) headers.set(line.slice(0, i).trim().toLowerCase(), line.slice(i + 1).trim());
        }
        if (headers.get('sec-websocket-accept') !== expectedAccept) return fail(new Error(`WSS ${path} Sec-WebSocket-Accept mismatch`));
        handshakeDone = true;
        try {
          onOpen(socket);
        } catch (error) {
          return fail(error);
        }
      }

      for (;;) {
        let frame;
        try {
          frame = consumeServerFrame(pending);
        } catch (error) {
          return fail(error);
        }
        if (!frame) return;
        pending = frame.rest;
        if (frame.opcode === 0x9) {
          socket.write(maskedClientFrame(0xA, frame.payload));
          continue;
        }
        clearTimeout(timer);
        socket.end();
        resolve(frame);
        return;
      }
    });

    socket.once('error', fail);
    socket.once('close', () => {
      if (!handshakeDone) fail(new Error(`WSS ${path} closed before upgrade`));
    });
  });
}

function websocketUpgradeOnly(path) {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString('base64');
    const expectedAccept = crypto
      .createHash('sha1')
      .update(key + WS_GUID)
      .digest('base64');
    const socket = tls.connect({ host: hostname, port, servername: hostname });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`WSS ${path} timed out`));
    }, 15000);
    let pending = '';

    socket.setEncoding('latin1');
    socket.once('secureConnect', () => {
      socket.write([
        `GET ${path} HTTP/1.1`,
        `Host: ${hostHeader}`,
        'Connection: Upgrade',
        'Upgrade: websocket',
        'Sec-WebSocket-Version: 13',
        `Sec-WebSocket-Key: ${key}`,
        `Origin: ${origin}`,
        '',
        '',
      ].join('\r\n'));
    });
    socket.on('data', chunk => {
      pending += chunk;
      const marker = pending.indexOf('\r\n\r\n');
      if (marker < 0) return;
      clearTimeout(timer);
      const lines = pending.slice(0, marker).split('\r\n');
      if (!/^HTTP\/1\.[01] 101\b/.test(lines[0])) {
        socket.destroy();
        reject(new Error(`WSS ${path} expected 101, got ${lines[0]}`));
        return;
      }
      const headers = new Map();
      for (const line of lines.slice(1)) {
        const i = line.indexOf(':');
        if (i > 0) headers.set(line.slice(0, i).trim().toLowerCase(), line.slice(i + 1).trim());
      }
      if (headers.get('sec-websocket-accept') !== expectedAccept) {
        socket.destroy();
        reject(new Error(`WSS ${path} Sec-WebSocket-Accept mismatch`));
        return;
      }
      socket.destroy();
      resolve();
    });
    socket.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

// Real, credential-free 1298 auth binary request: WIZ_SERVER_LIST (0xF5).
// This mutates no account and logs no password.
const authFrame = await connectWebSocket('/auth', socket => {
  socket.write(maskedClientFrame(0x2, makeKoFrame(Buffer.from([0xF5]))));
});
if (authFrame.opcode !== 0x2) throw new Error(`AUTH expected binary frame, opcode=${authFrame.opcode}`);
const authPayload = parseKoFrame(authFrame.payload);
if (authPayload[0] !== 0xF5) throw new Error(`AUTH expected WIZ_SERVER_LIST 0xF5, got 0x${authPayload[0]?.toString(16)}`);
if (authPayload[1] !== 1) throw new Error(`AUTH expected exactly one advertised server, got ${authPayload[1]}`);

// GAME is checked as a real TLS/WebSocket upgrade without sending a mutating
// gameplay packet. The live browser/WS10 scenario remains the authoritative
// game-session protocol acceptance gate.
await websocketUpgradeOnly('/game');

console.log('KO production WSS smoke: PASS auth=binary-WIZ_SERVER_LIST(0xF5) game=upgrade-only credentials=none mutations=none');
