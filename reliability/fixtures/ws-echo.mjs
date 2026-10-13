import http from 'node:http';
import crypto from 'node:crypto';

function serverFrame(opcode, payload = Buffer.alloc(0)) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  let header;
  if (data.length < 126) header = Buffer.from([0x80 | opcode, data.length]);
  else if (data.length <= 0xffff) {
    header = Buffer.alloc(4); header[0] = 0x80 | opcode; header[1] = 126; header.writeUInt16BE(data.length, 2);
  } else {
    header = Buffer.alloc(10); header[0] = 0x80 | opcode; header[1] = 127; header.writeBigUInt64BE(BigInt(data.length), 2);
  }
  return Buffer.concat([header, data]);
}

function closeFrame(code) {
  const p = Buffer.alloc(2); p.writeUInt16BE(code, 0); return serverFrame(0x8, p);
}

export async function startWebSocketFixture({ host = '127.0.0.1', port = 0, maxPayload = 64 * 1024 } = {}) {
  const server = http.createServer((_req, res) => { res.statusCode = 426; res.end('upgrade required'); });
  const sockets = new Set();
  server.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    if (!key) return socket.destroy();
    const accept = crypto.createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    sockets.add(socket);
    let ended = false;
    socket.on('close', () => { ended = true; sockets.delete(socket); });
    socket.on('end', () => { ended = true; });
    socket.on('error', () => { ended = true; });
    let buffer = Buffer.alloc(0);
    socket.on('data', chunk => {
      if (ended) return;
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 2) {
        const b0 = buffer[0], b1 = buffer[1];
        const opcode = b0 & 0x0f;
        const masked = Boolean(b1 & 0x80);
        let len = b1 & 0x7f, offset = 2;
        if (len === 126) { if (buffer.length < 4) return; len = buffer.readUInt16BE(2); offset = 4; }
        else if (len === 127) { if (buffer.length < 10) return; const n = buffer.readBigUInt64BE(2); if (n > BigInt(Number.MAX_SAFE_INTEGER)) return socket.destroy(); len = Number(n); offset = 10; }
        const maskBytes = masked ? 4 : 0;
        if (buffer.length < offset + maskBytes + len) return;
        if (len > maxPayload) { ended = true; socket.end(closeFrame(1009)); buffer = Buffer.alloc(0); return; }
        let payload = buffer.subarray(offset + maskBytes, offset + maskBytes + len);
        if (masked) {
          const mask = buffer.subarray(offset, offset + 4);
          payload = Buffer.from(payload);
          for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
        }
        buffer = buffer.subarray(offset + maskBytes + len);
        if (opcode === 0x8) { ended = true; socket.end(closeFrame(1000)); return; }
        if (ended || socket.destroyed || !socket.writable) return;
        if (opcode === 0x9) socket.write(serverFrame(0xA, payload));
        else if (opcode === 0x1 || opcode === 0x2) socket.write(serverFrame(opcode, payload));
      }
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  const address = server.address();
  return {
    url: `ws://${host}:${address.port}`,
    close: async () => {
      for (const s of sockets) s.destroy();
      await new Promise(resolve => server.close(resolve));
    }
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const fixture = await startWebSocketFixture({ port: Number(process.env.PORT || 8794) });
  console.log(fixture.url);
}
