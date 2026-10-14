const fs = require('fs');
const { chromium } = require('playwright-core');

const targetUrl = process.env.WS01_URL || 'http://127.0.0.1:8000/index.html';
const chrome = process.env.CHROME;
if (!chrome) {
  console.error('RUNTIME_FAIL CHROME is not set');
  process.exit(2);
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: chrome,
    args: [
      '--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'
    ]
  });

  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const lines = [];
  const pageErrors = [];
  const requestFailures = [];
  const packageResponses = new Map();

  const emit = (line) => {
    lines.push(line);
    console.log(line);
  };

  page.on('console', msg => emit(`[console:${msg.type()}] ${msg.text()}`));
  page.on('pageerror', err => {
    const line = `[pageerror] ${err.stack || err.message}`;
    pageErrors.push(line);
    emit(line);
  });
  page.on('requestfailed', req => {
    const url = req.url();
    if (/KnightOnLine\.(js|wasm|data)(?:$|\?)/.test(url)) {
      const line = `[requestfailed] ${url} ${req.failure()?.errorText || ''}`;
      requestFailures.push(line);
      emit(line);
    }
  });
  page.on('response', response => {
    const url = response.url();
    const match = url.match(/KnightOnLine\.(js|wasm|data)(?:$|\?)/);
    if (match) {
      packageResponses.set(match[1], response.status());
      emit(`[response] KnightOnLine.${match[1]} status=${response.status()}`);
    }
  });

  const waitForLog = async (needle, timeout = 60000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (lines.some(line => line.includes(needle))) return;
      await page.waitForTimeout(50);
    }
    throw new Error(`timeout waiting for runtime log: ${needle}`);
  };

  const assertGeometry = async (width, height) => {
    await page.setViewportSize({ width, height });
    await page.waitForFunction(
      ([w, h]) => {
        const canvas = document.getElementById('canvas');
        if (!canvas || canvas.width !== w || canvas.height !== h) return false;
        const rect = canvas.getBoundingClientRect();
        return Math.abs(rect.left) < 1
          && Math.abs(rect.top) < 1
          && Math.abs(rect.width - w) < 1
          && Math.abs(rect.height - h) < 1;
      },
      [width, height],
      { timeout: 15000 }
    );
    const geometry = await page.evaluate(() => {
      const canvas = document.getElementById('canvas');
      const rect = canvas.getBoundingClientRect();
      const diag = window.__OLDKO_DISPLAY_DIAGNOSTICS__;
      const mapped = diag.mapPointer(rect.left + rect.width * 0.75, rect.top + rect.height * 0.25);
      return {
        backingWidth: canvas.width,
        backingHeight: canvas.height,
        cssWidth: rect.width,
        cssHeight: rect.height,
        pointerX: mapped.x,
        pointerY: mapped.y,
        inside: mapped.inside
      };
    });
    if (geometry.backingWidth !== width || geometry.backingHeight !== height) {
      throw new Error(`backing store mismatch ${JSON.stringify(geometry)} expected=${width}x${height}`);
    }
    if (Math.abs(geometry.pointerX - width * 0.75) > 1 || Math.abs(geometry.pointerY - height * 0.25) > 1 || !geometry.inside) {
      throw new Error(`pointer mapping mismatch ${JSON.stringify(geometry)} expected=${width}x${height}`);
    }
    emit(`[display] ${width}x${height} native backing + CSS 1:1 + pointer aligned`);
  };

  let failure = null;
  try {
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(
      () => window.__OLDKO_BOOTSTRAP__ && window.__OLDKO_BOOTSTRAP__.runtimeReady === true,
      null,
      { timeout: 60000 }
    );

    await waitForLog('game data directory: /data');
    await waitForLog('WebGL 2.0');
    await waitForLog('render backend: OpenGL');
    await waitForLog('login scene: CGameProcedure brought up');
    await waitForLog('browser display initial: 1280x720');

    for (const [width, height] of [[1280,720],[1366,768],[1600,900],[1920,1080]]) {
      await assertGeometry(width, height);
      if (width !== 1280 || height !== 720) {
        await waitForLog(`browser display sync: logical ${width}x${height}`);
      }
    }

    const state = await page.evaluate(() => window.__OLDKO_BOOTSTRAP__);
    emit(`[state] ${JSON.stringify(state)}`);

    if (!state || state.webgl2Available !== true) throw new Error('WebGL2 capability gate did not pass');
    if (state.fatal) throw new Error(`bootstrap fatal: ${state.fatal}`);
    if (pageErrors.length) throw new Error(pageErrors.join('\n'));
    if (requestFailures.length) throw new Error(requestFailures.join('\n'));

    for (const ext of ['js', 'wasm', 'data']) {
      if (!packageResponses.has(ext)) throw new Error(`KnightOnLine.${ext} response was not observed`);
      const status = packageResponses.get(ext);
      if (status < 200 || status >= 300) throw new Error(`KnightOnLine.${ext} returned HTTP ${status}`);
    }

    const merged = lines.join('\n');
    const fatalPatterns = [
      /\[FATAL\]/i,
      /render backend: Null/i,
      /\bAborted\(/i,
      /\bRuntimeError:/i,
      /Cannot initialize SDL/i,
      /Cannot create window/i,
      /GL_INVALID_(?:ENUM|VALUE|OPERATION)/i,
      /WebGL: INVALID_/i,
      /WebGL: too many errors/i,
      /failed to asynchronously prepare wasm/i,
      /wasm streaming compile failed/i
    ];
    for (const pattern of fatalPatterns) {
      if (pattern.test(merged)) throw new Error(`fatal runtime pattern matched: ${pattern}`);
    }

    emit('DISPLAY_MATRIX_OK 1280x720 1366x768 1600x900 1920x1080 native backing + pointer alignment');
    emit('RUNTIME_OK WASM + data preload + WebGL2/OpenGL + real login bootstrap');
  } catch (err) {
    failure = err;
    emit(`RUNTIME_FAIL ${err.stack || err.message}`);
  } finally {
    fs.writeFileSync(process.env.WS01_LOG || 'ws01-runtime-browser.log', lines.join('\n') + '\n');
    await browser.close();
  }

  if (failure) process.exit(1);
})().catch(err => {
  console.error(`RUNTIME_FAIL ${err.stack || err.message}`);
  process.exit(1);
});
