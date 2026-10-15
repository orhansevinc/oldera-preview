'use strict';

const {
  assertPositiveId,
  assertInventorySlot,
  assertInnPosition,
  emptyState,
  createEmptyInventory,
  cloneState,
  listItems,
  assertNoDuplicateSerials,
  assertConserved,
  validateItem,
} = require('./model');
const { fail } = require('./errors');

class Mutex {
  constructor() {
    this.tail = Promise.resolve();
  }

  async run(work) {
    const previous = this.tail;
    let release;
    this.tail = new Promise(resolve => { release = resolve; });
    await previous;
    try {
      return await work();
    } finally {
      release();
    }
  }
}

class InMemoryInnRepository {
  constructor({ duplicateSerialHook = null } = {}) {
    this.states = new Map();
    this.accountLocks = new Map();
    this.commitLock = new Mutex();
    this.serialOwners = new Map();
    this.duplicateSerialHook = duplicateSerialHook;
  }

  _key(accountId) {
    return String(assertPositiveId(accountId, 'accountId'));
  }

  _lockFor(accountId) {
    const key = this._key(accountId);
    if (!this.accountLocks.has(key)) this.accountLocks.set(key, new Mutex());
    return this.accountLocks.get(key);
  }

  async read(accountId) {
    const key = this._key(accountId);
    return cloneState(this.states.get(key) || emptyState(Number(key)));
  }

  async readInn(accountId) {
    const state = await this.read(accountId);
    return { accountId: state.accountId, version: state.version, inn: state.inn };
  }

  async seedAccount(accountId, { characters = {}, inn = [] } = {}) {
    const key = this._key(accountId);
    return this._lockFor(key).run(async () => {
      if (this.states.has(key)) fail('ACCOUNT_ALREADY_SEEDED', 'Account already exists in repository.', { accountId: Number(key) });
      const state = emptyState(Number(key));
      for (const [rawCharacterId, rawInventory] of Object.entries(characters)) {
        const characterId = assertPositiveId(rawCharacterId, 'characterId');
        const inventory = createEmptyInventory();
        if (Array.isArray(rawInventory)) {
          for (let slot = 0; slot < rawInventory.length; slot++) {
            if (rawInventory[slot] == null) continue;
            assertInventorySlot(slot);
            validateItem(rawInventory[slot]);
            inventory[slot] = { ...rawInventory[slot] };
          }
        } else {
          for (const [rawSlot, item] of Object.entries(rawInventory || {})) {
            const slot = assertInventorySlot(rawSlot);
            validateItem(item);
            inventory[slot] = { ...item };
          }
        }
        state.characters[String(characterId)] = { characterId, inventory };
      }
      for (const placement of inn) {
        const { flatSlot } = assertInnPosition(placement.page, placement.slot);
        if (state.inn[flatSlot]) fail('SLOT_OCCUPIED', 'Inn seed slot is occupied.', placement);
        validateItem(placement.item);
        state.inn[flatSlot] = { ...placement.item };
      }
      assertNoDuplicateSerials(state);
      await this.commitLock.run(async () => {
        this._validateGlobalSerials(key, state);
        this._replaceSerialIndex(key, null, state);
        state.version = 1;
        this.states.set(key, cloneState(state));
      });
      return this.read(Number(key));
    });
  }

  async transact({ accountId, characterId, signal = null }, work) {
    if (typeof work !== 'function') fail('INVALID_TRANSACTION', 'Transaction work callback is required.');
    const key = this._key(accountId);
    const cid = assertPositiveId(characterId, 'characterId');

    return this._lockFor(key).run(async () => {
      this._assertNotAborted(signal);
      const committed = this.states.get(key) || emptyState(Number(key));
      const character = committed.characters[String(cid)];
      if (!character) {
        fail('ITEM_OWNERSHIP_MISMATCH', 'Character does not belong to the account.', {
          accountId: Number(key),
          characterId: cid,
        });
      }

      const baseVersion = committed.version;
      const before = cloneState(committed);
      const draft = cloneState(committed);
      const result = await work(draft);
      this._assertNotAborted(signal);
      assertNoDuplicateSerials(draft);
      assertConserved(before, draft);

      await this.commitLock.run(async () => {
        this._assertNotAborted(signal);
        const latest = this.states.get(key) || emptyState(Number(key));
        if (latest.version !== baseVersion) fail('CONCURRENT_MODIFICATION', 'Account state changed during transaction.', { accountId: Number(key) });
        this._validateGlobalSerials(key, draft);
        this._replaceSerialIndex(key, latest, draft);
        draft.version = baseVersion + 1;
        this.states.set(key, cloneState(draft));
      });

      return result;
    });
  }

  async scanForDuplicateSerials() {
    const owners = new Map();
    const duplicates = [];
    for (const [accountId, state] of this.states) {
      for (const item of listItems(state)) {
        const serial = String(item.serial);
        if (owners.has(serial)) duplicates.push({ serial: Number(serial), accounts: [owners.get(serial), Number(accountId)] });
        else owners.set(serial, Number(accountId));
      }
    }
    return duplicates;
  }

  _assertNotAborted(signal) {
    if (signal?.aborted) fail('TRANSFER_ABORTED', 'Inn transfer was aborted before commit.');
  }

  _validateGlobalSerials(accountId, draft) {
    for (const item of listItems(draft)) {
      const serial = String(item.serial);
      const existingOwner = this.serialOwners.get(serial);
      if (existingOwner != null && existingOwner !== accountId) {
        const details = { serial: Number(serial), existingAccount: Number(existingOwner), attemptedAccount: Number(accountId) };
        if (typeof this.duplicateSerialHook === 'function') this.duplicateSerialHook(details);
        fail('DUPLICATE_SERIAL', `Serial ${serial} already exists for another account.`, details);
      }
    }
  }

  _replaceSerialIndex(accountId, previous, next) {
    if (previous) {
      for (const item of listItems(previous)) {
        const serial = String(item.serial);
        if (this.serialOwners.get(serial) === accountId) this.serialOwners.delete(serial);
      }
    }
    for (const item of listItems(next)) this.serialOwners.set(String(item.serial), accountId);
  }
}

module.exports = { InMemoryInnRepository, Mutex };
