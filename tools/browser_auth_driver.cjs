const fs = require('fs');
const { chromium } = require('playwright-core');

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
    fs.writeFileSync('browser-auth-status.txt', status || '');
    await page.locator('#canvas').screenshot({ path: 'browser-auth-canvas.png' }).catch(() => {});
  };

  try {
    await page.goto('http://127.0.0.1:8000/auth.html', {
      waitUntil: 'domcontentloaded', timeout: 30000
    });

    await page.waitForFunction(() => {
      const t = document.getElementById('status')?.textContent || '';
      return t.includes("browser server list entry: name='OldERA' ip='127.0.0.1' users=7");
    }, null, { timeout: 90000 });

    // The real 1298 login procedure calls FocusToID() after connecting.
    // Give the SDL canvas DOM focus without creating a game mouse click.
    await page.locator('#canvas').focus();
    await page.waitForTimeout(100);
    console.log('[auth-driver] canvas focused; typing ID into real Edit_ID');
    await page.keyboard.type(process.env.TEST_ID, { delay: 30 });

    // CGameProcedure samples DirectInput-style state every ~10ms. Holding Tab
    // makes the edge visible to that sampler and triggers CUILogIn_1298::FocusCircular().
    console.log('[auth-driver] holding Tab to move real KO focus to Edit_PW');
    await page.keyboard.down('Tab');
    await page.waitForTimeout(80);
    await page.keyboard.up('Tab');
    await page.waitForTimeout(120);

    console.log('[auth-driver] typing password into real Edit_PW');
    await page.keyboard.type(process.env.TEST_PW, { delay: 30 });

    console.log('[auth-driver] submitting with Enter');
    await page.keyboard.down('Enter');
    await page.waitForTimeout(80);
    await page.keyboard.up('Enter');

    await page.waitForFunction(() => {
      const t = document.getElementById('status')?.textContent || '';
      return t.includes('browser login response: cmd=0xf3 result=1');
    }, null, { timeout: 30000 });

    // AUTH_OK makes the client ask F6 NEWS. Our stub returns an empty notice,
    // which sends the genuine 1298 UI through OpenServerList().
    await page.waitForFunction(() => {
      const t = document.getElementById('status')?.textContent || '';
      return t.includes('server list opened (1 server(s) available)');
    }, null, { timeout: 15000 });

    await page.waitForTimeout(500);
    await saveEvidence();
    console.log('[auth-driver] AUTH_UI_OK');
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
