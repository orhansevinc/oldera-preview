import { assertLocalTarget, printResult } from '../../reliability/lib/guardrails.mjs';

const raw = process.env.WS20_WS_TARGET;
if (!raw) {
  console.log('[SKIP] WS20_WS_TARGET is not configured; product WebSocket stress requires WS02/WS03 integration target.');
  process.exit(0);
}
const url = assertLocalTarget(raw, 'WebSocket target');
const healthRaw = process.env.WS20_WS_HEALTH_URL;
if (healthRaw) assertLocalTarget(healthRaw, 'WebSocket health target');
const count = Number(process.env.WS20_WS_CONNECTIONS || 50);
let errors = 0;

function openOne(i) {
  return new Promise(resolve => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => { errors++; try { ws.close(); } catch {} resolve(); }, 5000);
    ws.binaryType = 'arraybuffer';
    ws.addEventListener('open', () => {
      ws.send(new Uint8Array([0xff, i & 0xff, 0x12, 0x98]));
      setTimeout(() => { try { ws.close(); } catch {} }, 40);
    }, { once: true });
    ws.addEventListener('close', () => { clearTimeout(timer); resolve(); }, { once: true });
    ws.addEventListener('error', () => { clearTimeout(timer); errors++; resolve(); }, { once: true });
  });
}

await Promise.all(Array.from({ length: count }, (_, i) => openOne(i)));
let healthOk = true;
if (healthRaw) {
  try { const r = await fetch(healthRaw, { signal: AbortSignal.timeout(3000) }); healthOk = r.ok; }
  catch { healthOk = false; }
}
const ok = errors === 0 && healthOk;
printResult('product WebSocket concurrent/malformed probe', ok, `connections=${count} errors=${errors} healthOk=${healthOk}`);
process.exitCode = ok ? 0 : 1;
