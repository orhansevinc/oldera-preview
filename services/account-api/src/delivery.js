import crypto from 'node:crypto';

export const MAIL_DELIVERY_CONTRACT_VERSION = 'oldko.account-mail.v1';

export class NullDelivery {
  async sendVerification() { throw new Error('Verification delivery is not configured'); }
  async sendPasswordReset() { throw new Error('Password reset delivery is not configured'); }
}

export class WebhookDelivery {
  constructor({ url, secret, sender, fetchImpl = globalThis.fetch }) {
    if (!url || !secret || !sender) throw new Error('Webhook delivery requires url, secret and sender');
    this.url = url;
    this.secret = secret;
    this.sender = sender;
    this.fetchImpl = fetchImpl;
  }

  async #send(type, payload) {
    const body = JSON.stringify({ contractVersion: MAIL_DELIVERY_CONTRACT_VERSION, type, from: this.sender, ...payload });
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
    let ack;
    try { ack = await response.json(); } catch { throw new Error('Delivery webhook returned invalid provider acknowledgement'); }
    if (ack?.accepted !== true || typeof ack.provider !== 'string' || !ack.provider.trim() || typeof ack.provider_message_id !== 'string' || !ack.provider_message_id.trim()) {
      throw new Error('Delivery webhook did not return a provider acceptance acknowledgement');
    }
    return { accepted: true, provider: ack.provider, providerMessageId: ack.provider_message_id };
  }

  sendVerification(payload) { return this.#send('account_verification', payload); }
  sendPasswordReset(payload) { return this.#send('password_reset', payload); }
}
