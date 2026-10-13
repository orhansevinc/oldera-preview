import fs from 'node:fs/promises';
import path from 'node:path';
import { printResult } from '../reliability/lib/guardrails.mjs';

const root = process.cwd();
const sourcePath = path.join(root, 'server/src/index.js');
const source = await fs.readFile(sourcePath, 'utf8');
const findings = [];
const passes = [];

function finding(severity, id, detail) { findings.push({ severity, id, detail }); }
function pass(id, detail) { passes.push({ id, detail }); }

if (/SESSION_SECRET\s*\|\|\s*['"]dev-only-change-me['"]/.test(source)) {
  finding('HIGH', 'WS20-SEC-001', 'Predictable cookie-session signing key fallback is present. A production deployment missing SESSION_SECRET would use a public fixed key.');
} else {
  pass('session-secret', 'No known fixed cookie-session fallback detected.');
}

if (/app\.set\(\s*['"]trust proxy['"]\s*,\s*1\s*\)/.test(source)) {
  finding('MEDIUM', 'WS20-SEC-002', 'Numeric trust proxy=1 makes IP-based rate limiting topology-dependent and can be unsafe if the app is reachable without exactly one trusted proxy hop.');
} else {
  pass('trust-proxy', 'No hard-coded numeric trust-proxy=1 pattern detected.');
}

if (!/process\.on\(\s*['"]SIGTERM['"]/.test(source) || !/process\.on\(\s*['"]SIGINT['"]/.test(source)) {
  finding('MEDIUM', 'WS20-REL-001', 'Explicit SIGTERM/SIGINT graceful-shutdown handlers are not present in the server entry point.');
} else {
  pass('graceful-signals', 'SIGTERM and SIGINT handlers found.');
}

if (/express\.json\(\{\s*limit\s*:\s*['"]256kb['"]\s*\}\)/.test(source)) pass('http-body-limit', '256kb JSON body limit is configured.');
else finding('MEDIUM', 'WS20-SEC-003', 'Expected bounded JSON body parser limit was not detected.');

if (/const\s+loginLimiter\s*=\s*rateLimit/.test(source) && /session\/login['"],\s*loginLimiter/.test(source)) pass('login-rate-limit', 'Login route has a dedicated rate limiter.');
else finding('HIGH', 'WS20-SEC-004', 'Dedicated login rate limiter was not detected on the owner login route.');

const guardIndex = source.indexOf("app.use('/api/admin', requireOwner)");
const playersIndex = source.indexOf("app.get('/api/admin/players'");
const commandsIndex = source.indexOf("app.post('/api/admin/commands'");
if (guardIndex !== -1 && playersIndex > guardIndex && commandsIndex > guardIndex) pass('admin-auth-guard', 'Protected admin routes appear after the requireOwner middleware.');
else finding('CRITICAL', 'WS20-SEC-005', 'Admin route ordering may expose privileged routes before requireOwner.');

for (const p of passes) printResult(p.id, true, p.detail);
for (const f of findings) printResult(`${f.severity} ${f.id}`, false, f.detail);
console.log(JSON.stringify({ passes, findings }, null, 2));

const blocking = findings.some(f => f.severity === 'CRITICAL' || f.severity === 'HIGH');
process.exitCode = blocking ? 1 : 0;
