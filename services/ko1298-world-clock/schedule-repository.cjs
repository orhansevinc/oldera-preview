'use strict';

/**
 * Schedule repository port expected by DeterministicWorldScheduler:
 *   listPending(): Promise<Array<ScheduledWorldEvent>> | Array<ScheduledWorldEvent>
 *   upsert(event): Promise<void> | void
 *   markTriggered(eventId, metadata): Promise<void> | void
 *
 * Production persistence is intentionally outside WS36. A DB adapter can satisfy
 * this port without changing the world-clock domain.
 */
function assertScheduleRepository(repository) {
  if (!repository || typeof repository !== 'object') {
    throw new TypeError('scheduleRepository is required');
  }
  for (const method of ['listPending', 'upsert', 'markTriggered']) {
    if (typeof repository[method] !== 'function') {
      throw new TypeError(`scheduleRepository.${method}() is required`);
    }
  }
  return repository;
}

class InMemoryScheduleRepository {
  constructor(seed = []) {
    this.records = new Map();
    for (const event of seed) {
      this.records.set(event.id, { event: structuredClone(event), triggered: false, metadata: null });
    }
  }

  async listPending() {
    return [...this.records.values()]
      .filter((record) => !record.triggered)
      .map((record) => structuredClone(record.event));
  }

  async upsert(event) {
    const current = this.records.get(event.id);
    this.records.set(event.id, {
      event: structuredClone(event),
      triggered: current?.triggered ?? false,
      metadata: current?.metadata ?? null,
    });
  }

  async markTriggered(eventId, metadata) {
    const record = this.records.get(eventId);
    if (!record) throw new Error(`scheduled event not found: ${eventId}`);
    record.triggered = true;
    record.metadata = structuredClone(metadata ?? null);
  }

  snapshot() {
    return [...this.records.entries()].map(([id, record]) => ({
      id,
      event: structuredClone(record.event),
      triggered: record.triggered,
      metadata: structuredClone(record.metadata),
    }));
  }
}

module.exports = {
  assertScheduleRepository,
  InMemoryScheduleRepository,
};
