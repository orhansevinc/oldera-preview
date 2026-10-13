#!/usr/bin/env node
import fs from 'node:fs';
import net from 'node:net';

const host = process.env.KO_PROBE_HOST || '127.0.0.1';
const port = Number(process.env.KO_PROBE_PORT || 16100);
const out = process.env.KO_PROBE_RESULT || 'gateway-probe-result.txt';

const expected = Buffer.from([0xaa, 0x55, 0x01, 0x00, 0xf5, 0x55, 0xaa]);
let aggregate = Buffer.alloc(0);
let proved = false;

const writeResult = (text) => {
  fs.writeFileSync(out, text + '\n');
  console.log(text);
};

const server = net.createServer((socket) => {
  console.log(`[probe] tcp client ${socket.remoteAddress || 'unknown'}:${socket.remotePort || 0}`);
  socket.on('data', (chunk) => {
    aggregate = Buffer.concat([aggregate, chunk]);
    console.log(`[probe] received bytes=${chunk.length} total=${aggregate.length} hex=${chunk.toString('hex')}`);
    if (!proved && aggregate.indexOf(expected) !== -1) {
      proved = true;
      writeResult(`KO_FRAME_OK opcode=0xf5 bytes=${expected.length} hex=${expected.toString('hex')}`);
    }
  });
  socket.on('error', (err) => console.error(`[probe] socket error ${err.message}`));
});

server.on('error', (err) => {
  writeResult(`KO_FRAME_FAIL server-error=${err.message}`);
  process.exit(1);
});

server.listen(port, host, () => {
  console.log(`[probe] listening tcp://${host}:${port}`);
});

const shutdown = () => server.close(() => process.exit(proved ? 0 : 1));
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
