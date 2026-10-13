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
  let captureSequence = 0;
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

  const ppmToPng = buffer => {
    let newlineCount = 0;
    let dataStart = -1;
    for (let i = 0; i < Math.min(buffer.length, 256); i++) {
      if (buffer[i] === 10 && ++newlineCount === 3) {
        dataStart = i + 1;
        break;
      }
    }
    if (dataStart < 0) throw new Error('invalid PPM header');
    const header = buffer.subarray(0, dataStart).toString('ascii').trim().split(/\s+/);
    if (header.length !== 4 || header[0] !== 'P6' || header[3] !== '255') {
      throw new Error(`unexpected PPM header: ${header.join(' ')}`);
    }
    const width = Number(header[1]);
    const height = Number(header[2]);
    const rgb = buffer.subarray(dataStart);
    if (!Number.isInteger(width) || !Number.isInteger(height) || rgb.length !== width * height * 3) {
      throw new Error(`invalid PPM payload: ${width}x${height}, rgb=${rgb.length}`);
    }
    const png = new PNG({ width, height });
    for (let src = 0, dst = 0; src < rgb.length; src += 3, dst += 4) {
      png.data[dst] = rgb[src];
      png.data[dst + 1] = rgb[src + 1];
      png.data[dst + 2] = rgb[src + 2];
      png.data[dst + 3] = 255;
    }
    return png;
  };

  // Request capture from RHIDeviceGL::Present(). The hook reads the real KO
  // backbuffer immediately before SDL_GL_SwapWindow and writes a PPM into
  // Emscripten MEMFS. SwiftShader can spend ~20s in the synchronous GL readback,
  // which starves page polling; use the native console completion marker instead
  // of a shorter page.waitForFunction timeout that races the render thread.
  const capture = async name => {
    const id = ++captureSequence;
    const path = `/ws04-frame-${id}.ppm`;
    const fsReady = await page.evaluate(() => Boolean(window.Module && Module.FS));
    if (!fsReady) throw new Error('Emscripten Module.FS is not exported');

    await page.evaluate(requestId => {
      globalThis.WS04_CAPTURE_READY = 0;
      globalThis.WS04_CAPTURE_REQUEST = requestId;
    }, id);

    await waitForRuntime(`WS04_GL_CAPTURE id=${id} ok=1`, 45000);

    const ready = await page.evaluate(() => globalThis.WS04_CAPTURE_READY || 0);
    if (ready !== id) throw new Error(`native GL capture failed id=${id} ready=${ready}`);

    const b64 = await page.evaluate(memfsPath => {
      const bytes = Module.FS.readFile(memfsPath);
      let binary = '';
      const chunk = 0x8000;
      for (let offset = 0; offset < bytes.length; offset += chunk) {
        binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunk, bytes.length)));
      }
      return btoa(binary);
    }, path);

    const ppm = Buffer.from(b64, 'base64');
    const png = ppmToPng(ppm);
    fs.writeFileSync(`ws04-${name}.png`, PNG.sync.write(png));
    console.log(`[ws04-driver] native GL screenshot ${name} id=${id} size=${png.width}x${png.height}`);
    return png;
  };

  const assertVisual = async (label, fileName) => {
    const png = await capture(fileName);
    const frame = pixelStats(png);
    console.log(`[ws04-driver] ${label} GL-frame nonBlack=${frame.nonBlack}/${frame.total} ratio=${frame.ratio.toFixed(4)}`);
    if (frame.ratio < 0.01) throw new Error(`${label} real GL frame is effectively black`);
    console.log(`[ws04-driver] ${label}_VISUAL_OK source=pre-swap-gl ratio=${frame.ratio.toFixed(4)}`);
    return png;
  };

  const assertModelPreview = async () => {
    const png = await capture('create-ready');
    // The genuine 1298 create UI leaves the inner preview rectangle black until
    // a real UPC model is loaded/rendered. Stay inside its gold border and away
    // from every text/button/background pixel.
    const region = { x: 360, y: 60, width: 315, height: 565 };
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

    // Nation Select visual/runtime behavior is already covered by the canonical
    // base gate. WS04 starts its own expensive native GL visual proof at the
    // first scene it owns: Character Select.
    await page.waitForTimeout(700);
    await page.locator('#canvas').focus();
    await page.mouse.click(258, 495, { delay: 100 }); // genuine El Morad button
    await waitForRuntime('scene change: nation-select -> character-select', 20000);
    await waitForRuntime('WS04_CHAR_LIST parsed result=1 slots=3 occupied=0', 20000);
    await page.waitForTimeout(1000);
    await assertVisual('CHARACTER_SELECT', 'character-select');
    console.log('[ws04-driver] NATION_TO_CHAR_SELECT_OK');
    console.log('[ws04-driver] CHAR_LIST_PARSE_OK slots=3 occupied=0');

    // The canonical base gate proves Enter activates the focused empty slot.
    await page.locator('#canvas').focus();
    await pressHeld('Enter', 100);
    await waitForRuntime('WS04_SLOT_ACTION index=0 occupied=0', 10000);
    await waitForRuntime('scene change: character-select -> character-create', 20000);
    await waitForRuntime('WS04_CHAR_CREATE_UI', 10000);
    await page.waitForTimeout(1000);
    await assertVisual('CHARACTER_CREATE', 'character-create');
    console.log('[ws04-driver] EMPTY_SLOT_TO_CREATE_OK');

    // Drive only genuine 1298 UIF controls: El Moradian Male -> Warrior.
    await page.mouse.click(170, 145, { delay: 100 });
    await page.waitForTimeout(500);
    await page.mouse.click(170, 325, { delay: 100 });
    await page.waitForTimeout(1200);

    // Allocate every available bonus point to STR. Extra clicks are harmless:
    // the real UI ignores them after m_iBonusPoint reaches zero.
    for (let i = 0; i < 50; i++) await page.mouse.click(925, 114);

    const characterName = process.env.CHAR_NAME || `Ws04${Date.now().toString().slice(-8)}`;
    await page.mouse.click(510, 678, { delay: 80 });
    await page.keyboard.press('Control+A');
    await page.keyboard.type(characterName, { delay: 25 });
    await page.waitForTimeout(700);

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
      await pressHeld('Enter', 100);
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
