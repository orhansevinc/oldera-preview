'use strict';

const { validateGameTime, toSerialMinute } = require('./model.cjs');
const { assertScheduleRepository } = require('./schedule-repository.cjs');

function normalizeEvent(event) {
  if (!event || typeof event !== 'object') throw new TypeError('scheduled event must be an object');
  if (typeof event.id !== 'string' || event.id.trim() === '') throw new TypeError('scheduled event id is required');
  if (typeof event.kind !== 'string' || event.kind.trim() === '') throw new TypeError('scheduled event kind is required');
  const at = validateGameTime(event.at);
  return Object.freeze({
    id: event.id,
    kind: event.kind,
    at,
    payload: event.payload === undefined ? null : structuredClone(event.payload),
  });
}

function orderEvents(a, b) {
  const byTime = toSerialMinute(a.at) - toSerialMinute(b.at);
  return byTime || a.id.localeCompare(b.id);
}

class DeterministicWorldScheduler {
  constructor({ repository, onTrigger = async () => {} }) {
    this.repository = assertScheduleRepository(repository);
    if (typeof onTrigger !== 'function') throw new TypeError('onTrigger must be a function');
    this.onTrigger = onTrigger;
    this.pending = new Map();
    this.highWatermark = -1;
  }

  async recover() {
    this.pending.clear();
    const events = await this.repository.listPending();
    for (const raw of events) {
      const event = normalizeEvent(raw);
      this.pending.set(event.id, event);
    }
    return this.listPending();
  }

  async schedule(event) {
    const normalized = normalizeEvent(event);
    await this.repository.upsert(normalized);
    this.pending.set(normalized.id, normalized);
    return normalized;
  }

  listPending() {
    return [...this.pending.values()].sort(orderEvents).map((event) => structuredClone(event));
  }

  async processDue(now, context = {}) {
    const current = validateGameTime(now);
    const currentSerial = toSerialMinute(current);

    // A forced GM time rewind must not replay world events. We keep the highest
    // processed minute as a monotonic event watermark until game time catches up.
    if (currentSerial < this.highWatermark) {
      return Object.freeze({ triggered: [], suppressedByBackwardsTime: true });
    }

    const due = this.listPending().filter((event) => toSerialMinute(event.at) <= currentSerial);
    const triggered = [];

    for (const event of due) {
      await this.onTrigger(structuredClone(event), {
        ...context,
        now: structuredClone(current),
      });
      await this.repository.markTriggered(event.id, {
        triggeredAt: current,
      });
      this.pending.delete(event.id);
      triggered.push(event.id);
    }

    this.highWatermark = Math.max(this.highWatermark, currentSerial);
    return Object.freeze({ triggered, suppressedByBackwardsTime: false });
  }
}

module.exports = {
  DeterministicWorldScheduler,
  normalizeEvent,
};
