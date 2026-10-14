#!/usr/bin/env node
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const outDir = process.env.OLDKO_SCREENSHOT_DIR || 'artifacts/domain-live/screenshots';
const timeout = Number(process.env.OLDKO_BROWSER_TIMEOUT_MS || 120000);
const targets = [
  ['website', 'https://oldkoweb.com/'],
  ['login', 'https://oldkoweb.com/account.html#login'],
  ['register', 'https://oldkoweb.com/account.html#register'],
  ['dashboard', 'https://oldkoweb.com/account.html#dashboard'],
  ['play', 'https://play.oldkoweb.com/'],
  ['admin', 'https://admin.oldkoweb.com/']
];
const viewports = [
  ['desktop', { width: 1440, height: 1000 }],
  ['mobile', { width: 390, height: 844 }]
];

await fs.mkdir(outDir, { recursive: true });
const report = { generated_at: new Date().toISOString(), captures: [], console_errors: [], request_failures: [] };
const browser = await chromium.launch({ headless: true });
try {
  for (const [vpName, viewport] of viewports) {
    const context = await browser.newContext({ viewport, ignoreHTTPSErrors: false });
    for (const [name, url] of targets) {
      const page = await context.newPage();
      page.setDefaultTimeout(timeout);
      const errors = [];
      const failures = [];
      page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
      page.on('pageerror', (err) => errors.push(String(err?.message || err)));
      page.on('requestfailed', (req) => failures.push({ url: req.url(), error: req.failure()?.errorText || 'requestfailed' }));
      let status = null;
      let title = null;
      let bodyText = '';
      let error = null;
      try {
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
        status = response?.status() ?? null;
        await page.waitForTimeout(name === 'play' ? 10000 : 2000);
        title = await page.title();
        bodyText = (await page.locator('body').innerText({ timeout: 15000 })).slice(0, 20000);
        await page.screenshot({ path: path.join(outDir, `${name}-${vpName}.png`), fullPage: true });
      } catch (e) {
        error = String(e?.message || e);
      }
      report.captures.push({ name, viewport: vpName, url, http_status: status, title, error, body_sample: bodyText.slice(0, 1000), console_error_count: errors.length, request_failure_count: failures.length });
      for (const value of errors.slice(0, 50)) report.console_errors.push({ name, viewport: vpName, value });
      for (const value of failures.slice(0, 100)) report.request_failures.push({ name, viewport: vpName, ...value });
      await page.close();
    }
    await context.close();
  }
} finally {
  await browser.close();
}
await fs.writeFile(path.join(outDir, 'browser-report.json'), JSON.stringify(report, null, 2) + '\n');
const failed = report.captures.filter((c) => c.error || c.http_status !== 200);
console.log(JSON.stringify({ captures: report.captures.length, failed: failed.length, outDir }, null, 2));
process.exit(failed.length ? 1 : 0);
