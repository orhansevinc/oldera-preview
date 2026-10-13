'use strict';

const { emptyState, cloneState, listSerials, assertNoLocalDuplicateSerials } = require('./inventory-state');
const { fail } = require('./errors');

class Mutex {
  constructor() {
    this.tail = Promise.resolve();
  }

  async run(fn) {
    const previous = this.tail;
    let release;
    this.tail = new Promise(resolve => { release = resolve; });
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

class InMemoryItemRepository {
  constructor({ duplicateSerialHook = null } = {}) {
    this.states = new Map();
    this.ownerLocks = new Map();
    this.commitLock = new Mutex();
    this.serialOwners = new Map();
    this.duplicateSerialHook = duplicateSerialHook;
  }

  _lockFor(ownerId) {
    const key = String(ownerId);
    if (!this.ownerLocks.has(key)) this.ownerLocks.set(key, new Mutex());
    return this.ownerLocks.get(key);
  }

  async read(ownerId) {
    const key = String(ownerId);
    return cloneState(this.states.get(key) ?? emptyState(key));
  }

  async transact(ownerId, work) {
    const key = String(ownerId);
    return this._lockFor(key).run(async () => {
      const committed = this.states.get(key) ?? emptyState(key);
      const baseVersion = committed.version;
      const draft = cloneState(committed);

      const result = await work(draft);
      assertNoLocalDuplicateSerials(draft);

      await this.commitLock.run(async () => {
        const latest = this.states.get(key) ?? emptyState(key);
        if (latest.version !== baseVersion) {
          fail('CONCURRENT_MODIFICATION', 'Owner state changed during transaction.', { ownerId: key });
        }
        this._validateGlobalSerials(key, draft);
        this._replaceSerialIndex(key, latest, draft);
        draft.version = baseVersion + 1;
        this.states.set(key, cloneState(draft));
      });

      return result;
    });
  }

  _validateGlobalSerials(ownerId, draft) {
    for (const serial of listSerials(draft)) {
      const existingOwner = this.serialOwners.get(serial);
      if (existingOwner != null && existingOwner !== ownerId) {
        const details = { serial, existingOwner, attemptedOwner: ownerId };
        if (typeof this.duplicateSerialHook === 'function') this.duplicateSerialHook(details);
        fail('DUPLICATE_SERIAL', `Serial ${serial} already exists for another owner.`, details);
      }
    }
  }

  _replaceSerialIndex(ownerId, previous, next) {
    for (const serial of listSerials(previous)) {
      if (this.serialOwners.get(serial) === ownerId) this.serialOwners.delete(serial);
    }
    for (const serial of listSerials(next)) this.serialOwners.set(serial, ownerId);
  }

  async scanForDuplicateSerials() {
    const owners = new Map();
    const duplicates = [];
    for (const [ownerId, state] of this.states) {
      for (const serial of listSerials(state)) {
        if (owners.has(serial)) duplicates.push({ serial, owners: [owners.get(serial), ownerId] });
        else owners.set(serial, ownerId);
      }
    }
    return duplicates;
  }
}

module.exports = { InMemoryItemRepository, Mutex };
