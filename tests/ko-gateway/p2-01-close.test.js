'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { decodeCloseFrame } = require('../../services/ko-gateway/src/gateway');

test('websocket close payload preserves close code and reason for P2-01 diagnostics', () => {
  const payload = Buffer.alloc(2 + Buffer.byteLength('sprint-policy-test'));
  payload.writeUInt16BE(1011, 0);
  payload.write('sprint-policy-test', 2, 'utf8');
  assert.deepEqual(decodeCloseFrame(payload), { code: 1011, reason: 'sprint-policy-test' });
});

test('empty websocket close payload is normalized as clean close', () => {
  assert.deepEqual(decodeCloseFrame(Buffer.alloc(0)), { code: 1000, reason: '' });
});