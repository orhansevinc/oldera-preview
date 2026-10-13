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

  const saveEvidence = async () => {
    const status = await page.locator('#status').textContent().catch(() => '');
    fs.writeFileSync('browser-nation-status.txt', status || '');
    await page.locator('#canvas').screenshot({ path: 'browser-nation-canvas.png' }).catch(() => {});
  };

  const assertNationVisual = () => {
    const png = PNG.sync.read(fs.readFileSync('browser-nation-canvas.png'));
    let nonBlack = 0;
    const total = png.width * png.height;
    for (let i = 0; i < png.data.length; i += 4) {
      const r = png.data[i], g = png.data[i + 1], b = png.data[i + 2], a = png.data[i + 3];
      if (a > 0 && (r > 10 || g > 10 || b > 10)) nonBlack++;
    }
    const ratio = nonBlack / total;
    console.log(`[nation-driver] visual nonBlack=${nonBlack}/${total} ratio=${ratio.toFixed(4)}`);
    if (ratio < 0.01) {
      throw new Error(`Nation Select canvas is effectively black: ratio=${ratio.toFixed(4)}`);
    }
    console.log(`[nation-driver] NATION_VISUAL_OK ratio=${ratio.toFixed(4)}`);
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
      return t.includes("browser server list entry: name='OldKO' ip='127.0.0.1' users=7");
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
      return t.includes("connecting to game server 'OldKO' at 127.0.0.1:15001");
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
    await saveEvidence();
    assertNationVisual();
    console.log('[nation-driver] NATION_UI_OK');
  } catch (err) {
    await saveEvidence();
    throw err;
  } finally {
    await browser.close();
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});
