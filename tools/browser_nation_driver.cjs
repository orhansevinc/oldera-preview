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
  page.on('console', m => console.log(`[console:${m.type()}] ${m.text()}`));
  page.on('pageerror', e => console.log(`[pageerror] ${e.stack}`));

  const saveStatus = async () => {
    const status = await page.locator('#status').textContent().catch(() => '');
    fs.writeFileSync('browser-nation-status.txt', status || '');
    return status || '';
  };

  const pixelStats = (png) => {
    let nonBlack = 0;
    const total = png.width * png.height;
    for (let i = 0; i < png.data.length; i += 4) {
      const r = png.data[i], g = png.data[i + 1], b = png.data[i + 2], a = png.data[i + 3];
      if (a > 0 && (r > 10 || g > 10 || b > 10)) nonBlack++;
    }
    return { nonBlack, total, ratio: nonBlack / total };
  };

  const captureCompositorEvidence = async () => {
    const cdp = await page.context().newCDPSession(page);
    const shot = await Promise.race([
      cdp.send('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: false,
        clip: { x: 0, y: 0, width: 1024, height: 768, scale: 1 }
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('CDP screenshot timed out')), 8000))
    ]);
    const buffer = Buffer.from(shot.data, 'base64');
    fs.writeFileSync('browser-nation-canvas.png', buffer);
    return pixelStats(PNG.sync.read(buffer));
  };

  const assertVisual = async (label) => {
    // Primary gate: inspect the genuine WebGL2 framebuffer directly.
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

    console.log(`[nation-driver] ${label.toLowerCase()} framebuffer nonBlack=${framebuffer.nonBlack}/${framebuffer.total} ratio=${Number(framebuffer.ratio || 0).toFixed(4)} glError=${framebuffer.glError ?? 'n/a'}`);

    // Capture what Chrome actually composites. The second/final call therefore
    // leaves browser-nation-canvas.png as the Character Select proof image.
    let compositor = null;
    try {
      compositor = await captureCompositorEvidence();
      console.log(`[nation-driver] ${label.toLowerCase()} compositor nonBlack=${compositor.nonBlack}/${compositor.total} ratio=${compositor.ratio.toFixed(4)}`);
    } catch (err) {
      console.log(`[nation-driver] ${label.toLowerCase()} compositor evidence failed: ${err.message}`);
    }

    const framebufferRatio = Number(framebuffer.ratio || 0);
    const compositorRatio = compositor ? compositor.ratio : 0;
    const ratio = Math.max(framebufferRatio, compositorRatio);
    const source = compositorRatio >= framebufferRatio ? 'compositor' : 'framebuffer';

    if (ratio < 0.01) {
      throw new Error(`${label} is effectively black: framebuffer=${framebufferRatio.toFixed(4)} compositor=${compositorRatio.toFixed(4)}`);
    }

    console.log(`[nation-driver] ${label}_VISUAL_OK source=${source} ratio=${ratio.toFixed(4)}`);
  };

  const pressHeld = async (key, ms = 90) => {
    await page.keyboard.down(key);
    await page.waitForTimeout(ms);
    await page.keyboard.up(key);
  };

  try {
    await page.goto('http://127.0.0.1:8000/nation.html', {
      waitUntil: 'domcontentloaded', timeout: 30000
    });

    await page.waitForFunction(() => {
      const t = document.getElementById('status')?.textContent || '';
      return t.includes("browser server list entry: name='OldERA' ip='127.0.0.1' users=7");
    }, null, { timeout: 90000 });

    await page.locator('#canvas').focus();
    await page.waitForTimeout(100);
    console.log('[nation-driver] typing ID into real Edit_ID');
    await page.keyboard.type(process.env.TEST_ID, { delay: 30 });

    console.log('[nation-driver] moving real KO focus to Edit_PW');
    await pressHeld('Tab', 90);
    await page.waitForTimeout(120);

    console.log('[nation-driver] typing password into real Edit_PW');
    await page.keyboard.type(process.env.TEST_PW, { delay: 30 });

    console.log('[nation-driver] submitting login');
    await pressHeld('Enter', 90);

    await page.waitForFunction(() => {
      const t = document.getElementById('status')?.textContent || '';
      return t.includes('server list opened (1 server(s) available)');
    }, null, { timeout: 30000 });

    await page.waitForTimeout(350);
    console.log('[nation-driver] pressing Enter on real 1298 server list');
    await pressHeld('Enter', 100);

    await page.waitForFunction(() => {
      const t = document.getElementById('status')?.textContent || '';
      return t.includes("connecting to game server 'OldERA' at 127.0.0.1:15001");
    }, null, { timeout: 15000 });

    await page.waitForFunction(() => {
      const t = document.getElementById('status')?.textContent || '';
      return t.includes('game server version check answered: version=1298 (client expects 1298)');
    }, null, { timeout: 15000 });

    await page.waitForFunction(() => {
      const t = document.getElementById('status')?.textContent || '';
      return t.includes('game server login answered: nation=0');
    }, null, { timeout: 15000 });

    await page.waitForFunction(() => {
      const t = document.getElementById('status')?.textContent || '';
      return t.includes('scene change: login -> nation-select');
    }, null, { timeout: 15000 });

    await page.waitForTimeout(1000);
    await saveStatus();
    await assertVisual('NATION');
    console.log('[nation-driver] NATION_UI_OK');

    // Run 46 visually fixed the genuine El Morad button around this point in
    // the native 1024x768 UI. Use a real mouse event so UINationSelectDlg and
    // GameProcNationSelect send the original WIZ_SEL_NATION packet.
    await page.locator('#canvas').focus();
    console.log('[nation-driver] clicking real 1298 El Morad nation button');
    await page.mouse.click(258, 495, { delay: 120 });

    await page.waitForFunction(() => {
      const t = document.getElementById('status')?.textContent || '';
      return t.includes('scene change: nation-select -> character-select');
    }, null, { timeout: 20000 });

    await page.waitForTimeout(1500);
    const finalStatus = await saveStatus();
    if (finalStatus.includes('DFont: no usable font found')) {
      throw new Error('Runtime font preload failed: DFont still reports no usable font');
    }
    console.log('[nation-driver] FONT_RUNTIME_OK');

    await assertVisual('CHARACTER');
    console.log('[nation-driver] CHARACTER_UI_OK');
  } catch (err) {
    await saveStatus();
    console.error(`[nation-driver] failure: ${err.message}`);
    throw err;
  } finally {
    await browser.close();
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});
