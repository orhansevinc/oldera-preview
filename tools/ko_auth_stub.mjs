#!/usr/bin/env node
import fs from 'node:fs';
import net from 'node:net';

const host = process.env.KO_STUB_HOST || '127.0.0.1';
const port = Number(process.env.KO_STUB_PORT || 16100);
const resultPath = process.env.KO_AUTH_RESULT || 'ko-auth-result.txt';
const expectedID = process.env.KO_TEST_ID;
const expectedPW = process.env.KO_TEST_PW;

if (!expectedID || !expectedPW) {
  console.error('[auth-stub] KO_TEST_ID and KO_TEST_PW are required at runtime');
  process.exit(2);
}

const u16 = (n) => { const b = Buffer.allocUnsafe(2); b.writeUInt16LE(n & 0xffff, 0); return b; };
const s2 = (s) => { const b = Buffer.from(s, 'latin1'); return Buffer.concat([u16(b.length), b]); };
const frame = (payload) => Buffer.concat([Buffer.from([0xaa,0x55]), u16(payload.length), payload, Buffer.from([0x55,0xaa])]);

const serverList = frame(Buffer.concat([
  Buffer.from([0xf5, 0x01]), s2('127.0.0.1'), s2('OldERA'), u16(7)
]));
const authOK = frame(Buffer.from([0xf3, 0x01, 0xff, 0xff]));

let sawServerList = false;
let sawAuth = false;
let authMatched = false;
let authResponseSent = false;

function parseLogin(payload) {
  let off = 1;
  if (off + 2 > payload.length) return null;
  const idLen = payload.readUInt16LE(off); off += 2;
  if (off + idLen + 2 > payload.length) return null;
  const id = payload.subarray(off, off + idLen).toString('latin1'); off += idLen;
  const pwLen = payload.readUInt16LE(off); off += 2;
  if (off + pwLen > payload.length) return null;
  const pw = payload.subarray(off, off + pwLen).toString('latin1');
  return { id, pw };
}

function mark() {
  const line = `AUTH_CHAIN request=${sawAuth?1:0} matched=${authMatched?1:0} response=${authResponseSent?1:0} id=${expectedID}`;
  fs.writeFileSync(resultPath, line + '\n');
  console.log(`[auth-stub] ${line}`);
}

const server = net.createServer((socket) => {
  let rx = Buffer.alloc(0);
  console.log(`[auth-stub] client ${socket.remoteAddress || 'unknown'}:${socket.remotePort || 0}`);
  socket.on('data', (chunk) => {
    rx = Buffer.concat([rx, chunk]);
    console.log(`[auth-stub] c2s bytes=${chunk.length} hex=${chunk.toString('hex')}`);
    while (rx.length >= 6) {
      const start = rx.indexOf(Buffer.from([0xaa,0x55]));
      if (start < 0) { rx = Buffer.alloc(0); return; }
      if (start > 0) rx = rx.subarray(start);
      if (rx.length < 6) return;
      const len = rx.readUInt16LE(2), total = len + 6;
      if (rx.length < total) return;
      const current = rx.subarray(0, total); rx = rx.subarray(total);
      if (current[total-2] !== 0x55 || current[total-1] !== 0xaa) continue;
      const payload = current.subarray(4, 4 + len);
      const opcode = payload[0];
      console.log(`[auth-stub] opcode=0x${opcode.toString(16).padStart(2,'0')} payload=${payload.toString('hex')}`);
      if (opcode === 0xf5) {
        sawServerList = true;
        socket.write(serverList);
        console.log(`[auth-stub] sent server list ${serverList.toString('hex')}`);
      } else if (opcode === 0xf3) {
        sawAuth = true;
        const parsed = parseLogin(payload);
        if (parsed) {
          authMatched = parsed.id === expectedID && parsed.pw === expectedPW;
          console.log(`[auth-stub] login id='${parsed.id}' pwLen=${parsed.pw.length} matched=${authMatched?1:0}`);
        }
        if (authMatched) {
          socket.write(authOK);
          authResponseSent = true;
          console.log(`[auth-stub] sent AUTH_OK ${authOK.toString('hex')}`);
        }
        mark();
      }
    }
  });
  socket.on('error', (e) => console.error(`[auth-stub] socket error ${e.message}`));
});
server.on('error', (e) => { console.error(`[auth-stub] server error ${e.message}`); process.exit(1); });
server.listen(port, host, () => console.log(`[auth-stub] listening tcp://${host}:${port}`));

const stop = () => server.close(() => process.exit(sawServerList && sawAuth && authMatched && authResponseSent ? 0 : 1));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
