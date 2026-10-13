#!/usr/bin/env node
import fs from 'node:fs';
import net from 'node:net';

const host = process.env.KO_STUB_HOST || '127.0.0.1';
const port = Number(process.env.KO_STUB_PORT || 16100);
const resultPath = process.env.KO_STUB_RESULT || 'ko-login-stub-result.txt';
const serverIP = process.env.KO_GAME_SERVER_IP || '127.0.0.1';
const serverName = process.env.KO_GAME_SERVER_NAME || 'OldERA';
const users = Number(process.env.KO_GAME_SERVER_USERS || 7);

const writeU16LE = (value) => {
  const b = Buffer.allocUnsafe(2);
  b.writeUInt16LE(value & 0xffff, 0);
  return b;
};

const string2 = (text) => {
  const body = Buffer.from(text, 'latin1');
  return Buffer.concat([writeU16LE(body.length), body]);
};

const koFrame = (payload) => Buffer.concat([
  Buffer.from([0xaa, 0x55]),
  writeU16LE(payload.length),
  payload,
  Buffer.from([0x55, 0xaa]),
]);

const serverListPayload = Buffer.concat([
  Buffer.from([0xf5, 0x01]),
  string2(serverIP),
  string2(serverName),
  writeU16LE(users),
]);
const serverListFrame = koFrame(serverListPayload);

let observedRequest = false;
let sentResponse = false;

const mark = () => {
  const line = `SERVERLIST_ROUNDTRIP_READY request=${observedRequest ? 1 : 0} response=${sentResponse ? 1 : 0} name=${serverName} ip=${serverIP} users=${users}`;
  fs.writeFileSync(resultPath, line + '\n');
  console.log(`[stub] ${line}`);
};

const server = net.createServer((socket) => {
  let rx = Buffer.alloc(0);
  console.log(`[stub] client ${socket.remoteAddress || 'unknown'}:${socket.remotePort || 0}`);

  socket.on('data', (chunk) => {
    rx = Buffer.concat([rx, chunk]);
    console.log(`[stub] c2s bytes=${chunk.length} hex=${chunk.toString('hex')}`);

    while (rx.length >= 6) {
      const start = rx.indexOf(Buffer.from([0xaa, 0x55]));
      if (start < 0) { rx = Buffer.alloc(0); return; }
      if (start > 0) rx = rx.subarray(start);
      if (rx.length < 6) return;
      const payloadLength = rx.readUInt16LE(2);
      const frameLength = payloadLength + 6;
      if (rx.length < frameLength) return;
      const frame = rx.subarray(0, frameLength);
      rx = rx.subarray(frameLength);
      if (frame[frameLength - 2] !== 0x55 || frame[frameLength - 1] !== 0xaa) {
        console.error('[stub] bad KO frame trailer');
        continue;
      }
      const payload = frame.subarray(4, 4 + payloadLength);
      const opcode = payload[0];
      console.log(`[stub] KO opcode=0x${opcode.toString(16).padStart(2, '0')} payload=${payload.toString('hex')}`);
      if (opcode === 0xf5) {
        observedRequest = true;
        socket.write(serverListFrame);
        sentResponse = true;
        console.log(`[stub] s2c server-list bytes=${serverListFrame.length} hex=${serverListFrame.toString('hex')}`);
        mark();
      }
    }
  });

  socket.on('error', (err) => console.error(`[stub] socket error ${err.message}`));
});

server.on('error', (err) => {
  console.error(`[stub] server error ${err.message}`);
  process.exit(1);
});
server.listen(port, host, () => console.log(`[stub] listening tcp://${host}:${port}`));

const shutdown = () => server.close(() => process.exit(observedRequest && sentResponse ? 0 : 1));
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
