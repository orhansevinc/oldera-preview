import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDelivery, parseAllowedOrigins, parseTrustProxy, PRODUCTION_ORIGIN } from '../../services/account-api/src/production-runtime.js';

test('production origin allow-list is exact and trust proxy requires explicit configuration', () => {
  assert.deepEqual(parseAllowedOrigins({ NODE_ENV: 'production', OLDKO_ACCOUNT_ALLOWED_ORIGINS: PRODUCTION_ORIGIN }), [PRODUCTION_ORIGIN]);
  assert.throws(() => parseAllowedOrigins({ NODE_ENV: 'production', OLDKO_ACCOUNT_ALLOWED_ORIGINS: `${PRODUCTION_ORIGIN},https://evil.example` }), /must be exactly/);
  assert.throws(() => parseAllowedOrigins({ NODE_ENV: 'production' }), /must be exactly/);
  assert.equal(parseTrustProxy({ NODE_ENV: 'production', OLDKO_TRUST_PROXY: '1' }), true);
  assert.equal(parseTrustProxy({ NODE_ENV: 'production', OLDKO_TRUST_PROXY: '0' }), false);
  assert.throws(() => parseTrustProxy({ NODE_ENV: 'production' }), /explicit/);
});

test('production delivery fails closed and only accepts HTTPS webhook configuration', () => {
  assert.throws(() => buildDelivery({ NODE_ENV: 'production' }), /requires delivery webhook/);
  assert.throws(() => buildDelivery({ NODE_ENV: 'production', OLDKO_ACCOUNT_DELIVERY_WEBHOOK_URL: 'https://delivery.example/hook' }), /configured together/);
  assert.throws(() => buildDelivery({ NODE_ENV: 'production', OLDKO_ACCOUNT_DELIVERY_WEBHOOK_URL: 'http://delivery.example/hook', OLDKO_ACCOUNT_DELIVERY_WEBHOOK_SECRET: 'secret' }), /must use HTTPS/);
  const delivery = buildDelivery({ NODE_ENV: 'production', OLDKO_ACCOUNT_DELIVERY_WEBHOOK_URL: 'https://delivery.example/hook', OLDKO_ACCOUNT_DELIVERY_WEBHOOK_SECRET: 'secret' });
  assert.equal(delivery.constructor.name, 'WebhookDelivery');
});
