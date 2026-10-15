'use strict';

class DeterministicMobScheduler {
  constructor(service, { tickIntervalMs = 100, maxCatchUpTicks = 100000 } = {}) {
    if (!service || typeof service.tick !== 'function' || typeof service.initialize !== 'function') {
      throw new TypeError('ko1298-mobs: scheduler requires MobService');
    }
    if (!Number.isInteger(tickIntervalMs) || tickIntervalMs <= 0) throw new TypeError('ko1298-mobs: tickIntervalMs must be positive integer');
    if (!Number.isInteger(maxCatchUpTicks) || maxCatchUpTicks <= 0) throw new TypeError('ko1298-mobs: maxCatchUpTicks must be positive integer');
    this.service = service;
    this.tickIntervalMs = tickIntervalMs;
    this.maxCatchUpTicks = maxCatchUpTicks;
    this.started = false;
    this.lastTickAt = null;
    this.nextTickAt = null;
    this.tickCount = 0;
  }

  initialize(startAt = 0) {
    if (!Number.isFinite(startAt) || startAt < 0) throw new TypeError('ko1298-mobs: startAt must be finite >= 0');
    if (!this.started) {
      this.service.initialize(startAt);
      this.started = true;
      this.lastTickAt = startAt;
      this.nextTickAt = startAt + this.tickIntervalMs;
    }
    return this.snapshot();
  }

  advanceTo(now) {
    if (!this.started) throw new Error('ko1298-mobs: scheduler.initialize() must be called first');
    if (!Number.isFinite(now) || now < this.lastTickAt) throw new TypeError('ko1298-mobs: scheduler time must be monotonic');
    let executed = 0;
    while (this.nextTickAt <= now) {
      if (executed >= this.maxCatchUpTicks) throw new Error('ko1298-mobs: scheduler catch-up limit exceeded');
      this.service.tick(this.nextTickAt);
      this.lastTickAt = this.nextTickAt;
      this.nextTickAt += this.tickIntervalMs;
      this.tickCount += 1;
      executed += 1;
    }
    return Object.freeze({ executed, ...this.snapshot() });
  }

  snapshot() {
    return Object.freeze({
      tickIntervalMs: this.tickIntervalMs,
      tickCount: this.tickCount,
      lastTickAt: this.lastTickAt,
      nextTickAt: this.nextTickAt,
    });
  }
}

module.exports = { DeterministicMobScheduler };
