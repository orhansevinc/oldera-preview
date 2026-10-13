function assertPositiveNumber(name, value) {
  if (!Number.isFinite(value) || value <= 0) throw new TypeError(`${name} must be > 0`);
}

function normalizedCost(value) {
  const cost = value ?? 1;
  assertPositiveNumber("cost", cost);
  return cost;
}

export class InMemoryRateLimitStore {
  #fixed = new Map();
  #sliding = new Map();
  #tokens = new Map();
  #now;

  constructor({ now = () => Date.now() } = {}) {
    this.#now = now;
  }

  async consume(request) {
    const now = request.now ?? this.#now();
    switch (request.algorithm) {
      case "fixed-window":
        return this.#consumeFixed(request, now);
      case "sliding-window":
        return this.#consumeSliding(request, now);
      case "token-bucket":
        return this.#consumeTokenBucket(request, now);
      default:
        throw new TypeError(`unsupported algorithm: ${request.algorithm}`);
    }
  }

  clear() {
    this.#fixed.clear();
    this.#sliding.clear();
    this.#tokens.clear();
  }

  #consumeFixed(request, now) {
    const cost = normalizedCost(request.cost);
    assertPositiveNumber("limit", request.limit);
    assertPositiveNumber("windowMs", request.windowMs);
    const windowStart = Math.floor(now / request.windowMs) * request.windowMs;
    const resetAt = windowStart + request.windowMs;
    const id = `${request.key}:${windowStart}`;
    const current = this.#fixed.get(id) ?? 0;
    const next = current + cost;
    const allowed = next <= request.limit;
    if (allowed) this.#fixed.set(id, next);
    return {
      allowed,
      limit: request.limit,
      remaining: Math.max(0, request.limit - (allowed ? next : current)),
      retryAfterMs: allowed ? 0 : Math.max(1, resetAt - now),
      resetAt
    };
  }

  #consumeSliding(request, now) {
    const cost = normalizedCost(request.cost);
    assertPositiveNumber("limit", request.limit);
    assertPositiveNumber("windowMs", request.windowMs);
    const cutoff = now - request.windowMs;
    const entries = (this.#sliding.get(request.key) ?? []).filter((entry) => entry.at > cutoff);
    const used = entries.reduce((sum, entry) => sum + entry.cost, 0);
    const allowed = used + cost <= request.limit;
    if (allowed) entries.push({ at: now, cost });
    this.#sliding.set(request.key, entries);
    const after = allowed ? used + cost : used;
    const earliest = entries[0]?.at ?? now;
    const resetAt = entries.length ? earliest + request.windowMs : now;
    return {
      allowed,
      limit: request.limit,
      remaining: Math.max(0, request.limit - after),
      retryAfterMs: allowed ? 0 : Math.max(1, resetAt - now),
      resetAt
    };
  }

  #consumeTokenBucket(request, now) {
    const cost = normalizedCost(request.cost);
    const capacity = request.capacity ?? request.limit;
    const refillPerSecond = request.refillPerSecond;
    assertPositiveNumber("capacity", capacity);
    assertPositiveNumber("refillPerSecond", refillPerSecond);

    const previous = this.#tokens.get(request.key) ?? { tokens: capacity, at: now };
    const elapsedSeconds = Math.max(0, now - previous.at) / 1000;
    const available = Math.min(capacity, previous.tokens + elapsedSeconds * refillPerSecond);
    const allowed = available >= cost;
    const tokens = allowed ? available - cost : available;
    this.#tokens.set(request.key, { tokens, at: now });
    const missing = Math.max(0, cost - tokens);
    const retryAfterMs = allowed ? 0 : Math.max(1, Math.ceil((missing / refillPerSecond) * 1000));
    return {
      allowed,
      limit: capacity,
      remaining: Math.max(0, Math.floor(tokens)),
      retryAfterMs,
      resetAt: now + Math.ceil(((capacity - tokens) / refillPerSecond) * 1000)
    };
  }
}
