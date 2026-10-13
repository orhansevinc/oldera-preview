#!/usr/bin/env node
import fs from 'node:fs';
import net from 'node:net';

const host = process.env.KO_GAME_STUB_HOST || '127.0.0.1';
const port = Number(process.env.KO_GAME_STUB_PORT || 16101);
const resultPath = process.env.KO_GAME_RESULT || 'ko-game-result.txt';
const expectedID = process.env.KO_TEST_ID;
const expectedPW = process.env.KO_TEST_PW;
const expectedVersion = Number(process.env.KO_EXPECTED_VERSION || 1298);

if (!expectedID || !expectedPW) {
  console.error('[game-stub] KO_TEST_ID and KO_TEST_PW are required at runtime');
  process.exit(2);
}

const u16 = (n) => { const b = Buffer.allocUnsafe(2); b.writeUInt16LE(n & 0xffff, 0); return b; };
const frame = (payload) => Buffer.concat([Buffer.from([0xaa, 0x55]), u16(payload.length), payload, Buffer.from([0x55, 0xaa])]);
const versionOK = frame(Buffer.concat([Buffer.from([0x2b]), u16(expectedVersion)]));
const gameLoginOKNationUnset = frame(Buffer.from([0x01, 0x00]));

let sawVersionRequest = false;
let versionResponseSent = false;
let sawLoginRequest = false;
let loginMatched = false;
let loginResponseSent = false;

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
  const line = `GAME_CHAIN versionReq=${sawVersionRequest ? 1 : 0} versionResp=${versionResponseSent ? 1 : 0} loginReq=${sawLoginRequest ? 1 : 0} matched=${loginMatched ? 1 : 0} loginResp=${loginResponseSent ? 1 : 0} nation=0 version=${expectedVersion}`;
  fs.writeFileSync(resultPath, line + '\n');
  console.log(`[game-stub] ${line}`);
}

const server = net.createServer((socket) => {
  let rx = Buffer.alloc(0);
  console.log(`[game-stub] client ${socket.remoteAddress || 'unknown'}:${socket.remotePort || 0}`);

  socket.on('data', (chunk) => {
    rx = Buffer.concat([rx, chunk]);
    console.log(`[game-stub] c2s bytes=${chunk.length} hex=${chunk.toString('hex')}`);

    while (rx.length >= 6) {
      const start = rx.indexOf(Buffer.from([0xaa, 0x55]));
      if (start < 0) { rx = Buffer.alloc(0); return; }
      if (start > 0) rx = rx.subarray(start);
      if (rx.length < 6) return;

      const len = rx.readUInt16LE(2);
      const total = len + 6;
      if (rx.length < total) return;

      const current = rx.subarray(0, total);
      rx = rx.subarray(total);
      if (current[total - 2] !== 0x55 || current[total - 1] !== 0xaa) continue;

      const payload = current.subarray(4, 4 + len);
      const opcode = payload[0];
      console.log(`[game-stub] opcode=0x${opcode.toString(16).padStart(2, '0')} payload=${payload.toString('hex')}`);

      if (opcode === 0x2b) {
        sawVersionRequest = true;
        socket.write(versionOK);
        versionResponseSent = true;
        console.log(`[game-stub] sent VERSION_OK ${versionOK.toString('hex')}`);
        mark();
      } else if (opcode === 0x01) {
        sawLoginRequest = true;
        const parsed = parseLogin(payload);
        if (parsed) {
          loginMatched = parsed.id === expectedID && parsed.pw === expectedPW;
          console.log(`[game-stub] login id='${parsed.id}' pwLen=${parsed.pw.length} matched=${loginMatched ? 1 : 0}`);
        }
        if (loginMatched) {
          socket.write(gameLoginOKNationUnset);
          loginResponseSent = true;
          console.log(`[game-stub] sent GAME_LOGIN_OK nation=0 ${gameLoginOKNationUnset.toString('hex')}`);
        }
        mark();
      }
    }
  });

  socket.on('error', (e) => console.error(`[game-stub] socket error ${e.message}`));
});

server.on('error', (e) => {
  console.error(`[game-stub] server error ${e.message}`);
  process.exit(1);
});

server.listen(port, host, () => console.log(`[game-stub] listening tcp://${host}:${port}`));

const stop = () => server.close(() => process.exit(
  sawVersionRequest && versionResponseSent && sawLoginRequest && loginMatched && loginResponseSent ? 0 : 1));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
