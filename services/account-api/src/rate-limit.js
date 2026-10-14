import { tooMany } from './errors.js';

export class InMemoryRateLimitStore {
  constructor() { this.entries = new Map(); this.kind = 'memory'; }

  #active(key, now, windowMs) {
    let entry = this.entries.get(key);
    if (!entry || now >= entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      this.entries.set(key, entry);
    }
    return entry;
  }

  async check(key, limit, windowMs, now = Date.now()) {
    const entry = this.#active(key, now, windowMs);
    return {
      allowed: entry.count < limit,
      remaining: Math.max(0, limit - entry.count),
      retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000))
    };
  }

  async consume(key, limit, windowMs, now = Date.now()) {
    const entry = this.#active(key, now, windowMs);
    entry.count += 1;
    this.entries.set(key, entry);
    return {
      allowed: entry.count <= limit,
      remaining: Math.max(0, limit - entry.count),
      retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000))
    };
  }

  async reset(key) { this.entries.delete(key); }
  async ready() { return true; }
  async close() {}
}

export class SecurityGate {
  constructor(store = new InMemoryRateLimitStore()) { this.store = store; }

  async assertRate(key, { limit, windowMs }, now = Date.now()) {
    const result = await this.store.consume(`rate:${key}`, limit, windowMs, now);
    if (!result.allowed) throw tooMany(result.retryAfterSeconds);
    return result;
  }

  #credentialKey(ip, usernameCanonical) { return `credential:${ip}:${usernameCanonical}`; }

  async assertCredentialAllowed(ip, usernameCanonical, now = Date.now()) {
    const result = await this.store.check(this.#credentialKey(ip, usernameCanonical), 8, 15 * 60_000, now);
    if (!result.allowed) throw tooMany(result.retryAfterSeconds);
  }

  async recordCredentialFailure(ip, usernameCanonical, now = Date.now()) {
    return this.store.consume(this.#credentialKey(ip, usernameCanonical), 8, 15 * 60_000, now);
  }

  async clearCredentialFailures(ip, usernameCanonical) {
    return this.store.reset(this.#credentialKey(ip, usernameCanonical));
  }
}
