'use strict';

const { SessionError, ERROR_CATEGORY, classifyError } = require('./errors');

class SessionDispatcher {
  constructor(session, {
    maxQueuedPackets = 64,
    maxQueuedBytes = 256 * 1024,
  } = {}) {
    if (!session || typeof session.handle !== 'function') throw new TypeError('session.handle is required');
    this.session = session;
    this.maxQueuedPackets = maxQueuedPackets;
    this.maxQueuedBytes = maxQueuedBytes;
    this.queue = [];
    this.queuedBytes = 0;
    this.active = false;
    this.closing = false;
    this.closePromise = null;
    this.resolveClose = null;
  }

  enqueue(payload) {
    const packet = Buffer.from(payload || []);
    if (this.closing) {
      return Promise.reject(new SessionError('SESSION_CLOSING', 'session is disconnecting', {
        category: ERROR_CATEGORY.TRANSPORT,
        fatal: false,
      }));
    }
    if (this.queue.length + (this.active ? 1 : 0) >= this.maxQueuedPackets || this.queuedBytes + packet.length > this.maxQueuedBytes) {
      return Promise.reject(new SessionError('BACKPRESSURE_LIMIT', 'session packet queue limit exceeded', {
        category: ERROR_CATEGORY.BACKPRESSURE,
        fatal: true,
        details: { queueDepth: this.queue.length, queuedBytes: this.queuedBytes, packetLength: packet.length },
      }));
    }

    return new Promise((resolve, reject) => {
      this.queue.push({ packet, resolve, reject });
      this.queuedBytes += packet.length;
      void this.#drain();
    });
  }

  close({ reason = 'TRANSPORT_LOST', useGrace = true } = {}) {
    if (this.closePromise) return this.closePromise;
    this.closing = true;
    const closingError = new SessionError('SESSION_CLOSING', 'session closed before queued packet execution', {
      category: ERROR_CATEGORY.TRANSPORT,
      fatal: false,
    });
    while (this.queue.length) {
      const item = this.queue.shift();
      this.queuedBytes -= item.packet.length;
      item.reject(closingError);
    }
    this.closePromise = new Promise((resolve) => { this.resolveClose = resolve; });
    this.closeReason = reason;
    this.closeUseGrace = useGrace;
    if (!this.active) void this.#finishClose();
    return this.closePromise;
  }

  async #drain() {
    if (this.active || this.closing) return;
    this.active = true;
    try {
      while (!this.closing && this.queue.length) {
        const item = this.queue.shift();
        this.queuedBytes -= item.packet.length;
        try {
          const responses = await this.session.handle(item.packet);
          item.resolve(responses);
        } catch (error) {
          const classified = classifyError(error);
          item.reject(classified);
          if (classified.fatal) {
            this.closing = true;
            while (this.queue.length) {
              const pending = this.queue.shift();
              this.queuedBytes -= pending.packet.length;
              pending.reject(new SessionError('SESSION_CLOSING', 'fatal packet failure closed queued work', {
                category: ERROR_CATEGORY.TRANSPORT,
              }));
            }
            this.closeReason = classified.code;
            this.closeUseGrace = ![ERROR_CATEGORY.MALFORMED_PACKET, ERROR_CATEGORY.BACKPRESSURE].includes(classified.category);
            if (!this.closePromise) this.closePromise = new Promise((resolve) => { this.resolveClose = resolve; });
            break;
          }
        }
      }
    } finally {
      this.active = false;
      if (this.closing) await this.#finishClose();
      else if (this.queue.length) void this.#drain();
    }
  }

  async #finishClose() {
    if (this.finishingClose) return;
    this.finishingClose = true;
    try {
      if (typeof this.session.disconnect === 'function') {
        await this.session.disconnect({ reason: this.closeReason || 'TRANSPORT_LOST', useGrace: this.closeUseGrace !== false });
      }
    } finally {
      const resolve = this.resolveClose;
      this.resolveClose = null;
      if (resolve) resolve();
    }
  }
}

module.exports = { SessionDispatcher };
