const test = require('node:test');
const assert = require('node:assert/strict');
const compat = require('../../tools/ws43_display/display-compat.js');

const SOURCE = { width: 1024, height: 768 };

function rounded(rect) {
  return {
    left: Math.round(rect.left * 1000) / 1000,
    top: Math.round(rect.top * 1000) / 1000,
    width: Math.round(rect.width * 1000) / 1000,
    height: Math.round(rect.height * 1000) / 1000
  };
}

const matrix = [
  { viewport: [1024, 768], expected: { left: 0, top: 0, width: 1024, height: 768 } },
  { viewport: [1280, 720], expected: { left: 160, top: 0, width: 960, height: 720 } },
  { viewport: [1366, 768], expected: { left: 171, top: 0, width: 1024, height: 768 } },
  { viewport: [1920, 1080], expected: { left: 240, top: 0, width: 1440, height: 1080 } }
];

for (const entry of matrix) {
  test(`1024x768 backing store fits ${entry.viewport[0]}x${entry.viewport[1]} without distortion`, () => {
    const result = compat.fitRect(SOURCE.width, SOURCE.height, entry.viewport[0], entry.viewport[1]);
    assert.deepEqual(rounded(result), entry.expected);
    assert.equal(result.width / result.height, SOURCE.width / SOURCE.height);
  });
}

test('portrait resize creates symmetric top/bottom letterboxing', () => {
  const result = compat.fitRect(1024, 768, 800, 1200);
  assert.deepEqual(rounded(result), { left: 0, top: 300, width: 800, height: 600 });
  assert.equal(result.letterbox.top, 300);
  assert.equal(result.letterbox.bottom, 300);
});

test('DPI does not participate in CSS fit geometry', () => {
  const normalDpi = compat.fitRect(1024, 768, 1280, 720);
  const highDpi = compat.fitRect(1024, 768, 1280, 720);
  assert.deepEqual(normalDpi, highDpi);
});

test('mouse center maps to backing-store center after CSS scale', () => {
  const mapped = compat.mapClientToCanvas(
    640,
    360,
    { left: 160, top: 0, width: 960, height: 720 },
    1024,
    768
  );
  assert.equal(mapped.x, 512);
  assert.equal(mapped.y, 384);
  assert.equal(mapped.inside, true);
});

test('mouse edge and letterbox clicks are classified correctly', () => {
  const rect = { left: 160, top: 0, width: 960, height: 720 };
  const edge = compat.mapClientToCanvas(1120, 720, rect, 1024, 768);
  assert.equal(edge.x, 1024);
  assert.equal(edge.y, 768);
  assert.equal(edge.inside, true);

  const outside = compat.mapClientToCanvas(80, 360, rect, 1024, 768);
  assert.equal(outside.inside, false);
  assert.ok(outside.x < 0);
});

test('invalid geometry is rejected instead of silently stretching', () => {
  assert.throws(() => compat.fitRect(0, 768, 1280, 720), /finite positive/);
  assert.throws(() => compat.mapClientToCanvas(0, 0, { left: 0, top: 0, width: 0, height: 1 }, 1024, 768), /finite positive/);
});
