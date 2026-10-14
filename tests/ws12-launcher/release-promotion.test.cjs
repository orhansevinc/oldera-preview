const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const core = require('../../play-shell/launcher-core.js');
const cli = require('../../tools/ws12_launcher/release-channel.cjs');

function sha256(data) { return createHash('sha256').update(data).digest('hex'); }

function makeRelease(root, id, providerChar, artifactChar) {
  const basePublic = `/releases/preview/immutable/${id}/`;
  const base = path.join(root, basePublic.replace(/^\//, ''));
  fs.mkdirSync(base, { recursive: true });
  const content = {
    'index.html': Buffer.from(`<p>${id}</p>`),
    'KnightOnLine.js': Buffer.from(`js-${id}`),
    'KnightOnLine.wasm': Buffer.from(`wasm-${id}`),
    'KnightOnLine.data': Buffer.from(`data-${id}`)
  };
  const type = { 'index.html': 'text/html; charset=utf-8', 'KnightOnLine.js': 'text/javascript; charset=utf-8', 'KnightOnLine.wasm': 'application/wasm', 'KnightOnLine.data': 'application/octet-stream' };
  const role = { 'index.html': 'html', 'KnightOnLine.js': 'javascript', 'KnightOnLine.wasm': 'wasm', 'KnightOnLine.data': 'data' };
  for (const [name, bytes] of Object.entries(content)) fs.writeFileSync(path.join(base, name), bytes);
  const manifest = {
    schemaVersion: 1,
    contentVersion: id,
    buildId: `build-${id}`,
    createdAt: '2026-10-15T00:00:00Z',
    source: { commit: providerChar.repeat(40).slice(0, 40), ref: 'accepted-client-artifact' },
    immutableBasePath: basePublic,
    files: Object.entries(content).map(([name, bytes]) => ({ path: name, size: bytes.length, sha256: sha256(bytes), required: true, role: role[name], contentType: type[name] }))
  };
  manifest.manifestChecksum = { algorithm: 'sha256', canonicalization: 'oldkoweb-json-v1', value: sha256(core.canonicalJson(manifest)) };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(base, 'manifest.json'), manifestBytes);
  const pointer = {
    schemaVersion: 1,
    channel: 'preview',
    release_id: id,
    provider_set: `WS50-C5@sha256:${providerChar.repeat(64).slice(0, 64)}`,
    client_artifact: { name: `artifact-${id}`, digest: `sha256:${artifactChar.repeat(64).slice(0, 64)}` },
    manifest: `${basePublic}manifest.json`,
    content_digest: `sha256:${manifest.manifestChecksum.value}`,
    published_at: '2026-10-15T00:00:00Z',
    publishedAt: '2026-10-15T00:00:00Z',
    contentVersion: id,
    buildId: manifest.buildId,
    manifestPath: `${basePublic}manifest.json`,
    manifestFileSha256: sha256(manifestBytes),
    manifestChecksum: manifest.manifestChecksum.value,
    publicationMarkerPath: `${basePublic}_complete.json`,
    connection: { auth: '/auth', game: '/game' }
  };
  const marker = { schemaVersion: 1, contentVersion: id, buildId: manifest.buildId, publishedAt: pointer.published_at, manifestFileSha256: pointer.manifestFileSha256, manifestChecksum: pointer.manifestChecksum, fileCount: 4, requiredFileCount: 4 };
  fs.writeFileSync(path.join(base, '_complete.json'), `${JSON.stringify(marker, null, 2)}\n`);
  const candidate = path.join(root, `${id}.pointer.json`);
  fs.writeFileSync(candidate, `${JSON.stringify(pointer, null, 2)}\n`);
  return { base, pointer, candidate };
}

test('partial upload latest pointerı değiştirmez; doğrulanmış candidate atomic promote edilir', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws12-promote-'));
  const a = makeRelease(root, 'release-a', 'a', 'b');
  const b = makeRelease(root, 'release-b', 'c', 'd');
  const latest = path.join(root, 'releases/preview/latest.json');
  fs.mkdirSync(path.dirname(latest), { recursive: true });
  fs.writeFileSync(latest, `${JSON.stringify(a.pointer, null, 2)}\n`);
  const before = fs.readFileSync(latest, 'utf8');

  fs.unlinkSync(path.join(b.base, 'KnightOnLine.data'));
  assert.throws(() => cli.promote(root, b.candidate), /ENOENT/);
  assert.equal(fs.readFileSync(latest, 'utf8'), before);

  fs.writeFileSync(path.join(b.base, 'KnightOnLine.data'), Buffer.from('data-release-b'));
  const result = cli.promote(root, b.candidate);
  assert.equal(JSON.parse(fs.readFileSync(latest, 'utf8')).release_id, 'release-b');
  assert.ok(result.archived && fs.existsSync(result.archived));
});

test('rollback doğrulanmış history pointerını aynı atomic swap ile geri alır', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws12-rollback-'));
  const a = makeRelease(root, 'release-a', 'a', 'b');
  const b = makeRelease(root, 'release-b', 'c', 'd');
  cli.promote(root, a.candidate);
  const promotedB = cli.promote(root, b.candidate);
  assert.equal(JSON.parse(fs.readFileSync(promotedB.latestFile, 'utf8')).release_id, 'release-b');
  cli.promote(root, promotedB.archived);
  assert.equal(JSON.parse(fs.readFileSync(promotedB.latestFile, 'utf8')).release_id, 'release-a');
});
