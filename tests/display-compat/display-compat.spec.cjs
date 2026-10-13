const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const compatScript = path.resolve(__dirname, '../../tools/ws43_display/display-compat.js');
const artifactDir = path.resolve(__dirname, 'artifacts');

const matrix = [
  { name: '1024x768', width: 1024, height: 768, dpr: 1 },
  { name: '1280x720', width: 1280, height: 720, dpr: 1 },
  { name: '1366x768', width: 1366, height: 768, dpr: 1 },
  { name: '1920x1080', width: 1920, height: 1080, dpr: 1 },
  { name: '1280x720-high-dpi', width: 1280, height: 720, dpr: 2 },
  { name: 'zoom-125-equivalent-1024x576', width: 1024, height: 576, dpr: 1 }
];

fs.mkdirSync(artifactDir, { recursive: true });

async function openRealClient(browser, entry) {
  const context = await browser.newContext({
    viewport: { width: entry.width, height: entry.height },
    deviceScaleFactor: entry.dpr
  });
  const page = await context.newPage();
  await page.goto('/openko-web/index.html', { waitUntil: 'domcontentloaded' });

  await expect(page.locator('#canvas')).toHaveCount(1);
  await expect(page.locator('script[src$="KnightOnLine.js"]')).toHaveCount(1);

  await page.addScriptTag({ path: compatScript });
  await page.waitForFunction(() => Boolean(window.__WS43_DISPLAY_COMPAT__));
  await page.evaluate(() => window.__WS43_DISPLAY_COMPAT__.applyLayout());
  await page.waitForTimeout(50);

  return { context, page };
}

async function diagnostics(page) {
  return page.evaluate(() => {
    const instance = window.__WS43_DISPLAY_COMPAT__;
    const snap = instance.snapshot();
    const rect = instance.canvas.getBoundingClientRect();
    const center = instance.mapPointer(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return { ...snap, centerMapping: center };
  });
}

for (const entry of matrix) {
  test(`real Emscripten canvas geometry: ${entry.name}`, async ({ browser }) => {
    const { context, page } = await openRealClient(browser, entry);
    const diag = await diagnostics(page);

    expect(diag.backing.width).toBeGreaterThan(0);
    expect(diag.backing.height).toBeGreaterThan(0);
    expect(diag.css.width).toBeGreaterThan(0);
    expect(diag.css.height).toBeGreaterThan(0);
    expect(diag.aspectError).not.toBeNull();
    expect(diag.aspectError).toBeLessThan(0.0001);
    expect(diag.css.left).toBeGreaterThanOrEqual(-0.1);
    expect(diag.css.top).toBeGreaterThanOrEqual(-0.1);
    expect(diag.css.left + diag.css.width).toBeLessThanOrEqual(diag.viewport.left + diag.viewport.width + 0.1);
    expect(diag.css.top + diag.css.height).toBeLessThanOrEqual(diag.viewport.top + diag.viewport.height + 0.1);
    expect(diag.centerMapping.x).toBeCloseTo(diag.backing.width / 2, 4);
    expect(diag.centerMapping.y).toBeCloseTo(diag.backing.height / 2, 4);
    expect(diag.centerMapping.inside).toBe(true);
    expect(diag.devicePixelRatio).toBe(entry.dpr);

    await page.screenshot({ path: path.join(artifactDir, `${entry.name}.png`) });
    fs.writeFileSync(
      path.join(artifactDir, `${entry.name}.json`),
      `${JSON.stringify(diag, null, 2)}\n`,
      'utf8'
    );

    await context.close();
  });
}

test('window resize keeps aspect ratio and pointer center aligned', async ({ browser }) => {
  const { context, page } = await openRealClient(browser, { width: 1366, height: 768, dpr: 1 });
  const before = await diagnostics(page);

  await page.setViewportSize({ width: 900, height: 1000 });
  await page.waitForTimeout(100);
  const after = await diagnostics(page);

  expect(after.aspectError).toBeLessThan(0.0001);
  expect(after.css.width).toBeLessThanOrEqual(after.viewport.width + 0.1);
  expect(after.css.height).toBeLessThanOrEqual(after.viewport.height + 0.1);
  expect(after.centerMapping.x).toBeCloseTo(after.backing.width / 2, 4);
  expect(after.centerMapping.y).toBeCloseTo(after.backing.height / 2, 4);
  expect(after.css.width !== before.css.width || after.css.height !== before.css.height).toBe(true);

  await page.screenshot({ path: path.join(artifactDir, 'resize-900x1000.png') });
  await context.close();
});

test('fullscreen change event path reflows and fullscreen exit is reversible', async ({ browser }) => {
  const { context, page } = await openRealClient(browser, { width: 1280, height: 720, dpr: 1 });

  const result = await page.evaluate(async () => {
    const canvas = document.getElementById('canvas');
    const instance = window.__WS43_DISPLAY_COMPAT__;
    let entered = false;
    let error = null;

    try {
      if (canvas.requestFullscreen) {
        await canvas.requestFullscreen();
        entered = document.fullscreenElement === canvas;
      }
    } catch (err) {
      error = String(err && err.message ? err.message : err);
    }

    document.dispatchEvent(new Event('fullscreenchange'));
    instance.applyLayout();
    const during = instance.snapshot();

    if (document.fullscreenElement && document.exitFullscreen) {
      await document.exitFullscreen();
    }
    document.dispatchEvent(new Event('fullscreenchange'));
    instance.applyLayout();
    const after = instance.snapshot();

    return { entered, error, during, after };
  });

  expect(result.during.aspectError).toBeLessThan(0.0001);
  expect(result.after.aspectError).toBeLessThan(0.0001);
  expect(result.after.fullscreen).toBe(false);

  fs.writeFileSync(
    path.join(artifactDir, 'fullscreen.json'),
    `${JSON.stringify(result, null, 2)}\n`,
    'utf8'
  );
  await context.close();
});
