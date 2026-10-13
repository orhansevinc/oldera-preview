import { startWebSocketFixture } from '../../reliability/fixtures/ws-echo.mjs';
import { printResult } from '../../reliability/lib/guardrails.mjs';

if (typeof WebSocket === 'undefined') throw new Error('Node 22+ global WebSocket is required');
const fixture = await startWebSocketFixture();
let failed = false;

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => { ws.close(); reject(new Error('open timeout')); }, 3000);
    ws.binaryType = 'arraybuffer';
    ws.addEventListener('open', () => { clearTimeout(timer); resolve(ws); }, { once: true });
    ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('websocket error')); }, { once: true });
  });
}
function once(ws, type, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${type} timeout`)), timeout);
    ws.addEventListener(type, ev => { clearTimeout(timer); resolve(ev); }, { once: true });
  });
}

try {
  const clients = await Promise.all(Array.from({ length: 40 }, () => connect(fixture.url)));
  await Promise.all(clients.map(async (ws, i) => {
    ws.send(new Uint8Array([i & 0xff, 0x12, 0x98]));
    const msg = await once(ws, 'message');
    if (!(msg.data instanceof ArrayBuffer) || msg.data.byteLength !== 3) throw new Error('echo mismatch');
    ws.close();
  }));
  printResult('concurrent WebSocket harness', true, '40 simultaneous handshakes and binary echoes');

  for (let batch = 0; batch < 4; batch++) {
    const reconnections = await Promise.all(Array.from({ length: 25 }, () => connect(fixture.url)));
    for (const ws of reconnections) ws.close();
  }
  printResult('reconnect storm harness', true, '100 reconnects');

  const malformed = await connect(fixture.url);
  malformed.send(new Uint8Array([0xff, 0x00, 0x00, 0x7f, 0xde, 0xad, 0xbe, 0xef]));
  const malformedEcho = await once(malformed, 'message');
  const malformedOk = malformedEcho.data instanceof ArrayBuffer && malformedEcho.data.byteLength === 8;
  printResult('malformed packet transport harness', malformedOk, 'opaque binary survives transport fixture');
  if (!malformedOk) failed = true;
  malformed.close();

  const oversized = await connect(fixture.url);
  const closed = once(oversized, 'close', 4000);
  oversized.send(new Uint8Array(96 * 1024));
  const closeEvent = await closed;
  const oversizeOk = closeEvent.code === 1009;
  printResult('oversized packet harness', oversizeOk, `closeCode=${closeEvent.code}`);
  if (!oversizeOk) failed = true;

  const pressure = await connect(fixture.url);
  let maxBuffered = 0;
  for (let i = 0; i < 64; i++) {
    pressure.send(new Uint8Array(16 * 1024));
    maxBuffered = Math.max(maxBuffered, pressure.bufferedAmount);
  }
  await new Promise(resolve => setTimeout(resolve, 250));
  const pressureOk = pressure.readyState === WebSocket.OPEN;
  printResult('backpressure harness', pressureOk, `maxClientBufferedAmount=${maxBuffered}`);
  if (!pressureOk) failed = true;
  pressure.close();
} catch (error) {
  printResult('WebSocket harness self-test', false, error.stack || error.message);
  failed = true;
} finally {
  await fixture.close();
}
process.exitCode = failed ? 1 : 0;
