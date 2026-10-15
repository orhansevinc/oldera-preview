'use strict';
class KeyedMutex {
  constructor() { this.tails = new Map(); }
  async run(key, fn) {
    const k = String(key);
    const previous = this.tails.get(k) || Promise.resolve();
    let release;
    const gate = new Promise((r) => { release = r; });
    const tail = previous.then(() => gate);
    this.tails.set(k, tail);
    await previous;
    try { return await fn(); }
    finally { release(); if (this.tails.get(k) === tail) this.tails.delete(k); }
  }
}
module.exports = { KeyedMutex };
