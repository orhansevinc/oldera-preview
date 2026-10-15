import test from 'node:test';
import assert from 'node:assert/strict';
import { WebhookDelivery } from '../../services/account-api/src/delivery.js';
import { buildDelivery, parseAllowedOrigins, parseTrustProxy, PRODUCTION_ORIGIN } from '../../services/account-api/src/production-runtime.js';

test('production origin allow-list is exact and trust proxy requires explicit configuration', () => {
  assert.deepEqual(parseAllowedOrigins({ NODE_ENV: 'production', OLDKO_ACCOUNT_ALLOWED_ORIGINS: PRODUCTION_ORIGIN }), [PRODUCTION_ORIGIN]);
  assert.throws(() => parseAllowedOrigins({ NODE_ENV: 'production', OLDKO_ACCOUNT_ALLOWED_ORIGINS: `${PRODUCTION_ORIGIN},https://evil.example` }), /must be exactly/);
  assert.throws(() => parseAllowedOrigins({ NODE_ENV: 'production' }), /must be exactly/);
  assert.equal(parseTrustProxy({ NODE_ENV: 'production', OLDKO_TRUST_PROXY: '1' }), true);
  assert.equal(parseTrustProxy({ NODE_ENV: 'production', OLDKO_TRUST_PROXY: '0' }), false);
  assert.throws(() => parseTrustProxy({ NODE_ENV: 'production' }), /explicit/);
});

test('production delivery fails closed and requires HTTPS receiver plus verified-domain sender', () => {
  assert.throws(() => buildDelivery({ NODE_ENV: 'production' }), /requires delivery webhook/);
  assert.throws(() => buildDelivery({ NODE_ENV: 'production', OLDKO_ACCOUNT_DELIVERY_WEBHOOK_URL: 'https://delivery.example/hook' }), /configured together/);
  assert.throws(() => buildDelivery({ NODE_ENV: 'production', OLDKO_ACCOUNT_DELIVERY_WEBHOOK_URL: 'http://delivery.example/hook', OLDKO_ACCOUNT_DELIVERY_WEBHOOK_SECRET: 'secret', OLDKO_ACCOUNT_MAIL_FROM: 'accounts@oldkoweb.com' }), /must use HTTPS/);
  assert.throws(() => buildDelivery({ NODE_ENV: 'production', OLDKO_ACCOUNT_DELIVERY_WEBHOOK_URL: 'https://delivery.example/hook', OLDKO_ACCOUNT_DELIVERY_WEBHOOK_SECRET: 'secret', OLDKO_ACCOUNT_MAIL_FROM: 'accounts@example.com' }), /verified oldkoweb.com domain/);
  const delivery = buildDelivery({ NODE_ENV: 'production', OLDKO_ACCOUNT_DELIVERY_WEBHOOK_URL: 'https://delivery.example/hook', OLDKO_ACCOUNT_DELIVERY_WEBHOOK_SECRET: 'secret', OLDKO_ACCOUNT_MAIL_FROM: 'accounts@oldkoweb.com' });
  assert.equal(delivery.constructor.name, 'WebhookDelivery');
});

test('delivery webhook requires explicit provider acceptance; HTTP 200 alone is not delivery proof', async () => {
  let captured;
  const accepted = new WebhookDelivery({
    url: 'https://delivery.example/hook', secret: 'secret', sender: 'accounts@oldkoweb.com',
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return new Response(JSON.stringify({ accepted: true, provider: 'sandbox-mail', provider_message_id: 'msg-123' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });
  const result = await accepted.sendVerification({ accountId: 'acct-1', email: 'controlled@example.test', token: 'secret-token-value', expiresAt: 123 });
  assert.deepEqual(result, { accepted: true, provider: 'sandbox-mail', providerMessageId: 'msg-123' });
  const body = JSON.parse(captured.options.body);
  assert.equal(body.contractVersion, 'oldko.account-mail.v1');
  assert.equal(body.from, 'accounts@oldkoweb.com');
  assert.equal(body.token, 'secret-token-value');
  assert.match(captured.options.headers['x-oldko-signature'], /^sha256=[a-f0-9]{64}$/);

  const bare200 = new WebhookDelivery({
    url: 'https://delivery.example/hook', secret: 'secret', sender: 'accounts@oldkoweb.com',
    fetchImpl: async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
  });
  await assert.rejects(() => bare200.sendPasswordReset({ accountId: 'acct-1', email: 'controlled@example.test', token: 'token', expiresAt: 123 }), /provider acceptance acknowledgement/);
});
