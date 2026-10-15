'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { RUNTIME_METHODS, assertRuntimeAuthority } = require(path.resolve(__dirname, '../../services/admin-api/src/production-contract'));

test('ADMIN_RUNTIME_AUTHORITY_MODULE exact interface fixture remains explicit', () => {
  assert.deepEqual([...RUNTIME_METHODS], ['listOnlineCharacters', 'getCharacterState', 'mutateOnlineCharacter']);
  const fixture = {
    async listOnlineCharacters() { return []; },
    async getCharacterState(name) { return { name, online: false }; },
    async mutateOnlineCharacter(input) { return input; }
  };
  assert.equal(assertRuntimeAuthority(fixture), fixture);
});

test('production refuses an incomplete runtime authority adapter', () => {
  assert.throws(
    () => assertRuntimeAuthority({ async listOnlineCharacters() {}, async getCharacterState() {} }),
    /mutateOnlineCharacter/
  );
});
