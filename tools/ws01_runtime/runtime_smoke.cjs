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

  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
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
