'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const crypto = require('node:crypto');
const http = require('node:http');
const { createGateway } = require('../../services/ko-gateway/src/gateway');

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

function baseConfig(targetPort, overrides = {}) {
  return {
    mode: 'auth', listenHost: '127.0.0.1', listenPort: 0, wsPath: '/auth', healthPath: '/healthz',
    targetHost: '127.0.0.1', targetPort, connectTimeoutMs: 500, idleTimeoutMs: 5000,
    pingIntervalMs: 1000, pongTimeoutMs: 500, maxMessageBytes: 4 * 1024 * 1024,
    maxBufferedBytes: 8 * 1024 * 1024, allowedOrigins: ['http://client.test'],
    allowedHosts: [], requireOrigin: true, trustProxy: true, logLevel: 'error', ...overrides
  };
}

async function startTcp(handler = (socket) => socket.pipe(socket)) {
  const server = net.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, port: server.address().port, close: () => new Promise((resolve) => server.close(resolve)) };
}

function clientFrame(payload, opcode = 2) {
  payload = Buffer.from(payload);
  const mask = crypto.randomBytes(4);
  let header;
  if (payload.length < 126) {
    header = Buffer.from([0x80 | opcode, 0x80 | payload.length]);
  } else if (payload.length <= 0xffff) {
    header = Buffer.alloc(4); header[0] = 0x80 | opcode; header[1] = 0x80 | 126; header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10); header[0] = 0x80 | opcode; header[1] = 0x80 | 127; header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  const masked = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i++) masked[i] = payload[i] ^ mask[i & 3];
  return Buffer.concat([header, mask, masked]);
}

function parseServerFrame(buffer) {
  if (buffer.length < 2) return null;
  const opcode = buffer[0] & 0x0f;
  let len = buffer[1] & 0x7f;
  let offset = 2;
  if (len === 126) { if (buffer.length < 4) return null; len = buffer.readUInt16BE(2); offset = 4; }
  else if (len === 127) { if (buffer.length < 10) return null; len = Number(buffer.readBigUInt64BE(2)); offset = 10; }
  if (buffer.length < offset + len) return null;
  return { opcode, payload: buffer.subarray(offset, offset + len), rest: buffer.subarray(offset + len) };
}

async function wsConnect(port, path = '/auth') {
  const socket = net.createConnection({ host: '127.0.0.1', port });
  const key = crypto.randomBytes(16).toString('base64');
  const request = `GET ${path} HTTP/1.1\r\nHost: localhost:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\nOrigin: http://client.test\r\n\r\n`;
  socket.write(request);
  let buffer = Buffer.alloc(0);
  await new Promise((resolve, reject) => {
    const onData = (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const idx = buffer.indexOf('\r\n\r\n');
      if (idx < 0) return;
      const head = buffer.subarray(0, idx + 4).toString();
      buffer = buffer.subarray(idx + 4);
      socket.off('data', onData);
      if (!head.startsWith('HTTP/1.1 101')) reject(new Error(head.split('\r\n')[0])); else resolve();
    };
    socket.on('data', onData);
    socket.once('error', reject);
  });
  return {
    socket,
    async roundtrip(payload) {
      const expectedBytes = payload.length;
      socket.write(clientFrame(payload));
      return new Promise((resolve, reject) => {
        let acc = buffer; buffer = Buffer.alloc(0);
        const binaryChunks = [];
        let binaryBytes = 0;
        const timer = setTimeout(() => reject(new Error('frame timeout')), 3000);
        const finish = () => {
          clearTimeout(timer);
          socket.off('data', onData);
          buffer = acc;
          resolve(Buffer.concat(binaryChunks, binaryBytes));
        };
        const onData = (chunk) => {
          acc = Buffer.concat([acc, chunk]);
          for (;;) {
            const frame = parseServerFrame(acc);
            if (!frame) return;
            acc = frame.rest;
            if (frame.opcode === 9) { socket.write(clientFrame(frame.payload, 10)); continue; }
            if (frame.opcode === 2) {
              binaryChunks.push(Buffer.from(frame.payload));
              binaryBytes += frame.payload.length;
              if (binaryBytes >= expectedBytes) return finish();
            }
          }
        };
        socket.on('data', onData);
        if (acc.length) onData(Buffer.alloc(0));
      });
    },
    close() { socket.destroy(); }
  };
}

async function withGateway(t, targetPort, overrides = {}) {
  const gateway = createGateway(baseConfig(targetPort, overrides), { logger: silentLogger });
  const address = await gateway.listen();
  t.after(async () => { try { await gateway.close(); } catch {} });
  return { gateway, port: address.port };
}

test('health endpoint is available without exposing target details', async (t) => {
  const tcp = await startTcp(); t.after(tcp.close);
  const { port } = await withGateway(t, tcp.port);
  const body = await new Promise((resolve, reject) => http.get(`http://127.0.0.1:${port}/healthz`, (res) => {
    let data = ''; res.on('data', (c) => data += c); res.on('end', () => resolve({ status: res.statusCode, data }));
  }).on('error', reject));
  assert.equal(body.status, 200);
  const parsed = JSON.parse(body.data);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.mode, 'auth');
  assert.equal('targetHost' in parsed, false);
});

test('binary packet roundtrip is byte-identical', async (t) => {
  const tcp = await startTcp(); t.after(tcp.close);
  const { port } = await withGateway(t, tcp.port);
  const ws = await wsConnect(port); t.after(() => ws.close());
  const payload = Buffer.from([0xaa, 0x55, 0x00, 0xff, 0x10, 0x20, 0x30]);
  assert.deepEqual(await ws.roundtrip(payload), payload);
});

test('large binary packet roundtrip is byte-identical', async (t) => {
  const tcp = await startTcp(); t.after(tcp.close);
  const { port } = await withGateway(t, tcp.port, { maxMessageBytes: 2 * 1024 * 1024 });
  const ws = await wsConnect(port); t.after(() => ws.close());
  const payload = crypto.randomBytes(1024 * 1024);
  assert.deepEqual(await ws.roundtrip(payload), payload);
});

test('disconnect then reconnect works', async (t) => {
  const tcp = await startTcp(); t.after(tcp.close);
  const { port } = await withGateway(t, tcp.port);
  const first = await wsConnect(port);
  assert.deepEqual(await first.roundtrip(Buffer.from('one')), Buffer.from('one'));
  first.close();
  const second = await wsConnect(port); t.after(() => second.close());
  assert.deepEqual(await second.roundtrip(Buffer.from('two')), Buffer.from('two'));
});

test('concurrent connections stay isolated', async (t) => {
  const tcp = await startTcp(); t.after(tcp.close);
  const { port } = await withGateway(t, tcp.port);
  const clients = await Promise.all(Array.from({ length: 12 }, () => wsConnect(port)));
  t.after(() => clients.forEach((c) => c.close()));
  const payloads = clients.map((_, i) => Buffer.from(`client-${i}-${'x'.repeat(i * 13)}`));
  const results = await Promise.all(clients.map((c, i) => c.roundtrip(payloads[i])));
  results.forEach((value, i) => assert.deepEqual(value, payloads[i]));
});

test('unavailable TCP target rejects WebSocket upgrade with 502', async (t) => {
  const probe = net.createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const deadPort = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const { port } = await withGateway(t, deadPort, { connectTimeoutMs: 250 });
  await assert.rejects(() => wsConnect(port), /502 Bad Gateway/);
});

test('origin allowlist rejects unexpected browser origin', async (t) => {
  const tcp = await startTcp(); t.after(tcp.close);
  const { port } = await withGateway(t, tcp.port);
  const socket = net.createConnection({ host: '127.0.0.1', port });
  t.after(() => socket.destroy());
  const key = crypto.randomBytes(16).toString('base64');
  socket.write(`GET /auth HTTP/1.1\r\nHost: localhost:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\nOrigin: https://evil.invalid\r\n\r\n`);
  const response = await new Promise((resolve) => socket.once('data', (d) => resolve(d.toString())));
  assert.match(response, /^HTTP\/1\.1 403 Forbidden/);
});
