'use strict';

class InMemoryIdempotencyStore {
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
    this.entries = new Map();
  }

  async run(key, ttlMs, work) {
    const now = this.now();
    const existing = this.entries.get(key);
    if (existing && existing.expiresAt > now) {
      return { value: await existing.promise, replayed: true };
    }
    if (existing) this.entries.delete(key);

    const promise = Promise.resolve().then(work);
    this.entries.set(key, { promise, expiresAt: now + ttlMs });

    try {
      const value = await promise;
      return { value, replayed: false };
    } catch (error) {
      // Infrastructure exceptions are not cached; command results are returned, not thrown.
      this.entries.delete(key);
      throw error;
    }
  }

  prune() {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
  }
}

module.exports = { InMemoryIdempotencyStore };
