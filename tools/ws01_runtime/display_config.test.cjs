const test = require('node:test');
const assert = require('node:assert/strict');
const display = require('./browser_display_pre.js');

test('viewport mode resolves exact common 16:9 desktop sizes', () => {
  for (const [width, height] of [[1280,720],[1366,768],[1600,900],[1920,1080]]) {
    const resolved = display.resolveDisplay({ mode: 'viewport' }, { innerWidth: width, innerHeight: height });
    assert.deepEqual([resolved.width, resolved.height], [width, height]);
    assert.equal(resolved.source, 'browser-viewport');
  }
});

test('classic mode preserves the native 1024x768 fallback', () => {
  const resolved = display.resolveDisplay({ mode: 'classic' }, { innerWidth: 1920, innerHeight: 1080 });
  assert.deepEqual([resolved.width, resolved.height], [1024, 768]);
});

test('fixed mode supports an explicit 1920x1080 native target', () => {
  const resolved = display.resolveDisplay({ mode: 'fixed', width: 1920, height: 1080 }, {});
  assert.deepEqual([resolved.width, resolved.height], [1920, 1080]);
});

test('viewport fallback is used below the configured minimum', () => {
  const resolved = display.resolveDisplay(
    { mode: 'viewport', minWidth: 1024, minHeight: 576, fallbackWidth: 1024, fallbackHeight: 768 },
    { innerWidth: 480, innerHeight: 320 }
  );
  assert.deepEqual([resolved.width, resolved.height], [1024, 768]);
  assert.equal(resolved.source, 'viewport-fallback');
});

test('max bounds preserve aspect ratio instead of stretching', () => {
  const resolved = display.resolveDisplay(
    { mode: 'fixed', width: 7680, height: 4320, maxWidth: 3840, maxHeight: 2160 },
    {}
  );
  assert.deepEqual([resolved.width, resolved.height], [3840, 2160]);
});

test('client pointer mapping follows the canvas backing store without distortion', () => {
  const canvas = {
    width: 1920,
    height: 1080,
    getBoundingClientRect() { return { left: 100, top: 50, width: 960, height: 540 }; }
  };
  assert.deepEqual(display.mapClientPoint(canvas, 580, 320), { x: 960, y: 540 });
  assert.deepEqual(display.mapClientPoint(canvas, 100, 50), { x: 0, y: 0 });
  assert.deepEqual(display.mapClientPoint(canvas, 1060, 590), { x: 1920, y: 1080 });
});

test('Alt+Enter delegates browser fullscreen from the input event and fullscreenchange marks display dirty', async () => {
  const winListeners = new Map();
  const docListeners = new Map();
  let requestCount = 0;
  let exitCount = 0;
  const doc = {
    fullscreenElement: null,
    documentElement: {
      requestFullscreen() { requestCount += 1; return Promise.resolve(); }
    },
    exitFullscreen() { exitCount += 1; return Promise.resolve(); },
    addEventListener(type, handler) { docListeners.set(type, handler); }
  };
  const win = {
    innerWidth: 1920,
    innerHeight: 1080,
    document: doc,
    addEventListener(type, handler) { winListeners.set(type, handler); }
  };
  const moduleObject = {
    oldkoDisplay: { mode: 'viewport' },
    canvas: { width: 1920, height: 1080, getBoundingClientRect() { return { left: 0, top: 0, width: 1920, height: 1080 }; } }
  };

  const state = display.installModuleDisplay(moduleObject, win, doc);
  const generation = state.generation;
  winListeners.get('keydown')({ altKey: true, code: 'Enter', repeat: false });
  await Promise.resolve();
  assert.equal(requestCount, 1);

  doc.fullscreenElement = doc.documentElement;
  winListeners.get('keydown')({ altKey: true, code: 'Enter', repeat: false });
  await Promise.resolve();
  assert.equal(exitCount, 1);

  docListeners.get('fullscreenchange')();
  assert.equal(state.lastBrowserEvent, 'fullscreenchange');
  assert.ok(state.generation > generation);
});

test('HiDPI diagnostic pointer mapping stays in SDL logical coordinates, not physical framebuffer pixels', () => {
  const canvas = {
    width: 3840,
    height: 2160,
    getBoundingClientRect() { return { left: 0, top: 0, width: 1920, height: 1080 }; }
  };
  assert.deepEqual(display.mapClientPoint(canvas, 960, 540, 1920, 1080), { x: 960, y: 540 });
});
