import { spawn } from 'node:child_process';
import path from 'node:path';
import { printResult, waitForHttp } from './lib/guardrails.mjs';

const root = process.cwd();
const entry = path.join(root, 'server/src/index.js');
const port = Number(process.env.WS20_DB_DOWN_PORT || 8792);
const health = `http://127.0.0.1:${port}/api/admin/health`;
const child = spawn(process.execPath, [entry], {
  cwd: path.join(root, 'server'),
  env: {
    ...process.env,
    PORT: String(port), NODE_ENV: 'test', KO_DB_ENABLED: 'true', KO_DB_HOST: '127.0.0.1', KO_DB_PORT: '1',
    KO_DB_USER: 'ws20', KO_DB_PASSWORD: 'ws20', KO_DB_NAME: 'ws20',
    ROOT_OWNER_USER: 'WS20_OWNER', ROOT_OWNER_PASSWORD: 'ws20-test-only-password',
    SESSION_SECRET: 'ws20-test-only-session-secret-32-bytes-minimum'
  },
  stdio: ['ignore', 'pipe', 'pipe']
});
child.stdout.on('data', d => process.stdout.write(`[server] ${d}`));
child.stderr.on('data', d => process.stderr.write(`[server] ${d}`));

let ok = false;
try {
  const response = await waitForHttp(health, { timeoutMs: 15000, intervalMs: 250 });
  const body = await response.json();
  ok = response.status === 200 && body?.ok === true && body?.db?.enabled === true && body?.db?.connected === false;
  printResult('DB unavailable does not kill admin API health', ok, JSON.stringify(body.db));
} finally {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM');
    await new Promise(resolve => child.once('exit', resolve));
  }
}
process.exitCode = ok ? 0 : 1;
