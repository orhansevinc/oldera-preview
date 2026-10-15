export class JsonAuditSink {
  emit(event) {
    const safe = {
      ts: new Date().toISOString(),
      service: 'oldko-account-api',
      ...event
    };
    process.stdout.write(`${JSON.stringify(safe)}\n`);
  }
}

export class MemoryAuditSink {
  constructor() { this.events = []; }
  emit(event) { this.events.push(structuredClone(event)); }
}
