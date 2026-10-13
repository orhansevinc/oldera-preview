const fs = require('fs');
const { chromium } = require('playwright-core');
const { PNG } = require('pngjs');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader', '--enable-webgl', '--ignore-gpu-blocklist']
  });
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const lines = [];
  page.on('console', m => { const t = m.text(); lines.push(t); console.log(`[console:${m.type()}] ${t}`); });
  page.on('pageerror', e => console.log(`[pageerror] ${e.stack}`));

  const has = needle => lines.some(line => line.includes(needle));
  const wait = async (needle, timeout = 30000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (has(needle)) return;
      await page.waitForTimeout(75);
    }
    throw new Error(`timeout waiting for ${needle}`);
  };
  const pressHeld = async (key, ms = 90) => {
    await page.keyboard.down(key); await page.waitForTimeout(ms); await page.keyboard.up(key);
  };
  const saveStatus = async () => {
    const status = await page.locator('#status').textContent().catch(() => '');
    fs.writeFileSync('ws05-browser-status.txt', `${status || ''}\n${lines.join('\n')}`);
  };

  const ppmToPng = buffer => {
    let n = 0, start = -1;
    for (let i = 0; i < Math.min(buffer.length, 256); i++) {
      if (buffer[i] === 10 && ++n === 3) { start = i + 1; break; }
    }
    if (start < 0) throw new Error('invalid PPM header');
    const h = buffer.subarray(0, start).toString('ascii').trim().split(/\s+/);
    const width = Number(h[1]), height = Number(h[2]);
    const rgb = buffer.subarray(start);
    if (h[0] !== 'P6' || h[3] !== '255' || rgb.length !== width * height * 3)
      throw new Error('invalid PPM payload');
    const png = new PNG({ width, height });
    for (let s = 0, d = 0; s < rgb.length; s += 3, d += 4) {
      png.data[d] = rgb[s]; png.data[d + 1] = rgb[s + 1]; png.data[d + 2] = rgb[s + 2]; png.data[d + 3] = 255;
    }
    return png;
  };

  const captureNativeFrame = async () => {
    const id = 505;
    await page.evaluate(requestId => {
      globalThis.WS04_CAPTURE_READY = 0;
      globalThis.WS04_CAPTURE_REQUEST = requestId;
    }, id);
    await wait(`WS04_GL_CAPTURE id=${id} ok=1`, 60000);
    const ready = await page.evaluate(() => globalThis.WS04_CAPTURE_READY || 0);
    if (ready !== id) throw new Error(`native capture failed ready=${ready}`);
    const b64 = await page.evaluate(requestId => {
      const bytes = Module.FS.readFile(`/ws04-frame-${requestId}.ppm`);
      let binary = '';
      for (let off = 0; off < bytes.length; off += 0x8000)
        binary += String.fromCharCode(...bytes.subarray(off, Math.min(off + 0x8000, bytes.length)));
      return btoa(binary);
    }, id);
    const png = ppmToPng(Buffer.from(b64, 'base64'));
    fs.writeFileSync('ws05-moradon.png', PNG.sync.write(png));
    let nonBlack = 0, total = png.width * png.height;
    for (let i = 0; i < png.data.length; i += 4)
      if (png.data[i + 3] && (png.data[i] > 10 || png.data[i + 1] > 10 || png.data[i + 2] > 10)) nonBlack++;
    const ratio = total ? nonBlack / total : 0;
    console.log(`[ws05-driver] native Moradon frame nonBlack=${nonBlack}/${total} ratio=${ratio.toFixed(4)}`);
    if (ratio < 0.02) throw new Error(`Moradon native GL frame effectively black ratio=${ratio.toFixed(4)}`);
    console.log(`[ws05-driver] WS05_MORADON_VISUAL_OK source=pre-swap-gl ratio=${ratio.toFixed(4)}`);
  };

  try {
    await page.goto('http://127.0.0.1:8000/ws05.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await wait('WASM_RUNTIME_READY', 90000);
    await page.locator('#canvas').focus();
    await page.keyboard.type(process.env.TEST_ID, { delay: 20 });
    await pressHeld('Tab');
    await page.keyboard.type(process.env.TEST_PW, { delay: 20 });
    await pressHeld('Enter');

    await wait('server list opened', 45000);
    await pressHeld('Enter', 100);
    await wait('game server version check answered: version=1298', 45000);

    // The integration account must already own >=1 character. No WS05 code
    // creates or fakes one; character provisioning belongs upstream.
    await wait('WS04_CHAR_LIST parsed result=1 slots=3 occupied=', 60000);
    const listLine = lines.find(line => line.includes('WS04_CHAR_LIST parsed result=1 slots=3 occupied=')) || '';
    const m = listLine.match(/occupied=(\d+).*slot0='([^']*)'/);
    if (!m || Number(m[1]) < 1) throw new Error('integration account has no selectable character');
    if (!m[2]) throw new Error('slot0 must contain the selectable integration character');

    await page.locator('#canvas').focus();
    await pressHeld('Enter', 100);
    await wait('WS04_CHAR_SELECT_REQUEST index=', 15000);
    await wait('WS04_CHAR_SELECT_RESPONSE success=1', 30000);
    await wait('WS05_GATE event=moradon-zone-begin zone=21', 60000);
    await wait('WS05_GATE event=moradon-assets-loaded zone=21', 60000);
    await wait('WS05_GATE event=moradon-terrain-rendered zone=21', 60000);
    await wait('WS05_GATE event=moradon-shapes-rendered zone=21', 60000);
    await wait('WS05_GATE event=moradon-local-player-rendered zone=21', 60000);
    await page.waitForTimeout(1500);
    await captureNativeFrame();
    await saveStatus();
  } catch (err) {
    await saveStatus();
    console.error(`[ws05-driver] failure: ${err.message}`);
    throw err;
  } finally {
    await browser.close();
  }
})().catch(err => { console.error(err); process.exit(1); });
