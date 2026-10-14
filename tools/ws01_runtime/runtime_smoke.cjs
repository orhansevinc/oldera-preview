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

  const waitForDisplay = async (width, height, timeout = 15000) => {
    await page.waitForFunction(
      ({ width, height }) => {
        const m = window.Module;
        const s = m && m.oldkoDisplayState;
        const c = m && m.canvas;
        return !!(s && c
          && s.logicalWidth === width && s.logicalHeight === height
          && s.viewportWidth === width && s.viewportHeight === height
          && c.width === s.framebufferWidth && c.height === s.framebufferHeight
          && c.width > 0 && c.height > 0);
      },
      { width, height },
      { timeout }
    );
  };

  const inspectDisplay = async (expectedW, expectedH, label) => {
    const geometry = await page.evaluate(() => {
      const m = window.Module;
      const canvas = m.canvas;
      const state = m.oldkoDisplayState;
      const rect = canvas.getBoundingClientRect();
      const mapped = m.oldkoMapClientPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      let glViewport = null;
      try {
        const gl = canvas.getContext('webgl2');
        if (gl) glViewport = Array.from(gl.getParameter(gl.VIEWPORT));
      } catch (_) {}
      return {
        state: { ...state },
        canvas: { width: canvas.width, height: canvas.height },
        rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        mapped,
        glViewport,
        inner: { width: innerWidth, height: innerHeight },
        presentation: window.__OLDKO_BOOTSTRAP__ && window.__OLDKO_BOOTSTRAP__.presentation
      };
    });

    if (geometry.state.logicalWidth !== expectedW || geometry.state.logicalHeight !== expectedH) {
      throw new Error(`${label}: native logical size mismatch: ${JSON.stringify(geometry)}`);
    }
    if (geometry.state.viewportWidth !== expectedW || geometry.state.viewportHeight !== expectedH) {
      throw new Error(`${label}: RHI viewport mismatch: ${JSON.stringify(geometry)}`);
    }
    if (geometry.canvas.width !== geometry.state.framebufferWidth
        || geometry.canvas.height !== geometry.state.framebufferHeight) {
      throw new Error(`${label}: canvas/backbuffer mismatch: ${JSON.stringify(geometry)}`);
    }
    if (!(geometry.rect.width > 0 && geometry.rect.height > 0)) {
      throw new Error(`${label}: CSS presentation has invalid geometry: ${JSON.stringify(geometry)}`);
    }

    const backingAspect = geometry.canvas.width / geometry.canvas.height;
    const cssAspect = geometry.rect.width / geometry.rect.height;
    if (Math.abs(backingAspect - cssAspect) > 0.0025) {
      throw new Error(`${label}: presentation aspect distortion detected: ${JSON.stringify(geometry)}`);
    }
    if (!geometry.mapped
        || Math.abs(geometry.mapped.x - geometry.state.logicalWidth / 2) > 1.0
        || Math.abs(geometry.mapped.y - geometry.state.logicalHeight / 2) > 1.0) {
      throw new Error(`${label}: pointer/backing alignment mismatch: ${JSON.stringify(geometry)}`);
    }
    if (geometry.glViewport) {
      const [x, y, w, h] = geometry.glViewport;
      if (x !== 0 || y !== 0 || w !== geometry.state.framebufferWidth || h !== geometry.state.framebufferHeight) {
        throw new Error(`${label}: WebGL viewport mismatch: ${JSON.stringify(geometry)}`);
      }
    }

    emit(`[display:${label}] ${JSON.stringify(geometry)}`);
    return geometry;
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
    await waitForLog('OldKOWeb browser native display target: 1280x720');

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

    // Native backing-store acceptance matrix from the WS01 inbox. Every entry
    // must become the SDL logical size, the RHI full viewport and the real
    // WebGL framebuffer; CSS only mirrors that aspect without distortion.
    const matrix = [[1280,720],[1366,768],[1600,900],[1920,1080]];
    for (const [width, height] of matrix) {
      await page.setViewportSize({ width, height });
      await waitForDisplay(width, height);
      await inspectDisplay(width, height, `${width}x${height}`);
    }

    // Explicit classic fallback remains native 1024x768. On a 16:9 browser it
    // letterboxes uniformly; no stretch/crop and pointer mapping stays exact.
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.evaluate(() => {
      Module.oldkoDisplay.mode = 'classic';
      dispatchEvent(new Event('resize'));
    });
    await waitForDisplay(1024, 768);
    const classic = await inspectDisplay(1024, 768, 'classic-1024x768');
    if (!(classic.rect.width < 1280 && classic.rect.height === 720)) {
      throw new Error(`classic fallback did not preserve 4:3 letterbox presentation: ${JSON.stringify(classic)}`);
    }

    // Restore native viewport mode and prove the fullscreenchange hook reaches
    // the same resolver/sync path. Headless CI does not claim an OS fullscreen
    // transition; WS43 owns the final live headed fullscreen acceptance.
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.evaluate(() => {
      Module.oldkoDisplay.mode = 'viewport';
      dispatchEvent(new Event('resize'));
    });
    await waitForDisplay(1920, 1080);
    const generationBeforeFullscreenEvent = await page.evaluate(() => Module.oldkoDisplayState.generation);
    await page.evaluate(() => document.dispatchEvent(new Event('fullscreenchange')));
    await page.waitForFunction(
      before => Module.oldkoDisplayState.generation > before
        && Module.oldkoDisplayState.lastBrowserEvent === 'fullscreenchange',
      generationBeforeFullscreenEvent,
      { timeout: 5000 }
    );
    await inspectDisplay(1920, 1080, 'fullscreenchange-path');

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

    emit('DISPLAY_OK native matrix 1280x720 1366x768 1600x900 1920x1080 + classic 1024x768 fallback + pointer/RHI/WebGL alignment');
    emit('RUNTIME_OK WASM + data preload + WebGL2/OpenGL + real login bootstrap + native dynamic display');
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
