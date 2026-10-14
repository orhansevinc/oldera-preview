'use strict';

const { emptyState, cloneState, listSerials, assertNoLocalDuplicateSerials } = require('./inventory-state');
const { fail, ItemDomainError } = require('./errors');

class Mutex {
  constructor() { this.tail = Promise.resolve(); }
  async run(fn) { const previous = this.tail; let release; this.tail = new Promise(resolve => { release = resolve; }); await previous; try { return await fn(); } finally { release(); } }
}

class InMemoryItemRepository {
  constructor({ duplicateSerialHook = null, beforeCommit = null } = {}) {
    this.states = new Map();
    this.ownerLocks = new Map();
    this.commitLock = new Mutex();
    this.serialOwners = new Map();
    this.duplicateSerialHook = duplicateSerialHook;
    this.beforeCommit = beforeCommit;
    this.idempotency = new Map();
    this.journal = [];
  }

  _lockFor(ownerId) { const key = String(ownerId); if (!this.ownerLocks.has(key)) this.ownerLocks.set(key, new Mutex()); return this.ownerLocks.get(key); }
  async read(ownerId) { const key = String(ownerId); return cloneState(this.states.get(key) ?? emptyState(key)); }

  async transact(ownerId, work, options = {}) {
    const key = String(ownerId);
    const idempotencyKey = options.idempotencyKey == null ? null : `${key}:${options.idempotencyKey}`;
    if (idempotencyKey && this.idempotency.has(idempotencyKey)) return structuredClone(this.idempotency.get(idempotencyKey));
    return this._lockFor(key).run(async () => {
      if (idempotencyKey && this.idempotency.has(idempotencyKey)) return structuredClone(this.idempotency.get(idempotencyKey));
      assertNotAborted(options.signal);
      const committed = this.states.get(key) ?? emptyState(key);
      const baseVersion = committed.version;
      const draft = cloneState(committed);
      let result;
      try { result = await work(draft); } catch (error) { throw mapPersistenceError(error); }
      assertNoLocalDuplicateSerials(draft);
      assertNotAborted(options.signal);
      await this.commitLock.run(async () => {
        const latest = this.states.get(key) ?? emptyState(key);
        if (latest.version !== baseVersion) fail('CONCURRENT_MODIFICATION', 'Owner state changed during transaction.', { ownerId: key });
        this._validateGlobalSerials(key, draft);
        try { if (typeof this.beforeCommit === 'function') await this.beforeCommit({ ownerId: key, draft: cloneState(draft), options }); } catch (error) { throw mapPersistenceError(error); }
        assertNotAborted(options.signal);
        this._replaceSerialIndex(key, latest, draft);
        draft.version = baseVersion + 1;
        this.states.set(key, cloneState(draft));
        if (options.event) this.journal.push(Object.freeze({ sequence: this.journal.length + 1, ownerId: key, version: draft.version, ...options.event }));
        if (idempotencyKey) this.idempotency.set(idempotencyKey, structuredClone(result));
      });
      return result;
    });
  }

  async transactMany(ownerIds, work, options = {}) {
    const ids = [...new Set(ownerIds.map(String))].sort();
    const idempotencyKey = options.idempotencyKey == null ? null : `${ids.join('|')}:${options.idempotencyKey}`;
    if (idempotencyKey && this.idempotency.has(idempotencyKey)) return structuredClone(this.idempotency.get(idempotencyKey));
    const run = async index => index >= ids.length ? this.commitLock.run(async () => {
      if (idempotencyKey && this.idempotency.has(idempotencyKey)) return structuredClone(this.idempotency.get(idempotencyKey));
      assertNotAborted(options.signal);
      const drafts = new Map(ids.map(id => [id, cloneState(this.states.get(id) ?? emptyState(id))]));
      let result;
      try { result = await work(drafts); } catch (error) { throw mapPersistenceError(error); }
      for (const draft of drafts.values()) assertNoLocalDuplicateSerials(draft);
      const future = new Map(this.serialOwners);
      for (const id of ids) for (const serial of listSerials(this.states.get(id) ?? emptyState(id))) if (future.get(serial) === id) future.delete(serial);
      for (const id of ids) for (const serial of listSerials(drafts.get(id))) { const owner = future.get(serial); if (owner != null && owner !== id) fail('DUPLICATE_SERIAL', `Serial ${serial} already exists for another owner.`, { serial, existingOwner: owner, attemptedOwner: id }); future.set(serial, id); }
      try { if (typeof this.beforeCommit === 'function') await this.beforeCommit({ ownerIds: ids, drafts: new Map([...drafts].map(([id, draft]) => [id, cloneState(draft)])), options }); } catch (error) { throw mapPersistenceError(error); }
      assertNotAborted(options.signal);
      for (const id of ids) { const draft = drafts.get(id); draft.version = (this.states.get(id)?.version ?? 0) + 1; this.states.set(id, cloneState(draft)); }
      this.serialOwners = future;
      if (options.event) this.journal.push(Object.freeze({ sequence: this.journal.length + 1, ownerIds: ids, ...options.event }));
      if (idempotencyKey) this.idempotency.set(idempotencyKey, structuredClone(result));
      return result;
    }) : this._lockFor(ids[index]).run(() => run(index + 1));
    return run(0);
  }

  _validateGlobalSerials(ownerId, draft) {
    for (const serial of listSerials(draft)) { const existingOwner = this.serialOwners.get(serial); if (existingOwner != null && existingOwner !== ownerId) { const details = { serial, existingOwner, attemptedOwner: ownerId }; if (typeof this.duplicateSerialHook === 'function') this.duplicateSerialHook(details); fail('DUPLICATE_SERIAL', `Serial ${serial} already exists for another owner.`, details); } }
  }
  _replaceSerialIndex(ownerId, previous, next) { for (const serial of listSerials(previous)) if (this.serialOwners.get(serial) === ownerId) this.serialOwners.delete(serial); for (const serial of listSerials(next)) this.serialOwners.set(serial, ownerId); }
  async countSerial(serial) { return this.serialOwners.has(String(serial)) ? 1 : 0; }
  async ownerOfSerial(serial) { return this.serialOwners.get(String(serial)) ?? null; }
  async scanForDuplicateSerials() { const owners = new Map(); const duplicates = []; for (const [ownerId, state] of this.states) for (const serial of listSerials(state)) { if (owners.has(serial)) duplicates.push({ serial, owners: [owners.get(serial), ownerId] }); else owners.set(serial, ownerId); } return duplicates; }
  async exportSnapshot(ownerId) { return this.read(ownerId); }
  async importSnapshot(ownerId, snapshot, { expectedVersion = null } = {}) { const key = String(ownerId); return this._lockFor(key).run(() => this.commitLock.run(async () => { const current = this.states.get(key) ?? emptyState(key); if (expectedVersion != null && current.version !== expectedVersion) fail('CONCURRENT_MODIFICATION', 'Snapshot version changed.', { expectedVersion, actualVersion: current.version }); const next = cloneState(snapshot); next.ownerId = key; assertNoLocalDuplicateSerials(next); this._validateGlobalSerials(key, next); this._replaceSerialIndex(key, current, next); this.states.set(key, cloneState(next)); return cloneState(next); })); }
  async getJournal() { return this.journal.map(x => ({ ...x })); }
}

function assertNotAborted(signal) { if (signal?.aborted) fail('OPERATION_ABORTED', 'Operation aborted before commit.'); }
function mapPersistenceError(error) { if (error instanceof ItemDomainError) return error; if (error?.code === '23505') return new ItemDomainError('PERSISTENCE_UNIQUENESS_VIOLATION', 'Persistence uniqueness constraint rejected item transaction.', { sqlState: '23505' }, error); return error; }

module.exports = { InMemoryItemRepository, Mutex, assertNotAborted, mapPersistenceError };
