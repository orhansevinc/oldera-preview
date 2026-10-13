import { tooMany } from './errors.js';

export class InMemoryRateLimitStore {
  constructor() { this.entries = new Map(); }

  #active(key, now, windowMs) {
    let entry = this.entries.get(key);
    if (!entry || now >= entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      this.entries.set(key, entry);
    }
    return entry;
  }

  check(key, limit, windowMs, now = Date.now()) {
    const entry = this.#active(key, now, windowMs);
    return {
      allowed: entry.count < limit,
      remaining: Math.max(0, limit - entry.count),
      retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000))
    };
  }

  consume(key, limit, windowMs, now = Date.now()) {
    const entry = this.#active(key, now, windowMs);
    entry.count += 1;
    this.entries.set(key, entry);
    return {
      allowed: entry.count <= limit,
      remaining: Math.max(0, limit - entry.count),
      retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000))
    };
  }

  reset(key) { this.entries.delete(key); }
}

export class SecurityGate {
  constructor(store = new InMemoryRateLimitStore()) { this.store = store; }

  assertRate(key, { limit, windowMs }, now = Date.now()) {
    const result = this.store.consume(`rate:${key}`, limit, windowMs, now);
    if (!result.allowed) throw tooMany(result.retryAfterSeconds);
    return result;
  }

  #credentialKey(ip, usernameCanonical) { return `credential:${ip}:${usernameCanonical}`; }

  assertCredentialAllowed(ip, usernameCanonical, now = Date.now()) {
    const result = this.store.check(this.#credentialKey(ip, usernameCanonical), 8, 15 * 60_000, now);
    if (!result.allowed) throw tooMany(result.retryAfterSeconds);
  }

  recordCredentialFailure(ip, usernameCanonical, now = Date.now()) {
    this.store.consume(this.#credentialKey(ip, usernameCanonical), 8, 15 * 60_000, now);
  }

  clearCredentialFailures(ip, usernameCanonical) {
    this.store.reset(this.#credentialKey(ip, usernameCanonical));
  }
}
