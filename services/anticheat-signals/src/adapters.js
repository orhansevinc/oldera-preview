export class NoopAdminReviewAdapter {
  async submit(_signal) {}
}

export class NoopObservabilityAdapter {
  emit(_eventName, _fields) {}
}

export class InMemoryAdminReviewAdapter {
  constructor() {
    this.signals = [];
  }
  async submit(signal) {
    this.signals.push(signal);
  }
}

export class InMemoryObservabilityAdapter {
  constructor() {
    this.events = [];
  }
  emit(eventName, fields) {
    this.events.push({ eventName, fields: structuredClone(fields) });
  }
}
