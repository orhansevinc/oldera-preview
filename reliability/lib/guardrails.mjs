import net from 'node:net';

export function assertLocalTarget(raw, label = 'target') {
  const url = new URL(raw);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const loopback = host === 'localhost' || host === '127.0.0.1' || host === '::1' || (net.isIP(host) === 4 && host.startsWith('127.'));
  if (!loopback && process.env.WS20_ALLOW_NONLOOPBACK !== '1') {
    throw new Error(`${label} must be loopback by default; got ${url.origin}. Set WS20_ALLOW_NONLOOPBACK=1 only for an explicitly owned test environment.`);
  }
  return url;
}

export function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

export async function waitForHttp(raw, { timeoutMs = 10000, intervalMs = 150 } = {}) {
  const url = assertLocalTarget(raw, 'health target');
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(Math.min(1500, timeoutMs)) });
      if (response.ok) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  throw new Error(`health target did not become ready: ${lastError?.message || 'timeout'}`);
}

export function printResult(name, ok, detail = '') {
  const state = ok ? 'PASS' : 'FAIL';
  console.log(`[${state}] ${name}${detail ? ` — ${detail}` : ''}`);
}
