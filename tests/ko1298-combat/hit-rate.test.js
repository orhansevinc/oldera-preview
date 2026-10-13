'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { HIT_OUTCOME, outcomeForRoll } = require('../../services/ko1298-combat');

test('source hit bands are preserved at high ratio', () => {
  assert.equal(outcomeForRoll(5, 3500), HIT_OUTCOME.GREAT_SUCCESS);
  assert.equal(outcomeForRoll(5, 3501), HIT_OUTCOME.SUCCESS);
  assert.equal(outcomeForRoll(5, 7501), HIT_OUTCOME.NORMAL);
  assert.equal(outcomeForRoll(5, 9801), HIT_OUTCOME.FAIL);
});

test('source hit bands are preserved below 0.2 ratio', () => {
  assert.equal(outcomeForRoll(0.1, 200), HIT_OUTCOME.GREAT_SUCCESS);
  assert.equal(outcomeForRoll(0.1, 201), HIT_OUTCOME.SUCCESS);
  assert.equal(outcomeForRoll(0.1, 1001), HIT_OUTCOME.NORMAL);
  assert.equal(outcomeForRoll(0.1, 5001), HIT_OUTCOME.FAIL);
});
