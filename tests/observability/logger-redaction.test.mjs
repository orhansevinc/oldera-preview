import test from 'node:test';
import assert from 'node:assert/strict';
import { createLogger, redact, runWithContext } from '../../packages/oldko-observability/src/index.js';

test('JSON logger emits required service/context fields and redacts secrets and payloads', async () => {
  const lines = [];
  const logger = createLogger({
    serviceName: 'account-api',
    serviceVersion: '1.2.3',
    minLevel: 'debug',
    clock: () => new Date('2026-10-14T00:00:00.000Z'),
    sink: (line) => lines.push(line)
  });

  await runWithContext({ correlationId: 'corr-1', requestId: 'req-1', sessionId: 'sess-1' }, async () => {
    logger.info('login_attempt', {
      username: 'player',
      password: 'secret-pass',
      authorization: 'Bearer abc',
      payload: 'raw-login-body',
      nested: { access_token: 'token-123' },
      bytes: Buffer.from([1, 2, 3])
    });
  });

  assert.equal(lines.length, 1);
  const record = JSON.parse(lines[0]);
  assert.equal(record.timestamp, '2026-10-14T00:00:00.000Z');
  assert.equal(record.level, 'info');
  assert.equal(record.message, 'login_attempt');
  assert.equal(record.service_name, 'account-api');
  assert.equal(record.service_version, '1.2.3');
  assert.equal(record.correlation_id, 'corr-1');
  assert.equal(record.request_id, 'req-1');
  assert.equal(record.session_id, 'sess-1');
  assert.equal(record.username, 'player');
  assert.equal(record.password, '[REDACTED]');
  assert.equal(record.authorization, '[REDACTED]');
  assert.equal(record.payload, '[REDACTED]');
  assert.equal(record.nested.access_token, '[REDACTED]');
  assert.equal(record.bytes, '[REDACTED_BINARY]');
});

test('logger respects minimum level and child fields', () => {
  const records = [];
  const logger = createLogger({
    serviceName: 'world',
    serviceVersion: '0.9.0',
    minLevel: 'warn',
    sink: (_line, _level, record) => records.push(record)
  }).child({ component: 'zone-router' });

  logger.info('ignored');
  logger.warn('visible', { zone_id: 21 });

  assert.equal(records.length, 1);
  assert.equal(records[0].component, 'zone-router');
  assert.equal(records[0].zone_id, 21);
});

test('redaction handles circular and oversized values safely', () => {
  const object = { apiKey: 'abc', note: 'abcdef' };
  object.self = object;
  const result = redact(object, { maxStringLength: 3 });
  assert.equal(result.apiKey, '[REDACTED]');
  assert.match(result.note, /^abc…\[truncated:3\]$/);
  assert.equal(result.self, '[CIRCULAR]');
});
