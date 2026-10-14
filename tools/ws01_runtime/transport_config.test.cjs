const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveTransport } = require('./browser_transport_pre.js');

function config(authEndpoint = '/auth', gameEndpoint = '/game') {
  return {
    routes: {
      auth: { serverPorts: [15100], endpoint: authEndpoint },
      game: { serverPorts: [15001], endpoint: gameEndpoint }
    }
  };
}

test('local HTTP maps AUTH to ws:// same-origin /auth', () => {
  const result = resolveTransport(
    config(),
    '127.0.0.1',
    15100,
    'http://localhost:8080/real1298/index.html'
  );
  assert.equal(result.role, 'auth');
  assert.equal(result.url, 'ws://localhost:8080/auth');
});

test('HTTPS maps AUTH to wss:// same-origin /auth', () => {
  const result = resolveTransport(
    config(),
    '10.10.0.5',
    15100,
    'https://temporary-staging.example/real1298/index.html'
  );
  assert.equal(result.role, 'auth');
  assert.equal(result.url, 'wss://temporary-staging.example/auth');
});

test('AUTH and GAME server ports resolve to distinct paths', () => {
  const cfg = config();
  const auth = resolveTransport(cfg, 'login.internal', 15100, 'https://stage.example/play/');
  const game = resolveTransport(cfg, 'game-advertised.internal', 15001, 'https://stage.example/play/');
  assert.equal(auth.role, 'auth');
  assert.equal(game.role, 'game');
  assert.equal(auth.url, 'wss://stage.example/auth');
  assert.equal(game.url, 'wss://stage.example/game');
});

test('explicit local ws:// endpoint remains supported on HTTP pages', () => {
  const result = resolveTransport(
    config('ws://127.0.0.1:19001/auth', 'ws://127.0.0.1:19002/game'),
    '127.0.0.1',
    15001,
    'http://127.0.0.1:8000/index.html'
  );
  assert.equal(result.url, 'ws://127.0.0.1:19002/game');
});

test('unconfigured transport fails closed', () => {
  assert.throws(
    () => resolveTransport(undefined, '127.0.0.1', 15100, 'http://localhost:8000/'),
    /configuration is missing/
  );
});

test('malformed or unsupported endpoint fails closed', () => {
  assert.throws(
    () => resolveTransport(config('ftp://stage.example/auth'), '127.0.0.1', 15100, 'https://stage.example/'),
    /unsupported endpoint protocol/
  );
});

test('unknown server-provided port fails instead of guessing a route', () => {
  assert.throws(
    () => resolveTransport(config(), 'server.internal', 9999, 'https://stage.example/'),
    /no browser route/
  );
});

test('ambiguous server-port mapping fails deterministically', () => {
  const cfg = config();
  cfg.routes.game.serverPorts = [15001, 15100];
  assert.throws(
    () => resolveTransport(cfg, 'server.internal', 15100, 'https://stage.example/'),
    /ambiguous browser route/
  );
});

test('HTTPS refuses explicit insecure ws:// endpoint', () => {
  assert.throws(
    () => resolveTransport(config('ws://stage.example/auth'), '127.0.0.1', 15100, 'https://stage.example/'),
    /HTTPS pages may not use an insecure ws:\/\//
  );
});
