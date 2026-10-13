'use strict';

function clone(value) {
  return value == null ? value : structuredClone(value);
}

class InMemoryLeaseStore {
  constructor() {
    this.records = new Map();
  }

  _mapKey(scope, key) {
    return `${scope}:${key}`;
  }

  async get(scope, key) {
    return clone(this.records.get(this._mapKey(scope, key)) || null);
  }

  async compareAndSet(scope, key, expectedVersion, nextRecord) {
    const mapKey = this._mapKey(scope, key);
    const current = this.records.get(mapKey) || null;
    const currentVersion = current ? current.version : null;
    if (currentVersion !== expectedVersion) {
      return { ok: false, record: clone(current) };
    }

    if (nextRecord == null) {
      this.records.delete(mapKey);
      return { ok: true, record: null };
    }

    const next = clone(nextRecord);
    next.version = current ? current.version + 1 : 1;
    this.records.set(mapKey, next);
    return { ok: true, record: clone(next) };
  }

  async listBySession(sessionId) {
    return [...this.records.values()]
      .filter((record) => record.sessionId === sessionId)
      .map(clone);
  }

  async listAll() {
    return [...this.records.values()].map(clone);
  }
}

module.exports = { InMemoryLeaseStore };
