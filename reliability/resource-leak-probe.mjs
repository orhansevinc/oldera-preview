import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { printResult, waitForHttp } from './lib/guardrails.mjs';

const root = process.cwd();
const entry = path.join(root, 'server/src/index.js');
const port = Number(process.env.WS20_SOAK_PORT || 8793);
const health = `http://127.0.0.1:${port}/api/admin/health`;
const requests = Number(process.env.WS20_SOAK_REQUESTS || 750);
const concurrency = Number(process.env.WS20_SOAK_CONCURRENCY || 20);

const child = spawn(process.execPath, [entry], {
  cwd: path.join(root, 'server'),
  env: { ...process.env, PORT: String(port), NODE_ENV: 'test', KO_DB_ENABLED: 'false', ROOT_OWNER_PASSWORD: 'ws20-test-only-password', SESSION_SECRET: 'ws20-test-only-session-secret-32-bytes-minimum' },
  stdio: ['ignore', 'pipe', 'pipe']
});
child.stdout.on('data', d => process.stdout.write(`[server] ${d}`));
child.stderr.on('data', d => process.stderr.write(`[server] ${d}`));

async function rssKb() {
  if (process.platform !== 'linux') return null;
  const text = await fs.readFile(`/proc/${child.pid}/status`, 'utf8');
  const match = text.match(/^VmRSS:\s+(\d+)\s+kB$/m);
  return match ? Number(match[1]) : null;
}

let failed = false;
try {
  await waitForHttp(health, { timeoutMs: 12000 });
  const before = await rssKb();
  let cursor = 0, errors = 0;
  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= requests) return;
      try {
        const r = await fetch(health, { signal: AbortSignal.timeout(3000) });
        if (!r.ok) errors++;
        await r.arrayBuffer();
      } catch { errors++; }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  await new Promise(resolve => setTimeout(resolve, 250));
  const after = await rssKb();
  const growthKb = before == null || after == null ? null : after - before;
  const growthOk = growthKb == null || growthKb < 64 * 1024;
  const ok = errors === 0 && growthOk;
  failed = !ok;
  printResult('resource leak indicator soak', ok, `requests=${requests} errors=${errors} rssBeforeKb=${before} rssAfterKb=${after} growthKb=${growthKb}`);
} finally {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM');
    await new Promise(resolve => child.once('exit', resolve));
  }
}
process.exitCode = failed ? 1 : 0;
