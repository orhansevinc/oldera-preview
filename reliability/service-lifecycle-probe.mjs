import { spawn } from 'node:child_process';
import path from 'node:path';
import { printResult, waitForHttp } from './lib/guardrails.mjs';

const root = process.cwd();
const entry = path.join(root, 'server/src/index.js');
const port = Number(process.env.WS20_LIFECYCLE_PORT || 8791);
const health = `http://127.0.0.1:${port}/api/admin/health`;

function start() {
  const child = spawn(process.execPath, [entry], {
    cwd: path.join(root, 'server'),
    env: {
      ...process.env,
      PORT: String(port), NODE_ENV: 'test', KO_DB_ENABLED: 'false',
      ROOT_OWNER_USER: 'WS20_OWNER', ROOT_OWNER_PASSWORD: 'ws20-test-only-password',
      SESSION_SECRET: 'ws20-test-only-session-secret-32-bytes-minimum'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', d => process.stdout.write(`[server] ${d}`));
  child.stderr.on('data', d => process.stderr.write(`[server] ${d}`));
  return child;
}

async function stop(child) {
  return new Promise(resolve => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve({ code: null, signal: 'SIGKILL', timeout: true }); }, 5000);
    child.once('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal, timeout: false }); });
    child.kill('SIGTERM');
  });
}

let first = start();
await waitForHttp(health, { timeoutMs: 12000 });
printResult('service initial start', true, health);
const exit = await stop(first);
const graceful = exit.code === 0 && !exit.signal && !exit.timeout;
printResult('graceful SIGTERM shutdown', graceful, `code=${exit.code} signal=${exit.signal} timeout=${exit.timeout}`);

let second = start();
await waitForHttp(health, { timeoutMs: 12000 });
printResult('service restart recovery', true, health);
await stop(second);

process.exitCode = graceful ? 0 : 1;
