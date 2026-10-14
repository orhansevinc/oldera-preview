#!/usr/bin/env node
import crypto from 'node:crypto';
import tls from 'node:tls';

const base = process.argv[2];
const expectedVersion = process.argv[3] || '';
if (!base || !base.startsWith('https://')) {
  console.error('usage: ephemeral-public-smoke.mjs https://<temporary-host> [expected-content-version]');
  process.exit(2);
}

const origin = new URL(base).origin;
const host = new URL(base).host;

async function response(path, options = {}) {
  const url = new URL(path, `${origin}/`);
  const res = await fetch(url, { redirect: 'follow', cache: 'no-store', ...options });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res;
}

async function json(path) {
  return (await response(path)).json();
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function websocketUpgrade(path) {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString('base64');
    const socket = tls.connect({ host: new URL(origin).hostname, port: 443, servername: new URL(origin).hostname });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`WSS ${path} timeout`));
    }, 15000);
    let data = '';
    socket.setEncoding('utf8');
    socket.once('secureConnect', () => {
      socket.write([
        `GET ${path} HTTP/1.1`,
        `Host: ${host}`,
        'Connection: Upgrade',
        'Upgrade: websocket',
        'Sec-WebSocket-Version: 13',
        `Sec-WebSocket-Key: ${key}`,
        `Origin: ${origin}`,
        '',
        '',
      ].join('\r\n'));
    });
    socket.on('data', chunk => {
      data += chunk;
      if (!data.includes('\r\n\r\n')) return;
      clearTimeout(timer);
      socket.destroy();
      const status = data.split('\r\n', 1)[0];
      if (!/^HTTP\/1\.[01] 101\b/.test(status)) reject(new Error(`WSS ${path} expected 101, got ${status}`));
      else resolve();
    });
    socket.once('error', err => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

await response('/healthz');
await response('/play-shell/');
const config = await json('/play-shell/config.json');

const serializedConfig = JSON.stringify(config);
if (!serializedConfig.includes('/auth') || !serializedConfig.includes('/game')) {
  throw new Error('launcher config does not contain same-origin /auth and /game endpoints');
}

const latestRes = await response('/latest.json');
if ((latestRes.headers.get('cache-control') || '').toLowerCase().includes('no-store') === false) {
  throw new Error('latest.json is not served no-store');
}
const latestBytes = Buffer.from(await latestRes.arrayBuffer());
const latest = JSON.parse(latestBytes.toString('utf8'));
if (expectedVersion && latest.contentVersion !== expectedVersion) {
  throw new Error(`latest contentVersion ${latest.contentVersion} != ${expectedVersion}`);
}
if (!latest.manifestPath || !latest.publicationMarkerPath) {
  throw new Error('latest.json missing manifestPath/publicationMarkerPath');
}

const manifestRes = await response(`/${latest.manifestPath}`);
const manifestBytes = Buffer.from(await manifestRes.arrayBuffer());
if (sha256(manifestBytes) !== latest.manifestFileSha256) {
  throw new Error('latest manifestFileSha256 mismatch');
}
const manifest = JSON.parse(manifestBytes.toString('utf8'));
if (manifest.contentVersion !== latest.contentVersion || manifest.buildId !== latest.buildId) {
  throw new Error('latest.json identity does not match manifest');
}

const marker = await json(`/${latest.publicationMarkerPath}`);
for (const key of ['schemaVersion', 'contentVersion', 'buildId', 'manifestChecksum']) {
  const expected = key === 'manifestChecksum' ? manifest.manifestChecksum?.value : manifest[key];
  if (marker[key] !== expected) throw new Error(`publication marker ${key} mismatch`);
}
if (marker.manifestFileSha256 !== latest.manifestFileSha256) {
  throw new Error('publication marker manifestFileSha256 mismatch');
}

const basePath = manifest.immutableBasePath;
if (typeof basePath !== 'string' || !basePath.startsWith('/client-content/v1/')) {
  throw new Error(`unexpected immutableBasePath: ${basePath}`);
}

for (const file of manifest.files || []) {
  if (!file.required) continue;
  const res = await response(`${basePath}${file.path}`);
  const contentType = res.headers.get('content-type') || '';
  if (contentType !== file.contentType) {
    throw new Error(`${file.path} content-type ${contentType} != ${file.contentType}`);
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length !== file.size) throw new Error(`${file.path} size mismatch`);
  if (sha256(bytes) !== file.sha256) throw new Error(`${file.path} sha256 mismatch`);
}

await response('/gateway-auth-healthz');
await response('/gateway-game-healthz');
await websocketUpgrade('/auth');
await websocketUpgrade('/game');

console.log(`public staging smoke: PASS origin=${origin} contentVersion=${latest.contentVersion} auth=/auth game=/game`);
