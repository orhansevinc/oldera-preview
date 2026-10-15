'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { statusFromBus, httpStatusFromBus, realApplyProven } = require(path.resolve(__dirname, '../../services/admin-api/src/ws28-command-executor'));

test('forwarded=false is PENDING/202 even when legacy bridge says ok/applied', () => {
  const result = { status: 'ok', forwarded: false, data: { applied: true } };
  assert.equal(realApplyProven(result), false);
  assert.equal(statusFromBus(result), 'PENDING');
  assert.equal(httpStatusFromBus(result), 202);
});

test('SUCCEEDED requires affirmative downstream apply evidence', () => {
  const applied = { status: 'ok', forwarded: true, data: { applied: true } };
  assert.equal(realApplyProven(applied), true);
  assert.equal(statusFromBus(applied), 'SUCCEEDED');
  assert.equal(httpStatusFromBus(applied), 200);

  const ambiguous = { status: 'ok' };
  assert.equal(realApplyProven(ambiguous), false);
  assert.equal(statusFromBus(ambiguous), 'FAILED');
});
