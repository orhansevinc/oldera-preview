'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CharacterLifecycleService,
  DeleteCode,
  LifecycleDomainError,
  LifecycleState,
  LegacyDeletePacket1298,
  validateDeleteRequest
} = require('../../services/ko1298-character-lifecycle');

function makeFixture(overrides = {}) {
  const state = {
    character: {
      id: 'OrhanRogue',
      name: 'OrhanRogue',
      accountId: 'acct-1',
      slotIndex: 1,
      lifecycleState: LifecycleState.ACTIVE
    },
    deleted: false,
    nameReleased: false,
    audit: [],
    cleanup: [],
    selectedCharacterId: null,
    online: false,
    confirmationOk: true,
    fenceCalls: 0,
    failAt: null
  };

  const characterRepository = {
    async findOwnedCharacter(input) {
      const c = state.character;
      if (!c || c.accountId !== input.accountId || c.id !== input.characterId || c.slotIndex !== input.slotIndex) return null;
      return { ...c };
    },
    async runDeleteTransaction(_ctx, callback) {
      const snapshot = structuredClone(state);
      const unitOfWork = {
        async lockOwnedCharacter(input) {
          const c = state.character;
          return Boolean(c && c.accountId === input.accountId && c.id === input.characterId && c.slotIndex === input.slotIndex);
        },
        async setLifecycleState({ state: next }) {
          state.character.lifecycleState = next;
        },
        async releaseCharacterName() {
          if (state.failAt === 'name') throw new Error('name cleanup failed');
          state.nameReleased = true;
        },
        async deleteCharacter() {
          if (state.failAt === 'delete') throw new Error('delete failed');
          state.deleted = true;
          state.character = null;
        },
        async appendAuditEvent(event) {
          if (state.failAt === 'audit') throw new Error('audit failed');
          state.audit.push(event);
        }
      };

      try {
        return await callback(unitOfWork);
      } catch (error) {
        Object.keys(state).forEach((key) => delete state[key]);
        Object.assign(state, snapshot);
        throw error;
      }
    }
  };

  const sessionGuard = {
    async getSelectedCharacterId() {
      return state.selectedCharacterId;
    },
    async isCharacterOnline() {
      return state.online;
    },
    async runWithDeleteFence(_ctx, callback) {
      state.fenceCalls += 1;
      return callback();
    }
  };

  const service = new CharacterLifecycleService({
    characterRepository,
    confirmationVerifier: {
      async verify() {
        return state.confirmationOk;
      }
    },
    sessionGuard,
    inventoryCleanup: {
      async cleanupCharacterInventory({ unitOfWork }) {
        state.cleanup.push('inventory');
        if (state.failAt === 'inventory') throw new Error('inventory cleanup failed');
        assert.ok(unitOfWork);
      }
    },
    clanCleanup: {
      async cleanupCharacterMembership() {
        state.cleanup.push('clan');
        if (state.failAt === 'clan') throw new Error('clan cleanup failed');
      }
    },
    friendCleanup: {
      async cleanupCharacterRelations() {
        state.cleanup.push('friends');
        if (state.failAt === 'friends') throw new Error('friend cleanup failed');
      }
    },
    clock: () => new Date('2026-10-14T00:00:00.000Z'),
    eventIdFactory: () => 'evt-46',
    ...overrides
  });

  return { service, state };
}

async function expectCode(promise, code) {
  await assert.rejects(promise, (error) => error instanceof LifecycleDomainError && error.code === code);
}

test('1298 delete protocol contract is opcode 0x03 with three slots and success 0x01', () => {
  assert.equal(LegacyDeletePacket1298.opcode, 0x03);
  assert.equal(LegacyDeletePacket1298.successResult, 0x01);
  assert.equal(LegacyDeletePacket1298.failedSlot, 0xff);
});

test('request validation enforces 1298 slot range and 1-31 byte confirmation key', () => {
  assert.doesNotThrow(() => validateDeleteRequest({ accountId: 'a', characterId: 'c', slotIndex: 2, confirmationKey: '1234' }));
  assert.throws(() => validateDeleteRequest({ accountId: 'a', characterId: 'c', slotIndex: 3, confirmationKey: '1234' }), /slotIndex/);
  assert.throws(() => validateDeleteRequest({ accountId: 'a', characterId: 'c', slotIndex: 1, confirmationKey: 'x'.repeat(32) }), /1-31/);
});

test('successful delete cleans character-scoped domains, releases name, preserves account inn, and writes safe audit', async () => {
  const { service, state } = makeFixture();
  const result = await service.deleteCharacter({
    accountId: 'acct-1', characterId: 'OrhanRogue', slotIndex: 1, confirmationKey: 'legacy-secret'
  });

  assert.equal(result.code, DeleteCode.DELETED);
  assert.equal(state.deleted, true);
  assert.equal(state.nameReleased, true);
  assert.deepEqual(state.cleanup, ['inventory', 'clan', 'friends']);
  assert.equal(state.fenceCalls, 1);
  assert.equal(state.audit.length, 1);
  assert.equal(state.audit[0].accountScopedInnPreserved, true);
  assert.equal(state.audit[0].confirmationSecretRecorded, false);
  assert.equal(JSON.stringify(state.audit[0]).includes('legacy-secret'), false);
});

test('account ownership and slot ownership are mandatory', async () => {
  const { service } = makeFixture();
  await expectCode(service.deleteCharacter({ accountId: 'other', characterId: 'OrhanRogue', slotIndex: 1, confirmationKey: 'x' }), DeleteCode.NOT_OWNED);
  await expectCode(service.deleteCharacter({ accountId: 'acct-1', characterId: 'OrhanRogue', slotIndex: 0, confirmationKey: 'x' }), DeleteCode.NOT_OWNED);
});

test('selected character cannot be deleted', async () => {
  const { service, state } = makeFixture();
  state.selectedCharacterId = 'OrhanRogue';
  await expectCode(service.deleteCharacter({ accountId: 'acct-1', characterId: 'OrhanRogue', slotIndex: 1, confirmationKey: 'x' }), DeleteCode.CHARACTER_SELECTED);
  assert.equal(state.deleted, false);
});

test('online character cannot be deleted', async () => {
  const { service, state } = makeFixture();
  state.online = true;
  await expectCode(service.deleteCharacter({ accountId: 'acct-1', characterId: 'OrhanRogue', slotIndex: 1, confirmationKey: 'x' }), DeleteCode.CHARACTER_ONLINE);
  assert.equal(state.deleted, false);
});

test('confirmation requirement is enforced without storing the secret', async () => {
  const { service, state } = makeFixture();
  state.confirmationOk = false;
  await expectCode(service.deleteCharacter({ accountId: 'acct-1', characterId: 'OrhanRogue', slotIndex: 1, confirmationKey: 'wrong' }), DeleteCode.CONFIRMATION_FAILED);
  assert.equal(state.audit.length, 0);
});

test('any cleanup failure rolls back lifecycle state, name release, deletion and audit', async () => {
  const { service, state } = makeFixture();
  state.failAt = 'friends';
  await expectCode(service.deleteCharacter({ accountId: 'acct-1', characterId: 'OrhanRogue', slotIndex: 1, confirmationKey: 'x' }), DeleteCode.DELETE_FAILED);
  assert.equal(state.character.lifecycleState, LifecycleState.ACTIVE);
  assert.equal(state.deleted, false);
  assert.equal(state.nameReleased, false);
  assert.deepEqual(state.audit, []);
});

test('audit failure also rolls back hard deletion and name release', async () => {
  const { service, state } = makeFixture();
  state.failAt = 'audit';
  await expectCode(service.deleteCharacter({ accountId: 'acct-1', characterId: 'OrhanRogue', slotIndex: 1, confirmationKey: 'x' }), DeleteCode.DELETE_FAILED);
  assert.ok(state.character);
  assert.equal(state.character.lifecycleState, LifecycleState.ACTIVE);
  assert.equal(state.deleted, false);
  assert.equal(state.nameReleased, false);
});

test('service intentionally exposes no restore or recovery method', () => {
  const { service } = makeFixture();
  assert.equal(typeof service.restoreCharacter, 'undefined');
  assert.equal(typeof service.recoverCharacter, 'undefined');
});
