import { assertLocalTarget, percentile, printResult, waitForHttp } from '../../reliability/lib/guardrails.mjs';

const base = (process.env.WS20_ADMIN_BASE_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');
assertLocalTarget(base, 'admin API');
const total = Number(process.env.WS20_AUTH_REQUESTS || 96);
const concurrency = Math.max(1, Number(process.env.WS20_AUTH_CONCURRENCY || 16));
await waitForHttp(`${base}/api/admin/health`, { timeoutMs: 12000 });

const latencies = [];
const statuses = new Map();
let networkErrors = 0;
let cursor = 0;

async function worker() {
  while (true) {
    const i = cursor++;
    if (i >= total) return;
    const started = performance.now();
    try {
      const response = await fetch(`${base}/api/admin/session/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-ws20-case': String(i) },
        body: JSON.stringify({ user: `invalid-${i}`, password: `invalid-${i}` }),
        signal: AbortSignal.timeout(5000)
      });
      latencies.push(performance.now() - started);
      statuses.set(response.status, (statuses.get(response.status) || 0) + 1);
      await response.arrayBuffer();
    } catch (error) {
      networkErrors++;
      latencies.push(performance.now() - started);
    }
  }
}

await Promise.all(Array.from({ length: concurrency }, () => worker()));
const summary = {
  total,
  concurrency,
  statuses: Object.fromEntries([...statuses.entries()].sort((a,b) => a[0]-b[0])),
  networkErrors,
  p50Ms: Math.round(percentile(latencies, 50)),
  p95Ms: Math.round(percentile(latencies, 95)),
  p99Ms: Math.round(percentile(latencies, 99))
};
console.log(JSON.stringify(summary, null, 2));
const serverErrors = [...statuses.entries()].filter(([s]) => s >= 500).reduce((n, [,c]) => n + c, 0);
const rateLimited = statuses.get(429) || 0;
const ok = networkErrors === 0 && serverErrors === 0 && rateLimited > 0;
printResult('invalid-auth storm is contained', ok, `429=${rateLimited}, 5xx=${serverErrors}, networkErrors=${networkErrors}, p95=${summary.p95Ms}ms`);
process.exitCode = ok ? 0 : 1;
