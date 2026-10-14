const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash, webcrypto } = require('node:crypto');
const core = require('../../play-shell/launcher-core.js');

const baseConfig = core.normalizeConfig({
  brand: { product: 'OldKOWeb', game: 'OldKO', patch: '1298' },
  cacheVersion: 'v1',
  client: {
    entryUrl: './client/index.html',
    buildUrl: './client/BUILD.txt',
    requiredFiles: ['./client/KnightOnLine.js', './client/KnightOnLine.wasm', './client/KnightOnLine.data']
  },
  gateway: { endpoints: [], required: false }
});

function mockDoc(webgl2) {
  return { createElement() { return { getContext(name) { return name === 'webgl2' && webgl2 ? {} : null; } }; } };
}

function mockWasm(ok) {
  return { validate() { return ok; } };
}

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

function response(bytes, contentType = 'application/json; charset=utf-8') {
  const body = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return {
    ok: true,
    status: 200,
    headers: { get(name) { return name.toLowerCase() === 'content-type' ? contentType : null; } },
    arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
    text: async () => body.toString('utf8')
  };
}

function publicationFixture() {
  const manifest = {
    schemaVersion: 1,
    contentVersion: '1298-test.1',
    buildId: 'gh-test-123',
    createdAt: '2026-10-14T01:00:00Z',
    source: { commit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', ref: 'openko-browser-port' },
    immutableBasePath: '/client-content/v1/1298-test.1/',
    files: [
      { path: 'index.html', size: 3, sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', required: true, role: 'html', contentType: 'text/html; charset=utf-8' },
      { path: 'KnightOnLine.wasm', size: 4, sha256: '336154bf67f765f8f75d16a0accee61b5ee5f6a75b2a2905703df913bd550f3e', required: true, role: 'wasm', contentType: 'application/wasm' }
    ],
    manifestChecksum: {
      algorithm: 'sha256',
      canonicalization: 'oldkoweb-json-v1',
      value: 'b789358020b3b422e6da5163ee963c8c872ba2aa4b685a547b2e9c30020da363'
    }
  };
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
  const manifestFileSha256 = sha256(manifestBytes);
  const pointer = {
    schemaVersion: 1,
    contentVersion: manifest.contentVersion,
    buildId: manifest.buildId,
    publishedAt: '2026-10-14T01:01:00Z',
    manifestPath: 'client-content/v1/1298-test.1/manifest.json',
    manifestFileSha256,
    manifestChecksum: manifest.manifestChecksum.value,
    publicationMarkerPath: 'client-content/v1/1298-test.1/_complete.json'
  };
  const marker = {
    schemaVersion: 1,
    contentVersion: manifest.contentVersion,
    buildId: manifest.buildId,
    publishedAt: '2026-10-14T01:01:00Z',
    manifestFileSha256,
    manifestChecksum: manifest.manifestChecksum.value,
    fileCount: 2,
    requiredFileCount: 2
  };
  return { manifest, manifestBytes, pointer, marker };
}

test('successful startup preflight primitives pass against legacy real package config', async () => {
  assert.equal(core.isWasmSupported(mockWasm(true)), true);
  assert.equal(core.isWebGL2Supported(mockDoc(true)), true);
  const seen = [];
  const fetchMock = async (url, options = {}) => {
    seen.push({ url, method: options.method || 'GET' });
    if (String(url).includes('BUILD.txt')) return { ok: true, status: 200, text: async () => 'OldKOWeb real 1298 browser preview\nSource branch: openko-browser-port\nSource commit: abcdef1234567890\n' };
    return { ok: true, status: 200, text: async () => '' };
  };
  const build = await core.fetchBuildMetadata(baseConfig, fetchMock, 'https://example.test/play-shell/');
  const files = await core.checkClientPackage(baseConfig, fetchMock, 'https://example.test/play-shell/');
  assert.equal(build.sourceBranch, 'openko-browser-port');
  assert.equal(files.length, 4);
  assert.equal(seen.filter((item) => item.method === 'HEAD').length, 4);
});

test('WASM ve WebGL2 yok durumları doğru tespit edilir', () => {
  assert.equal(core.isWasmSupported({ validate: () => false }), false);
  assert.equal(core.isWebGL2Supported(mockDoc(false)), false);
  assert.match(core.userMessage(new core.LauncherError('WEBGL2_UNSUPPORTED')), /WebGL2/);
});

test('client 404 anlaşılır paket hatasına dönüşür', async () => {
  const fetchMock = async (url) => ({ ok: !String(url).includes('KnightOnLine.wasm'), status: String(url).includes('KnightOnLine.wasm') ? 404 : 200 });
  await assert.rejects(
    () => core.checkClientPackage(baseConfig, fetchMock, 'https://example.test/play-shell/'),
    (error) => error.code === 'CLIENT_PACKAGE_404' && /KnightOnLine\.wasm/.test(error.details.url)
  );
});

test('cache version değişikliği URL ve storage durumunu değiştirir', () => {
  const store = new Map([['oldkoweb.play-shell.cacheVersion', 'v1']]);
  const storage = { getItem: (key) => store.has(key) ? store.get(key) : null, setItem: (key, value) => store.set(key, value) };
  const state = core.rememberCacheVersion(storage, 'oldkoweb.play-shell.cacheVersion', 'v2');
  assert.equal(state.changed, true);
  assert.match(core.versionedUrl('./client/index.html', 'v2', 'https://example.test/play-shell/'), /[?&]v=v2/);
});

test('WS38 canonical checksum bağımsız sabit vektörle eşleşir', async () => {
  const { manifest } = publicationFixture();
  assert.equal(await core.verifyManifestChecksum(manifest, webcrypto), manifest.manifestChecksum.value);
});

test('WS38 latest -> manifest -> _complete -> required file zinciri PASS olur', async () => {
  const fixture = publicationFixture();
  const config = core.normalizeConfig({
    publication: { latestUrl: '/client-content/latest.json', requirePublicationMarker: true, verifyRequiredFiles: true, strictContentType: true },
    gateway: { endpoints: [] }
  });
  const map = new Map([
    ['https://stage.example/client-content/latest.json', response(JSON.stringify(fixture.pointer))],
    ['https://stage.example/client-content/v1/1298-test.1/manifest.json', response(fixture.manifestBytes)],
    ['https://stage.example/client-content/v1/1298-test.1/_complete.json', response(JSON.stringify(fixture.marker))],
    ['https://stage.example/client-content/v1/1298-test.1/index.html', response('abc', 'text/html; charset=utf-8')],
    ['https://stage.example/client-content/v1/1298-test.1/KnightOnLine.wasm', response('wasm', 'application/wasm')]
  ]);
  const fetchMock = async (url) => map.get(String(url)) || { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
  const release = await core.preflightPublication(config, fetchMock, webcrypto, 'https://stage.example/play-shell/');
  assert.equal(release.contentVersion, '1298-test.1');
  assert.equal(release.entryUrl, 'https://stage.example/client-content/v1/1298-test.1/index.html');
  assert.equal(release.requiredFileCount, 2);
  assert.equal(release.verifiedFiles.length, 2);
});

test('manifest exact file hash bozulursa fail-closed olur', async () => {
  const fixture = publicationFixture();
  fixture.pointer.manifestFileSha256 = '0'.repeat(64);
  const config = core.normalizeConfig({ publication: { latestUrl: '/client-content/latest.json' } });
  const fetchMock = async (url) => String(url).endsWith('latest.json') ? response(JSON.stringify(fixture.pointer)) : response(fixture.manifestBytes);
  await assert.rejects(() => core.preflightPublication(config, fetchMock, webcrypto, 'https://stage.example/play-shell/'), (error) => error.code === 'CONTENT_MANIFEST_FILE_HASH');
});

test('_complete eksikse production publication preflight reddeder', async () => {
  const fixture = publicationFixture();
  delete fixture.pointer.publicationMarkerPath;
  const config = core.normalizeConfig({ publication: { latestUrl: '/client-content/latest.json', requirePublicationMarker: true } });
  const fetchMock = async (url) => String(url).endsWith('latest.json') ? response(JSON.stringify(fixture.pointer)) : response(fixture.manifestBytes);
  await assert.rejects(() => core.preflightPublication(config, fetchMock, webcrypto, 'https://stage.example/play-shell/'), (error) => error.code === 'CONTENT_PUBLICATION_INCOMPLETE');
});

test('strict MIME mismatch WS38 sözleşmesini fail eder', async () => {
  const fixture = publicationFixture();
  const config = core.normalizeConfig({ publication: { latestUrl: '/client-content/latest.json', requirePublicationMarker: true, strictContentType: true } });
  const map = new Map([
    ['https://stage.example/client-content/latest.json', response(JSON.stringify(fixture.pointer))],
    ['https://stage.example/client-content/v1/1298-test.1/manifest.json', response(fixture.manifestBytes)],
    ['https://stage.example/client-content/v1/1298-test.1/_complete.json', response(JSON.stringify(fixture.marker))],
    ['https://stage.example/client-content/v1/1298-test.1/index.html', response('abc', 'text/html; charset=utf-8')],
    ['https://stage.example/client-content/v1/1298-test.1/KnightOnLine.wasm', response('wasm', 'application/octet-stream')]
  ]);
  await assert.rejects(
    () => core.preflightPublication(config, async (url) => map.get(String(url)), webcrypto, 'https://stage.example/play-shell/'),
    (error) => error.code === 'CONTENT_TYPE_MISMATCH' && error.details.expected === 'application/wasm'
  );
});

test('same-origin auth/game yolları HTTPS altında WSS endpointlerine dönüşür', () => {
  assert.equal(core.resolveWebSocketUrl('/auth', 'https://stage.example/play-shell/'), 'wss://stage.example/auth');
  assert.equal(core.resolveWebSocketUrl('/game', 'http://localhost:8080/play-shell/'), 'ws://localhost:8080/game');
  const config = core.normalizeConfig({ publication: { latestUrl: '/client-content/latest.json' }, gateway: { required: true, endpoints: [{ name: 'auth', url: '/auth' }, { name: 'game', url: '/game' }] } });
  assert.deepEqual(config.gateway.endpoints.map((e) => e.name), ['auth', 'game']);
});

test('client URL app.js içinde hardcode edilmez ve Three.js kullanılmaz', () => {
  const app = fs.readFileSync(path.join(__dirname, '../../play-shell/app.js'), 'utf8');
  assert.doesNotMatch(app, /real1298|KnightOnLine\.(?:js|wasm|data)/);
  assert.doesNotMatch(app, /three(?:\.min)?\.js|THREE\./i);
});
