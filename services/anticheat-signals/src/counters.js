export class SlidingWindowCounterStore {
  #entries = new Map();

  hit(key, now, windowMs) {
    const cutoff = now - windowMs;
    const current = this.#entries.get(key) ?? [];
    const active = current.filter((timestamp) => timestamp > cutoff);
    active.push(now);
    this.#entries.set(key, active);
    return {
      count: active.length,
      firstSeenAt: active[0],
      lastSeenAt: active[active.length - 1]
    };
  }

  count(key, now, windowMs) {
    const cutoff = now - windowMs;
    const active = (this.#entries.get(key) ?? []).filter((timestamp) => timestamp > cutoff);
    if (active.length === 0) this.#entries.delete(key);
    else this.#entries.set(key, active);
    return active.length;
  }
}

export class RiskWindowStore {
  #entries = new Map();

  add(key, points, now, windowMs) {
    const cutoff = now - windowMs;
    const active = (this.#entries.get(key) ?? []).filter((entry) => entry.at > cutoff);
    active.push({ at: now, points });
    this.#entries.set(key, active);
    return Math.min(100, active.reduce((sum, entry) => sum + entry.points, 0));
  }

  score(key, now, windowMs) {
    const cutoff = now - windowMs;
    const active = (this.#entries.get(key) ?? []).filter((entry) => entry.at > cutoff);
    if (active.length === 0) this.#entries.delete(key);
    else this.#entries.set(key, active);
    return Math.min(100, active.reduce((sum, entry) => sum + entry.points, 0));
  }
}
