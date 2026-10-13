import { assertLocalTarget, printResult, waitForHttp } from '../reliability/lib/guardrails.mjs';

const base = (process.env.WS20_ADMIN_BASE_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');
assertLocalTarget(base, 'admin API');

let failed = false;
async function expect(name, request, predicate, detailFn = r => `HTTP ${r.status}`) {
  try {
    const response = await request();
    const ok = await predicate(response);
    printResult(name, ok, detailFn(response));
    if (!ok) failed = true;
  } catch (error) {
    printResult(name, false, error.message);
    failed = true;
  }
}

await waitForHttp(`${base}/api/admin/health`, { timeoutMs: 12000 });

await expect('health remains public and alive',
  () => fetch(`${base}/api/admin/health`, { signal: AbortSignal.timeout(3000) }),
  async r => r.status === 200 && (await r.clone().json()).ok === true);

await expect('unauthorized session read rejected',
  () => fetch(`${base}/api/admin/session`, { signal: AbortSignal.timeout(3000) }),
  async r => r.status === 401);

await expect('unauthorized player list rejected',
  () => fetch(`${base}/api/admin/players`, { signal: AbortSignal.timeout(3000) }),
  async r => r.status === 401);

await expect('unauthorized command rejected',
  () => fetch(`${base}/api/admin/commands`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ command: 'NOTICEALL', arg: 'x' }), signal: AbortSignal.timeout(3000)
  }), async r => r.status === 401);

await expect('oversized JSON rejected',
  () => fetch(`${base}/api/admin/session/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ user: 'x', password: 'x'.repeat(300 * 1024) }), signal: AbortSignal.timeout(5000)
  }), async r => r.status === 413);

await expect('invalid owner login rejected',
  () => fetch(`${base}/api/admin/session/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ user: 'INVALID', password: 'INVALID' }), signal: AbortSignal.timeout(3000)
  }), async r => r.status === 401 || r.status === 429);

process.exitCode = failed ? 1 : 0;
