'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { PNG } = require('pngjs');

(async () => {
const out = process.env.QA_ARTIFACT_DIR || 'artifacts/moradon';
const url = process.env.WS10_CLIENT_URL || 'http://127.0.0.1:8000/ws10-moradon.html';
const username = process.env.WS10_TEST_ID || 'ws10e2e';
const password = process.env.WS10_TEST_PW || 'ws10pass';
const charName = process.env.WS10_CHAR_NAME || 'Ws10Hero';
const runtimeTimeoutMs = Number(process.env.WS10_RUNTIME_TIMEOUT_MS || 300000);
const worldTimeoutMs = Number(process.env.WS10_WORLD_TIMEOUT_MS || 600000);
const worldHeartbeatMs = Number(process.env.WS10_WORLD_HEARTBEAT_MS || 15000);
fs.mkdirSync(out, { recursive: true });

const lines = [];
const network = [];
let pageCrashed = false;
let pageClosed = false;
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME || undefined,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });

page.on('console', (m) => {
  const text = m.text();
  lines.push(text);
  console.log(`[console:${m.type()}] ${text}`);
});
page.on('pageerror', (e) => {
  const text = `[pageerror] ${e.stack || e.message}`;
  lines.push(text);
  console.error(text);
});
page.on('crash', () => {
  pageCrashed = true;
  const text = '[pagecrash] Chromium renderer crashed';
  lines.push(text);
  console.error(text);
});
page.on('close', () => {
  pageClosed = true;
});
page.on('websocket', (ws) => {
  const rec = { url: ws.url(), sent: 0, received: 0 };
  network.push(rec);
  ws.on('framesent', (f) => { rec.sent += Buffer.byteLength(f.payload || ''); });
  ws.on('framereceived', (f) => { rec.received += Buffer.byteLength(f.payload || ''); });
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const has = (needle) => lines.some((line) => line.includes(needle));
const fatalRendererLine = () => lines.find((line) => /\[pageerror\]|\[pagecrash\]|GL_INVALID_(ENUM|VALUE|OPERATION)|WebGL: INVALID_|WebGL: too many errors|render backend: Null/i.test(line));
const wait = async (needle, timeout = 30000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (has(needle)) return lines.find((line) => line.includes(needle));
    if (pageCrashed || pageClosed) throw new Error(`browser unavailable while waiting for ${needle}`);
    await sleep(75);
  }
  throw new Error(`timeout waiting for ${needle} after ${timeout}ms`);
};
const held = async (key, ms = 90) => {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
};
const heldClick = async (x, y, holdMs = 90, settleMs = 100) => {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.waitForTimeout(holdMs);
  await page.mouse.up();
  await page.waitForTimeout(settleMs);
};

let worldDeadline = 0;
let worldWaitStartedAt = 0;
let nextWorldHeartbeat = 0;
function latestWorldProgress() {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/WS05_GATE|WS04_GL_CAPTURE|WS10_CAPTURE_ARMED|InitZone|loading|preload|resource|terrain|shape|player|%/i.test(lines[i])) {
      return lines[i].replace(/\s+/g, ' ').slice(0, 320);
    }
  }
  return '(no world progress marker yet)';
}
function startWorldWait() {
  worldWaitStartedAt = Date.now();
  worldDeadline = worldWaitStartedAt + worldTimeoutMs;
  nextWorldHeartbeat = worldWaitStartedAt;
  console.log(`[ws10-driver] WS10_WORLD_WAIT_START timeout_ms=${worldTimeoutMs} polling=node-only`);
}
async function waitWorld(needle) {
  if (!worldDeadline) startWorldWait();
  while (Date.now() < worldDeadline) {
    const match = lines.find((line) => line.includes(needle));
    if (match) {
      const elapsed = Date.now() - worldWaitStartedAt;
      console.log(`[ws10-driver] WS10_WORLD_PROGRESS matched='${needle}' elapsed_ms=${elapsed}`);
      return match;
    }
    const fatal = fatalRendererLine();
    if (fatal) throw new Error(`fatal renderer/browser evidence while waiting for ${needle}: ${fatal}`);
    if (pageCrashed || pageClosed) throw new Error(`browser unavailable while waiting for ${needle}`);
    const now = Date.now();
    if (now >= nextWorldHeartbeat) {
      const elapsed = now - worldWaitStartedAt;
      const remaining = Math.max(0, worldDeadline - now);
      console.log(`[ws10-driver] WS10_WORLD_WAIT target='${needle}' elapsed_ms=${elapsed} remaining_ms=${remaining} latest='${latestWorldProgress()}'`);
      nextWorldHeartbeat = now + worldHeartbeatMs;
    }
    // Deliberately poll only in Node. Do not call page.evaluate()/waitForTimeout()
    // while the synchronous WASM world loader owns the browser main thread.
    await sleep(100);
  }
  throw new Error(`world timeout waiting for ${needle} after ${worldTimeoutMs}ms; latest=${latestWorldProgress()}`);
}

function ppmToPng(buffer) {
  let newlines = 0;
  let start = -1;
  for (let i = 0; i < Math.min(buffer.length, 256); i++) {
    if (buffer[i] === 10 && ++newlines === 3) { start = i + 1; break; }
  }
  if (start < 0) throw new Error('invalid native GL PPM header');
  const header = buffer.subarray(0, start).toString('ascii').trim().split(/\s+/);
  const width = Number(header[1]);
  const height = Number(header[2]);
  const rgb = buffer.subarray(start);
  if (header[0] !== 'P6' || header[3] !== '255' || rgb.length !== width * height * 3) throw new Error('invalid native GL PPM payload');
  const png = new PNG({ width, height });
  for (let s = 0, d = 0; s < rgb.length; s += 3, d += 4) {
    png.data[d] = rgb[s];
    png.data[d + 1] = rgb[s + 1];
    png.data[d + 2] = rgb[s + 2];
    png.data[d + 3] = 255;
  }
  return png;
}

const nativeCaptureId = 1010;
async function collectNativeMoradonCapture() {
  const id = nativeCaptureId;
  await waitWorld(`WS04_GL_CAPTURE id=${id} ok=1 source=present`);
  const ready = await page.evaluate(() => globalThis.WS04_CAPTURE_READY || 0);
  if (ready !== id) throw new Error(`native GL capture not ready: ${ready}`);
  const b64 = await page.evaluate((requestId) => {
    const bytes = Module.FS.readFile(`/ws04-frame-${requestId}.ppm`);
    let binary = '';
    for (let off = 0; off < bytes.length; off += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(off, Math.min(off + 0x8000, bytes.length)));
    }
    return btoa(binary);
  }, id);
  const png = ppmToPng(Buffer.from(b64, 'base64'));
  let nonBlack = 0;
  const total = png.width * png.height;
  for (let i = 0; i < png.data.length; i += 4) {
    if (png.data[i + 3] && (png.data[i] > 10 || png.data[i + 1] > 10 || png.data[i + 2] > 10)) nonBlack++;
  }
  const ratio = total ? nonBlack / total : 0;
  fs.writeFileSync(path.join(out, 'moradon-native.png'), PNG.sync.write(png));
  console.log(`[ws10-driver] WS10_NATIVE_GL nonBlack=${nonBlack}/${total} ratio=${ratio.toFixed(4)}`);
  if (ratio < 0.02) throw new Error(`native Moradon framebuffer effectively black ratio=${ratio.toFixed(4)}`);
  console.log(`[ws10-driver] WS05_MORADON_VISUAL_OK source=pre-swap-gl ratio=${ratio.toFixed(4)}`);
  return { width: png.width, height: png.height, nonBlack, total, ratio };
}

let result = { status: 'FAIL' };
try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await wait('WASM_RUNTIME_READY', runtimeTimeoutMs);
  await wait('render backend: OpenGL', 30000);

  await page.locator('#canvas').focus();
  await page.keyboard.type(username, { delay: 20 });
  await held('Tab');
  await page.keyboard.type(password, { delay: 20 });
  await held('Enter');

  await wait('server list opened', 45000);
  await held('Enter', 100);
  await wait('game server version check answered: version=1298', 45000);
  await wait('game server login answered: nation=0', 45000);
  await wait('scene change: login -> nation-select', 30000);

  await page.mouse.click(258, 495, { delay: 100 });
  await wait('scene change: nation-select -> character-select', 30000);
  await wait('WS04_CHAR_LIST parsed result=1 slots=3 occupied=0', 30000);

  await page.locator('#canvas').focus();
  await held('Enter', 100);
  await wait('scene change: character-select -> character-create', 30000);
  await wait('WS04_CHAR_CREATE_UI', 15000);

  await page.mouse.click(170, 145, { delay: 100 });
  await page.waitForTimeout(500);
  await page.mouse.click(170, 325, { delay: 100 });
  await page.waitForTimeout(1200);

  for (let i = 0; i < 12; i++) await heldClick(925, 114, 90, 110);

  await page.mouse.click(510, 678, { delay: 80 });
  await page.keyboard.press('Control+A');
  await page.keyboard.type(charName, { delay: 25 });
  await page.waitForTimeout(500);
  await page.mouse.click(170, 690, { delay: 100 });

  await wait('WS04_CHAR_CREATE_SENT opcode=0x02', 15000);
  await wait('WS04_CHAR_CREATE_RESPONSE code=0', 30000);
  await wait('scene change: character-create -> character-select', 30000);
  await wait('WS04_CHAR_LIST parsed result=1 slots=3 occupied=1', 30000);

  await page.locator('#canvas').focus();
  await held('Enter', 100);
  await wait('WS04_CHAR_SELECT_REQUEST index=0', 15000);
  await wait('WS04_CHAR_SELECT_RESPONSE success=1', 30000);

  // The selected-character transition begins the one shared world-load deadline.
  // All waits below are Node-only so the genuine synchronous WASM loader is never
  // interrupted by Playwright evaluate/poll calls.
  startWorldWait();
  await waitWorld('WS05_GATE event=moradon-zone-begin zone=21');
  await waitWorld('WS05_GATE event=moradon-assets-loaded zone=21');
  await waitWorld(`WS10_CAPTURE_ARMED id=${nativeCaptureId} trigger=moradon-assets-loaded mode=present-only`);
  await waitWorld('WS05_GATE event=moradon-terrain-rendered zone=21');
  await waitWorld('WS05_GATE event=moradon-shapes-rendered zone=21');
  await waitWorld('WS05_GATE event=moradon-local-player-rendered zone=21');

  const nativeFrame = await collectNativeMoradonCapture();
  const fatal = lines.filter((line) => /\[pageerror\]|\[pagecrash\]|GL_INVALID_(ENUM|VALUE|OPERATION)|WebGL: INVALID_|WebGL: too many errors|render backend: Null/i.test(line));
  if (fatal.length) throw new Error(`fatal renderer/browser evidence: ${fatal.slice(0, 5).join(' | ')}`);

  result = {
    status: 'PASS',
    username,
    charName,
    version: 1298,
    zone: 21,
    nativeZone: 210,
    worldTimeoutMs,
    nativeFrame,
    requiredMarkers: [
      'WS04_CHAR_CREATE_SENT opcode=0x02',
      'WS04_CHAR_CREATE_RESPONSE code=0',
      'WS04_CHAR_LIST parsed result=1 slots=3 occupied=1',
      'WS04_CHAR_SELECT_REQUEST index=0',
      'WS04_CHAR_SELECT_RESPONSE success=1',
      'WS05_GATE event=moradon-zone-begin zone=21',
      'WS05_GATE event=moradon-assets-loaded zone=21',
      `WS10_CAPTURE_ARMED id=${nativeCaptureId} trigger=moradon-assets-loaded mode=present-only`,
      'WS05_GATE event=moradon-terrain-rendered zone=21',
      'WS05_GATE event=moradon-shapes-rendered zone=21',
      'WS05_GATE event=moradon-local-player-rendered zone=21',
      `WS04_GL_CAPTURE id=${nativeCaptureId} ok=1 source=present`,
      'WS05_MORADON_VISUAL_OK source=pre-swap-gl',
    ],
  };
  console.log('WS10_MORADON_E2E_PASS');
} catch (error) {
  result = { status: 'FAIL', error: error.message, latestWorldProgress: latestWorldProgress() };
  console.error(`[ws10-driver] failure: ${error.stack || error.message}`);
  process.exitCode = 1;
} finally {
  fs.writeFileSync(path.join(out, 'browser-console.log'), lines.join('\n') + '\n');
  fs.writeFileSync(path.join(out, 'network.json'), JSON.stringify(network, null, 2) + '\n');
  fs.writeFileSync(path.join(out, 'browser-result.json'), JSON.stringify(result, null, 2) + '\n');
  if (!pageClosed) await page.screenshot({ path: path.join(out, 'final-compositor.png') }).catch(() => {});
  await browser.close();
}
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
