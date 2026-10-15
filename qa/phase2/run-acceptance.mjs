#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  return out;
}
function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
function mkdir(p) { fs.mkdirSync(p, { recursive: true }); }
function write(file, value) { mkdir(path.dirname(file)); fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n'); }
function now() { return new Date().toISOString(); }

const a = parseArgs(process.argv);
if (!['local', 'domain'].includes(a.mode) || !a.candidate || !a.matrix || !a.out) {
  console.error('usage: node run-acceptance.mjs --mode local|domain --candidate <manifest> --matrix <matrix> --out <dir>');
  process.exit(64);
}
const candidateRaw = fs.readFileSync(a.candidate);
const candidate = JSON.parse(candidateRaw.toString('utf8'));
const matrix = JSON.parse(fs.readFileSync(a.matrix, 'utf8'));
const fingerprint = `sha256:${sha256(candidateRaw)}`;
if (matrix.candidate_fingerprint !== fingerprint) throw new Error(`matrix candidate mismatch: ${matrix.candidate_fingerprint} != ${fingerprint}`);
mkdir(a.out);

const publicOrigins = { site: 'https://oldkoweb.com', play: 'https://play.oldkoweb.com', admin: 'https://admin.oldkoweb.com' };
const localOrigins = {
  site: process.env.QA_ORIGIN_SITE || 'http://127.0.0.1',
  play: process.env.QA_ORIGIN_PLAY || 'http://127.0.0.1',
  admin: process.env.QA_ORIGIN_ADMIN || 'http://127.0.0.1'
};
const origins = a.mode === 'domain' ? publicOrigins : localOrigins;
const run = {
  schema_version: 'oldkoweb-phase2-acceptance-run/v1', mode: a.mode, started_at: now(), candidate_fingerprint: fingerprint,
  candidate_identity: matrix.candidate_identity, origins, http: {}, browser: {}, scenario_results: {},
  receipts: [], blockers: [], failures: [], domain_verified: false, local_verified: false
};

for (const [name, url] of Object.entries(origins)) {
  const started = performance.now();
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(Number(process.env.QA_HTTP_TIMEOUT_MS || 15000)) });
    run.http[name] = { status: res.status, ok: res.ok, final_url: res.url, elapsed_ms: Math.round(performance.now() - started), server: res.headers.get('server'), content_type: res.headers.get('content-type') };
    if (!res.ok) run.failures.push({ owner: name === 'play' ? 'P2-12' : 'P2-00', code: `HTTP_${name.toUpperCase()}_${res.status}`, url });
  } catch (err) {
    run.http[name] = { ok: false, elapsed_ms: Math.round(performance.now() - started), error: err.message };
    run.blockers.push({ owner: 'P2-12', code: `${a.mode.toUpperCase()}_${name.toUpperCase()}_UNREACHABLE`, url, error: err.message });
  }
}

let chromium;
try { ({ chromium } = await import('playwright')); }
catch (err) { run.blockers.push({ owner: 'P2-13', code: 'PLAYWRIGHT_NOT_INSTALLED', error: err.message, remedy: 'npm i -D playwright && npx playwright install chromium' }); }

if (chromium) {
  const browser = await chromium.launch({ headless: process.env.QA_HEADED !== '1' });
  try {
    for (const [name, url] of Object.entries(origins)) {
      const context = await browser.newContext({ ignoreHTTPSErrors: false, viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();
      const consoleErrors = [];
      const requestFailures = [];
      const wsEvents = [];
      page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push({ text: msg.text(), at: now() }); });
      page.on('requestfailed', req => requestFailures.push({ url: req.url(), method: req.method(), error: req.failure()?.errorText || null }));
      page.on('websocket', ws => {
        const item = { url: ws.url(), opened_at: now(), closed_at: null, frame_errors: [] };
        wsEvents.push(item);
        ws.on('close', () => { item.closed_at = now(); });
        ws.on('socketerror', e => item.frame_errors.push(String(e)));
      });
      const started = performance.now();
      let nav = null;
      try {
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: Number(process.env.QA_NAV_TIMEOUT_MS || 60000) });
        await page.waitForTimeout(Number(process.env.QA_SETTLE_MS || 5000));
        const metrics = await page.evaluate(() => {
          const canvas = document.querySelector('canvas');
          const rect = canvas?.getBoundingClientRect?.();
          let gl = null;
          try { gl = canvas?.getContext?.('webgl2') || canvas?.getContext?.('webgl'); } catch {}
          const ext = gl?.getExtension?.('WEBGL_debug_renderer_info');
          const navEntry = performance.getEntriesByType('navigation')[0];
          const resources = performance.getEntriesByType('resource').map(r => ({ name:r.name, duration:r.duration, transferSize:r.transferSize, encodedBodySize:r.encodedBodySize, initiatorType:r.initiatorType })).slice(-500);
          return {
            href: location.href, title: document.title, dpr: devicePixelRatio,
            canvas: canvas ? { width: canvas.width, height: canvas.height, css_width: rect?.width ?? null, css_height: rect?.height ?? null } : null,
            webgl: gl ? { drawing_buffer_width: gl.drawingBufferWidth, drawing_buffer_height: gl.drawingBufferHeight, renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR) } : null,
            navigation: navEntry ? navEntry.toJSON() : null, resources
          };
        });
        if (name === 'play') {
          metrics.frame_sample = await page.evaluate(async () => {
            const samples = []; let last = performance.now();
            await new Promise(resolve => { let n = 0; function step(t) { samples.push(t-last); last=t; n++; if(n>=120) resolve(); else requestAnimationFrame(step); } requestAnimationFrame(step); });
            const sorted = [...samples].sort((a,b)=>a-b); const avg = samples.reduce((x,y)=>x+y,0)/samples.length;
            return { frames:samples.length, avg_frame_ms:avg, fps:1000/avg, p95_frame_ms:sorted[Math.floor(sorted.length*0.95)] };
          });
        }
        const shot = path.resolve(a.out, `${name}.png`);
        await page.screenshot({ path: shot, fullPage: true });
        nav = { status: response?.status() ?? null, elapsed_ms: Math.round(performance.now()-started), metrics, screenshot: shot, console_errors: consoleErrors, request_failures: requestFailures, websockets: wsEvents };
      } catch (err) {
        nav = { error: err.message, elapsed_ms: Math.round(performance.now()-started), console_errors: consoleErrors, request_failures: requestFailures, websockets: wsEvents };
        run.failures.push({ owner: name === 'play' ? 'P2-03' : 'P2-00', code: `BROWSER_${name.toUpperCase()}_FAILED`, error: err.message });
      }
      run.browser[name] = nav;
      await context.close();
    }
  } finally { await browser.close(); }
}

if (process.env.QA_RECEIPTS_DIR && fs.existsSync(process.env.QA_RECEIPTS_DIR)) {
  for (const file of fs.readdirSync(process.env.QA_RECEIPTS_DIR).filter(x => x.endsWith('.json')).sort()) {
    const full = path.join(process.env.QA_RECEIPTS_DIR, file);
    try {
      const receipt = JSON.parse(fs.readFileSync(full, 'utf8'));
      if (receipt.candidate_fingerprint !== fingerprint) {
        run.blockers.push({ owner: 'P2-13', code: 'STALE_RECEIPT', file: full, actual: receipt.candidate_fingerprint, expected: fingerprint });
        continue;
      }
      if (!receipt.scenario_id || !['PASS','FAIL','BLOCKED'].includes(receipt.result)) {
        run.blockers.push({ owner: 'P2-13', code: 'INVALID_RECEIPT', file: full });
        continue;
      }
      run.receipts.push(full);
      run.scenario_results[receipt.scenario_id] = { result: receipt.result, owner: receipt.owner || null, evidence: receipt.evidence || [], file: full };
      if (receipt.result === 'FAIL') run.failures.push({ owner: receipt.owner || 'P2-13', code: `SCENARIO_${receipt.scenario_id}_FAIL`, file: full });
    } catch (err) { run.blockers.push({ owner: 'P2-13', code: 'RECEIPT_PARSE_ERROR', file: full, error: err.message }); }
  }
}

run.finished_at = now();
run.local_verified = a.mode === 'local' && Object.values(run.http).every(x => x.ok) && run.failures.length === 0 && run.blockers.length === 0;
run.domain_verified = a.mode === 'domain' && Object.values(run.http).every(x => x.ok && String(x.final_url || '').startsWith('https://')) && Object.keys(run.browser).length === 3 && run.failures.length === 0 && run.blockers.length === 0;
write(path.join(a.out, 'run.json'), run);
console.log(JSON.stringify({ mode: run.mode, candidate_fingerprint: fingerprint, failures: run.failures.length, blockers: run.blockers.length, local_verified: run.local_verified, domain_verified: run.domain_verified }));
if (run.failures.length || run.blockers.length) process.exitCode = 2;
