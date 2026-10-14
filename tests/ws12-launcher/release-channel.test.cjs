const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash, webcrypto } = require('node:crypto');
const core = require('../../play-shell/launcher-core.js');
const releases = require('../../play-shell/release-channel.js');

function sha256(data) { return createHash('sha256').update(data).digest('hex'); }
function response(data, contentType = 'application/json; charset=utf-8') {
  const body = Buffer.isBuffer(data) ? data : Buffer.from(data);
  return { ok: true, status: 200, headers: { get: (name) => name.toLowerCase() === 'content-type' ? contentType : null }, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) };
}

function fixture() {
  const files = [
    ['index.html', 'html', 'text/html; charset=utf-8', Buffer.from('abc')],
    ['KnightOnLine.js', 'javascript', 'text/javascript; charset=utf-8', Buffer.from('js')],
    ['KnightOnLine.wasm', 'wasm', 'application/wasm', Buffer.from('wasm')],
    ['KnightOnLine.data', 'data', 'application/octet-stream', Buffer.from('data')]
  ];
  const manifest = {
    schemaVersion: 1,
    contentVersion: '1298-preview-test',
    buildId: 'accepted-test-build',
    createdAt: '2026-10-15T00:00:00Z',
    source: { commit: 'a'.repeat(40), ref: 'accepted-client-artifact' },
    immutableBasePath: '/releases/preview/immutable/test/',
    files: files.map(([path, role, contentType, body]) => ({ path, size: body.length, sha256: sha256(body), required: true, role, contentType }))
  };
  manifest.manifestChecksum = { algorithm: 'sha256', canonicalization: 'oldkoweb-json-v1', value: sha256(core.canonicalJson(manifest)) };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  const pointer = {
    schemaVersion: 1,
    channel: 'preview',
    release_id: 'preview-test',
    provider_set: `WS50-C5@sha256:${'7'.repeat(64)}`,
    client_artifact: { name: 'ws10-moradon-passing-client-26', digest: `sha256:${'f'.repeat(64)}` },
    manifest: '/releases/preview/immutable/test/manifest.json',
    content_digest: `sha256:${manifest.manifestChecksum.value}`,
    published_at: '2026-10-15T00:00:00Z',
    publishedAt: '2026-10-15T00:00:00Z',
    contentVersion: manifest.contentVersion,
    buildId: manifest.buildId,
    manifestPath: '/releases/preview/immutable/test/manifest.json',
    manifestFileSha256: sha256(manifestBytes),
    manifestChecksum: manifest.manifestChecksum.value,
    publicationMarkerPath: '/releases/preview/immutable/test/_complete.json',
    connection: { auth: '/auth', game: '/game' }
  };
  const marker = { schemaVersion: 1, contentVersion: manifest.contentVersion, buildId: manifest.buildId, publishedAt: pointer.published_at, manifestFileSha256: pointer.manifestFileSha256, manifestChecksum: pointer.manifestChecksum, fileCount: 4, requiredFileCount: 4 };
  const map = new Map([
    ['https://play.oldkoweb.com/releases/preview/latest.json', response(JSON.stringify(pointer))],
    ['https://play.oldkoweb.com/releases/preview/immutable/test/manifest.json', response(manifestBytes)],
    ['https://play.oldkoweb.com/releases/preview/immutable/test/_complete.json', response(JSON.stringify(marker))]
  ]);
  for (const [name, , contentType, body] of files) map.set(`https://play.oldkoweb.com/releases/preview/immutable/test/${name}`, response(body, contentType));
  return { manifest, pointer, marker, map };
}

test('preview pointer immutable WS50 + client artifact + WS38 identity olarak doğrulanır', () => {
  const { pointer } = fixture();
  const config = releases.normalizeReleaseConfig({ channel: 'preview' });
  assert.equal(releases.validateReleasePointer(core, pointer, config), pointer);
});

test('release preflight tek accepted pointerdan manifest, complete ve KnightOnLine üçlüsünü doğrular', async () => {
  const { map } = fixture();
  const raw = { publication: { latestUrl: '/releases/preview/latest.json', requirePublicationMarker: true, verifyRequiredFiles: true, strictContentType: true }, gateway: { required: true, endpoints: [] } };
  const config = core.normalizeConfig(raw);
  const releaseConfig = releases.normalizeReleaseConfig({ channel: 'preview', latestUrl: '/releases/preview/latest.json' });
  const events = [];
  const result = await releases.preflightRelease(core, config, releaseConfig, async (url) => map.get(String(url)) || { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }, webcrypto, 'https://play.oldkoweb.com/', (event) => events.push(event));
  assert.match(result.providerSet, /^WS50-C5@sha256:/);
  assert.equal(result.entryUrl, 'https://play.oldkoweb.com/releases/preview/immutable/test/index.html');
  assert.deepEqual(result.connection.endpoints, [{ name: 'auth', url: '/auth' }, { name: 'game', url: '/game' }]);
  assert.equal(events.at(-1).completedFiles, 4);
});

test('trycloudflare veya absolute gateway release pointerda reddedilir', () => {
  const { pointer } = fixture();
  pointer.connection.auth = 'wss://example.trycloudflare.com/auth';
  assert.throws(() => releases.validateReleasePointer(core, pointer, releases.normalizeReleaseConfig({ channel: 'preview' })), (error) => error.code === 'RELEASE_POINTER_INVALID');
});

test('production shell yalnız canonical play.oldkoweb.com hostunu kabul eder, localhost CI/dev istisnadır', () => {
  const config = releases.normalizeReleaseConfig({ canonicalHost: 'play.oldkoweb.com', allowLocalhost: true });
  assert.equal(releases.assertCanonicalLocation(core, config, 'https://play.oldkoweb.com/'), true);
  assert.equal(releases.assertCanonicalLocation(core, config, 'http://localhost:8129/play-shell/'), true);
  assert.throws(() => releases.assertCanonicalLocation(core, config, 'https://random.example/'), (error) => error.code === 'NON_CANONICAL_HOST');
});
