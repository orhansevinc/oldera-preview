import crypto from 'node:crypto';

export class NullDelivery {
  async sendVerification() { throw new Error('Verification delivery is not configured'); }
  async sendPasswordReset() { throw new Error('Password reset delivery is not configured'); }
}

export class WebhookDelivery {
  constructor({ url, secret, fetchImpl = globalThis.fetch }) {
    if (!url || !secret) throw new Error('Webhook delivery requires url and secret');
    this.url = url;
    this.secret = secret;
    this.fetchImpl = fetchImpl;
  }

  async #send(type, payload) {
    const body = JSON.stringify({ type, ...payload });
    const timestamp = String(Date.now());
    const signature = crypto.createHmac('sha256', this.secret).update(`${timestamp}.${body}`).digest('hex');
    const response = await this.fetchImpl(this.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-oldko-timestamp': timestamp,
        'x-oldko-signature': `sha256=${signature}`
      },
      body,
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) throw new Error(`Delivery webhook failed with HTTP ${response.status}`);
  }

  sendVerification(payload) { return this.#send('account_verification', payload); }
  sendPasswordReset(payload) { return this.#send('password_reset', payload); }
}
