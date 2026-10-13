const fs = require('fs');
const { chromium } = require('playwright-core');
const { PNG } = require('pngjs');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME,
    args: [
      '--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'
    ]
  });

  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const runtimeLines = [];
  page.on('console', m => {
    const text = m.text();
    runtimeLines.push(text);
    console.log(`[console:${m.type()}] ${text}`);
  });
  page.on('pageerror', e => console.log(`[pageerror] ${e.stack}`));

  const waitForRuntime = async (needle, timeout = 15000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (runtimeLines.some(line => line.includes(needle))) return;
      await page.waitForTimeout(50);
    }
    throw new Error(`Runtime log timeout waiting for: ${needle}`);
  };

  const hasRuntime = needle => runtimeLines.some(line => line.includes(needle));

  const saveStatus = async () => {
    const status = await page.locator('#status').textContent().catch(() => '');
    const merged = `${status || ''}\n${runtimeLines.join('\n')}`;
    fs.writeFileSync('ws04-browser-status.txt', merged);
    return merged;
  };

  const pixelStats = (png, region = null) => {
    const x0 = region ? Math.max(0, region.x) : 0;
    const y0 = region ? Math.max(0, region.y) : 0;
    const x1 = region ? Math.min(png.width, region.x + region.width) : png.width;
    const y1 = region ? Math.min(png.height, region.y + region.height) : png.height;
    let nonBlack = 0;
    let total = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * png.width + x) * 4;
        const r = png.data[i], g = png.data[i + 1], b = png.data[i + 2], a = png.data[i + 3];
        total++;
        if (a > 0 && (r > 10 || g > 10 || b > 10)) nonBlack++;
      }
    }
    return { nonBlack, total, ratio: total ? nonBlack / total : 0 };
  };

  const capture = async (name) => {
    const cdp = await page.context().newCDPSession(page);
    const shot = await Promise.race([
      cdp.send('Page.captureScreenshot', {
        format: 'png', fromSurface: true, captureBeyondViewport: false,
        clip: { x: 0, y: 0, width: 1024, height: 768, scale: 1 }
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('CDP screenshot timed out')), 8000))
    ]);
    const buffer = Buffer.from(shot.data, 'base64');
    fs.writeFileSync(`ws04-${name}.png`, buffer);
    return PNG.sync.read(buffer);
  };

  const assertVisual = async (label, fileName) => {
    const framebuffer = await page.evaluate(() => {
      const canvas = document.getElementById('canvas');
      if (!canvas) return { error: 'canvas missing', nonBlack: 0, total: 0, ratio: 0 };
      const gl = canvas.getContext('webgl2');
      if (!gl) return { error: 'webgl2 context missing', nonBlack: 0, total: canvas.width * canvas.height, ratio: 0 };
      gl.finish();
      const pixels = new Uint8Array(canvas.width * canvas.height * 4);
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      const glError = gl.getError();
      let nonBlack = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] > 10 || pixels[i + 1] > 10 || pixels[i + 2] > 10) nonBlack++;
      }
      const total = canvas.width * canvas.height;
      return { glError, nonBlack, total, ratio: total ? nonBlack / total : 0 };
    });

    const png = await capture(fileName);
    const compositor = pixelStats(png);
    const ratio = Math.max(Number(framebuffer.ratio || 0), compositor.ratio);
    const source = compositor.ratio >= Number(framebuffer.ratio || 0) ? 'compositor' : 'framebuffer';
    console.log(`[ws04-driver] ${label} framebuffer=${Number(framebuffer.ratio || 0).toFixed(4)} compositor=${compositor.ratio.toFixed(4)}`);
    if (ratio < 0.01) throw new Error(`${label} is effectively black`);
    console.log(`[ws04-driver] ${label}_VISUAL_OK source=${source} ratio=${ratio.toFixed(4)}`);
    return png;
  };

  const assertModelPreview = async () => {
    const png = await capture('create-ready');
    // The genuine 1298 create UI leaves this rectangle black until a real UPC
    // model is loaded/rendered. Background/UI pixels are deliberately excluded.
    const region = { x: 355, y: 55, width: 320, height: 565 };
    const stats = pixelStats(png, region);
    console.log(`[ws04-driver] CREATE_MODEL region nonBlack=${stats.nonBlack}/${stats.total} ratio=${stats.ratio.toFixed(4)}`);
    if (stats.ratio < 0.002) {
      throw new Error(`real 1298 character model preview is black/missing: ratio=${stats.ratio.toFixed(4)}`);
    }
    console.log(`[ws04-driver] CREATE_MODEL_VISUAL_OK ratio=${stats.ratio.toFixed(4)}`);
  };

  const pressHeld = async (key, ms = 90) => {
    await page.keyboard.down(key);
    await page.waitForTimeout(ms);
    await page.keyboard.up(key);
  };

  try {
    await page.goto('http://127.0.0.1:8000/ws04.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForRuntime("browser server list entry: name='OldERA' ip='127.0.0.1' users=7", 90000);

    await page.locator('#canvas').focus();
    await page.keyboard.type(process.env.TEST_ID, { delay: 20 });
    await pressHeld('Tab');
    await page.keyboard.type(process.env.TEST_PW, { delay: 20 });
    await pressHeld('Enter');

    await waitForRuntime('server list opened (1 server(s) available)', 30000);
    await page.waitForTimeout(300);
    await pressHeld('Enter', 100);
    await waitForRuntime('game server version check answered: version=1298 (client expects 1298)', 30000);
    await waitForRuntime('game server login answered: nation=0', 30000);
    await waitForRuntime('scene change: login -> nation-select', 30000);

    await page.waitForTimeout(800);
    await assertVisual('NATION', 'nation');

    await page.locator('#canvas').focus();
    await page.mouse.click(258, 495, { delay: 100 }); // real El Morad button
    await waitForRuntime('scene change: nation-select -> character-select', 20000);
    await waitForRuntime('WS04_CHAR_LIST parsed result=1 slots=3 occupied=0', 20000);
    await page.waitForTimeout(1000);
    await assertVisual('CHARACTER_SELECT', 'character-select');
    console.log('[ws04-driver] NATION_TO_CHAR_SELECT_OK');
    console.log('[ws04-driver] CHAR_LIST_PARSE_OK slots=3 occupied=0');

    // Genuine Character Select center hitbox; empty slot must route to real create proc.
    await page.locator('#canvas').focus();
    await page.mouse.click(512, 550, { delay: 100 });
    await waitForRuntime('WS04_SLOT_ACTION index=0 occupied=0', 10000);
    await waitForRuntime('scene change: character-select -> character-create', 20000);
    await waitForRuntime('WS04_CHAR_CREATE_UI', 10000);
    await page.waitForTimeout(800);
    await assertVisual('CHARACTER_CREATE', 'character-create');
    console.log('[ws04-driver] EMPTY_SLOT_TO_CREATE_OK');

    // Drive only real 1298 UIF controls: El Moradian Male -> Warrior.
    await page.mouse.click(170, 145, { delay: 100 });
    await page.waitForTimeout(500);
    await page.mouse.click(170, 325, { delay: 100 });
    await page.waitForTimeout(1000);

    // Allocate every available bonus point to STR. Extra clicks are harmless:
    // the real UI ignores them after m_iBonusPoint reaches zero.
    for (let i = 0; i < 50; i++) {
      await page.mouse.click(925, 114);
    }

    const characterName = process.env.CHAR_NAME || `Ws04${Date.now().toString().slice(-8)}`;
    await page.mouse.click(510, 678, { delay: 80 });
    await page.keyboard.press('Control+A');
    await page.keyboard.type(characterName, { delay: 25 });
    await page.waitForTimeout(500);

    await assertModelPreview();

    // Click the genuine Create Character button and require the real client send.
    await page.mouse.click(170, 690, { delay: 100 });
    await waitForRuntime('WS04_CHAR_CREATE_ATTEMPT', 10000);
    await waitForRuntime('WS04_CHAR_CREATE_SENT opcode=0x02', 10000);
    console.log(`[ws04-driver] CHAR_CREATE_PACKET_OK name=${characterName}`);

    // WS04 is client-only. If an integrated 1298 session server is present, keep
    // going and prove list refresh + selection; otherwise leave a precise gate.
    const requireResponse = process.env.WS04_REQUIRE_CREATE_RESPONSE === '1';
    let createResponse = false;
    const responseDeadline = Date.now() + (requireResponse ? 20000 : 2500);
    while (Date.now() < responseDeadline) {
      if (hasRuntime('WS04_CHAR_CREATE_RESPONSE code=0')) { createResponse = true; break; }
      await page.waitForTimeout(100);
    }

    if (createResponse) {
      console.log('[ws04-driver] CHAR_CREATE_RESPONSE_OK');
      await waitForRuntime('scene change: character-create -> character-select', 20000);
      await waitForRuntime('WS04_CHAR_LIST parsed result=1 slots=3 occupied=1', 20000);
      await page.waitForTimeout(1000);
      await assertVisual('CHARACTER_SLOT_REFRESH', 'character-slot-refresh');
      console.log('[ws04-driver] CHAR_CREATE_SLOT_REFRESH_OK');

      await page.locator('#canvas').focus();
      await page.mouse.click(512, 550, { delay: 100 });
      await waitForRuntime('WS04_SLOT_ACTION index=0 occupied=1', 10000);
      await waitForRuntime('WS04_CHAR_SELECT_REQUEST index=0', 10000);
      console.log('[ws04-driver] CHAR_SELECT_PACKET_OK');

      const selectDeadline = Date.now() + 10000;
      while (Date.now() < selectDeadline && !hasRuntime('WS04_CHAR_SELECT_RESPONSE success=1')) {
        await page.waitForTimeout(100);
      }
      if (hasRuntime('WS04_CHAR_SELECT_RESPONSE success=1')) {
        console.log('[ws04-driver] CHAR_SELECT_RESPONSE_OK transition-point-reached');
      } else if (requireResponse) {
        throw new Error('character-select response gate not satisfied');
      }
    } else {
      console.log('[ws04-driver] INTEGRATION_BLOCKED create response 0x02/0x00 not supplied by current base game stub');
      if (requireResponse) throw new Error('character-create response gate not satisfied');
    }

    const finalStatus = await saveStatus();
    if (finalStatus.includes('DFont: no usable font found')) throw new Error('runtime font preload failed');
    if (finalStatus.includes('render backend: Null')) throw new Error('Null renderer fallback detected');
  } catch (err) {
    await saveStatus();
    console.error(`[ws04-driver] failure: ${err.message}`);
    throw err;
  } finally {
    await browser.close();
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});
