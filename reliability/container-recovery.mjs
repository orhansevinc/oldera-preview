import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { assertLocalTarget, printResult, waitForHttp } from './lib/guardrails.mjs';

const compose = process.env.WS20_COMPOSE_FILE;
const service = process.env.WS20_COMPOSE_SERVICE;
const health = process.env.WS20_CONTAINER_HEALTH_URL;
if (!compose || !service || !health) {
  console.log('[SKIP] Container recovery requires WS20_COMPOSE_FILE, WS20_COMPOSE_SERVICE and WS20_CONTAINER_HEALTH_URL after WS09 integration.');
  process.exit(0);
}
if (!fs.existsSync(compose)) throw new Error(`compose file not found: ${compose}`);
assertLocalTarget(health, 'container health target');
function docker(...args) {
  const r = spawnSync('docker', ['compose', '-f', compose, ...args], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`docker compose ${args.join(' ')} failed with ${r.status}`);
}
docker('stop', service);
docker('start', service);
await waitForHttp(health, { timeoutMs: 30000, intervalMs: 500 });
printResult('container recovery', true, `${service} recovered and health endpoint became ready`);
