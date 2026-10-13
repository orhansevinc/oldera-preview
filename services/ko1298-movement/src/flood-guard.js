'use strict';

class SlidingWindowFloodGuard {
  constructor({ windowMs = 1000, maxPackets = 20, onFlood = null } = {}) {
    if (!Number.isFinite(windowMs) || windowMs <= 0) throw new TypeError('windowMs must be > 0');
    if (!Number.isInteger(maxPackets) || maxPackets <= 0) throw new TypeError('maxPackets must be > 0');
    this.windowMs = windowMs;
    this.maxPackets = maxPackets;
    this.onFlood = typeof onFlood === 'function' ? onFlood : null;
    this.samples = new Map();
  }

  check({ sessionId, kind, nowMs }) {
    const key = `${sessionId}:${kind}`;
    const cutoff = nowMs - this.windowMs;
    const queue = this.samples.get(key) || [];
    let start = 0;
    while (start < queue.length && queue[start] <= cutoff) start += 1;
    const active = start === 0 ? queue : queue.slice(start);
    active.push(nowMs);
    this.samples.set(key, active);

    if (active.length <= this.maxPackets) return { allow: true };

    const event = {
      sessionId,
      kind,
      nowMs,
      count: active.length,
      windowMs: this.windowMs,
      maxPackets: this.maxPackets,
    };
    if (this.onFlood) this.onFlood(event);
    return { allow: false, reason: 'packet_flood', event };
  }

  cleanup(sessionId) {
    const prefix = `${sessionId}:`;
    for (const key of this.samples.keys()) {
      if (key.startsWith(prefix)) this.samples.delete(key);
    }
  }
}

module.exports = { SlidingWindowFloodGuard };
