#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const target = process.env.P2_03_URL;
if (!target) throw new Error('P2_03_URL is required (use an integrated local/candidate build, not production).');
const label = process.env.P2_03_LABEL || 'candidate';
const outRoot = process.env.P2_03_OUT || 'artifacts/p2-03';
const quality = process.env.P2_03_QUALITY || 'sharp';
const timeout = Number(process.env.P2_03_TIMEOUT_MS || 90000);
const resolutions = [[1366, 768], [1920, 1080]];
const scales = [1.0, 1.25, 1.5];
const modes = ['windowed', 'fullscreen'];

await fs.mkdir(path.join(outRoot, label), { recursive: true });
const results = [];

for (const [physicalW, physicalH] of resolutions) {
  for (const osScale of scales) {
    for (const mode of modes) {
      const cssW = Math.max(640, Math.round(physicalW / osScale));
      const cssH = Math.max(480, Math.round(physicalH / osScale));
      const browser = await chromium.launch({ headless: true });
      const context = await browser.newContext({
        viewport: { width: cssW, height: cssH },
        deviceScaleFactor: osScale,
      });
      const page = await context.newPage();
      const url = new URL(target);
      url.searchParams.set('renderQuality', quality);
      const consoleLines = [];
      page.on('console', m => consoleLines.push(`${m.type()}: ${m.text()}`));
      await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout });

      if (mode === 'fullscreen') {
        await page.evaluate(() => {
          const b = document.createElement('button');
          b.id = 'p203-fullscreen-trigger';
          b.textContent = 'fullscreen';
          b.style.position = 'fixed'; b.style.left = '0'; b.style.top = '0'; b.style.zIndex = '2147483647';
          b.addEventListener('click', () => document.documentElement.requestFullscreen());
          document.body.appendChild(b);
        });
        await page.click('#p203-fullscreen-trigger');
        await page.waitForFunction(() => !!document.fullscreenElement, null, { timeout: 10000 });
        await page.evaluate(() => document.querySelector('#p203-fullscreen-trigger')?.remove());
      }

      await page.waitForFunction(() => {
        const m = window.__OLDKO_RENDER_METRICS__;
        return m && m.backingWidth > 0 && m.drawingBufferWidth > 0 && m.fps > 0;
      }, null, { timeout });
      await page.waitForTimeout(1500);

      const observed = await page.evaluate(() => {
        const canvas = (typeof Module !== 'undefined' && Module.canvas) || document.querySelector('#canvas');
        const r = canvas.getBoundingClientRect();
        const m = structuredClone(window.__OLDKO_RENDER_METRICS__ || {});
        return {
          metrics: m,
          canvas: { left: r.left, top: r.top, width: r.width, height: r.height, backingWidth: canvas.width, backingHeight: canvas.height },
          viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
          fullscreen: !!document.fullscreenElement,
        };
      });

      const m = observed.metrics;
      const epsilon = 2;
      const checks = {
        cssLogicalAligned: Math.abs(m.logicalWidth - observed.canvas.width) <= epsilon && Math.abs(m.logicalHeight - observed.canvas.height) <= epsilon,
        backingMatchesCanvas: m.backingWidth === observed.canvas.backingWidth && m.backingHeight === observed.canvas.backingHeight,
        drawingBufferMatchesBacking: Math.abs(m.drawingBufferWidth - m.backingWidth) <= epsilon && Math.abs(m.drawingBufferHeight - m.backingHeight) <= epsilon,
        noHiddenDownscale: m.renderScale >= 1.0,
        dprBounded: m.renderScale <= Math.min(Math.max(1, observed.viewport.dpr), 2.0) + 0.01,
        modeApplied: mode === 'windowed' ? !observed.fullscreen : observed.fullscreen,
        canvasNotClipped: observed.canvas.left >= -epsilon && observed.canvas.top >= -epsilon && observed.canvas.left + observed.canvas.width <= observed.viewport.width + epsilon && observed.canvas.top + observed.canvas.height <= observed.viewport.height + epsilon,
      };
      const pass = Object.values(checks).every(Boolean);
      const id = `${physicalW}x${physicalH}-scale${String(osScale).replace('.', '_')}-${mode}`;
      const screenshot = path.join(outRoot, label, `${id}.png`);
      await page.screenshot({ path: screenshot, fullPage: false });
      const record = { id, label, quality, requested: { physicalW, physicalH, osScale, cssW, cssH, mode }, observed, checks, pass, screenshot };
      results.push(record);
      await fs.writeFile(path.join(outRoot, label, `${id}.json`), JSON.stringify(record, null, 2));
      await fs.writeFile(path.join(outRoot, label, `${id}.console.log`), consoleLines.join('\n'));
      await context.close();
      await browser.close();
    }
  }
}

const summary = {
  target,
  label,
  quality,
  generatedAt: new Date().toISOString(),
  cases: results.length,
  passed: results.filter(r => r.pass).length,
  failed: results.filter(r => !r.pass).map(r => r.id),
  results,
};
await fs.writeFile(path.join(outRoot, label, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ cases: summary.cases, passed: summary.passed, failed: summary.failed }, null, 2));
if (summary.failed.length) process.exitCode = 1;
