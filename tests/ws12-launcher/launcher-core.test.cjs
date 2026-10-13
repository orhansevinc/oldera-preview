const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../../play-shell/launcher-core.js');

const baseConfig = core.normalizeConfig({
  brand: { product: 'OldKOWeb', game: 'OldKO', patch: '1298' },
  cacheVersion: 'v1',
  client: {
    entryUrl: './client/index.html',
    buildUrl: './client/BUILD.txt',
    requiredFiles: ['./client/KnightOnLine.js', './client/KnightOnLine.wasm', './client/KnightOnLine.data']
  },
  gateway: { url: '', required: false }
});

function mockDoc(webgl2) {
  return { createElement() { return { getContext(name) { return name === 'webgl2' && webgl2 ? {} : null; } }; } };
}

function mockWasm(ok) {
  return { validate() { return ok; } };
}

test('successful startup preflight primitives pass against real package manifest', async () => {
  assert.equal(core.isWasmSupported(mockWasm(true)), true);
  assert.equal(core.isWebGL2Supported(mockDoc(true)), true);

  const seen = [];
  const fetchMock = async (url, options = {}) => {
    seen.push({ url, method: options.method || 'GET' });
    if (String(url).includes('BUILD.txt')) {
      return { ok: true, status: 200, text: async () => 'OldKOWeb real 1298 browser preview\nSource branch: openko-browser-port\nSource commit: abcdef1234567890\n' };
    }
    return { ok: true, status: 200, text: async () => '' };
  };

  const build = await core.fetchBuildMetadata(baseConfig, fetchMock, 'https://example.test/play-shell/');
  const files = await core.checkClientPackage(baseConfig, fetchMock, 'https://example.test/play-shell/');
  assert.equal(build.sourceBranch, 'openko-browser-port');
  assert.equal(build.sourceCommit, 'abcdef1234567890');
  assert.equal(files.length, 4);
  assert.equal(seen.filter((item) => item.method === 'HEAD').length, 4);
});

test('WASM yok durumu doğru tespit edilir', () => {
  assert.equal(core.isWasmSupported(null), core.isWasmSupported(globalThis.WebAssembly));
  assert.equal(core.isWasmSupported({ validate: () => false }), false);
  assert.match(core.userMessage(new core.LauncherError('WASM_UNSUPPORTED')), /WebAssembly/);
});

test('WebGL2 yok durumu doğru tespit edilir', () => {
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
  assert.equal(state.previous, 'v1');
  assert.match(core.versionedUrl('./client/index.html', 'v2', 'https://example.test/play-shell/'), /[?&]v=v2/);
});

test('client URL app.js içinde hardcode edilmez ve Three.js kullanılmaz', () => {
  const app = fs.readFileSync(path.join(__dirname, '../../play-shell/app.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '../../play-shell/index.html'), 'utf8');
  assert.doesNotMatch(app, /real1298|KnightOnLine\.(?:js|wasm|data)/);
  assert.doesNotMatch(app + html, /three(?:\.min)?\.js|THREE\./i);
});
