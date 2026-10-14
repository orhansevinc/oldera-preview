const test = require('node:test');
const assert = require('node:assert/strict');
const display = require('./browser_display_pre.js');

for (const [width, height] of [[1280,720],[1366,768],[1600,900],[1920,1080]]) {
  test(`viewport mode resolves ${width}x${height}`, () => {
    const size = display.resolveDisplaySize({ mode: 'viewport' }, { innerWidth: width, innerHeight: height });
    assert.deepEqual(size, { width, height, mode: 'viewport', source: 'window' });
  });
}

test('visualViewport wins and keeps integer logical coordinates', () => {
  const size = display.resolveDisplaySize(
    { mode: 'viewport' },
    { innerWidth: 800, innerHeight: 600, visualViewport: { width: 1366.9, height: 768.8 } }
  );
  assert.equal(size.width, 1366);
  assert.equal(size.height, 768);
  assert.equal(size.source, 'visualViewport');
});

test('fixed mode supports an exact 1920x1080 runtime contract', () => {
  const size = display.resolveDisplaySize({ mode: 'fixed', width: 1920, height: 1080 }, {});
  assert.equal(size.width, 1920);
  assert.equal(size.height, 1080);
  assert.equal(size.mode, 'fixed');
});

test('classic mode is a deterministic 1024x768 fallback', () => {
  const size = display.resolveDisplaySize({ mode: 'classic' }, { innerWidth: 1920, innerHeight: 1080 });
  assert.equal(size.width, 1024);
  assert.equal(size.height, 768);
  assert.equal(size.mode, 'classic');
});

test('aspect fit and pointer mapping preserve native backing-store coordinates', () => {
  const fitted = display.fitRect(1920, 1080, 1600, 1000, 0, 0);
  assert.equal(Math.round(fitted.width), 1600);
  assert.equal(Math.round(fitted.height), 900);
  assert.equal(Math.round(fitted.top), 50);
  const mapped = display.mapClientToCanvas(
    fitted.left + fitted.width * 0.75,
    fitted.top + fitted.height * 0.25,
    fitted,
    1920,
    1080
  );
  assert.ok(Math.abs(mapped.x - 1440) < 1e-7);
  assert.ok(Math.abs(mapped.y - 270) < 1e-7);
  assert.equal(mapped.inside, true);
});
