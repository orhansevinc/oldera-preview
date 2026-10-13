import test from 'node:test';
import assert from 'node:assert/strict';
import {
  contextFromHeaders,
  contextLogFields,
  createRequestContext,
  getContext,
  responseContextHeaders,
  runWithContext,
  withSessionId
} from '../../packages/oldko-observability/src/index.js';

test('request context accepts safe propagated ids and generates missing ids', async () => {
  const context = contextFromHeaders({
    'x-correlation-id': 'corr-123',
    'x-request-id': 'req-456',
    'x-session-id': 'sess-789'
  });

  assert.deepEqual(context, {
    correlationId: 'corr-123',
    requestId: 'req-456',
    sessionId: 'sess-789'
  });

  await runWithContext(context, async () => {
    await Promise.resolve();
    assert.equal(getContext().requestId, 'req-456');
    assert.deepEqual(contextLogFields(), {
      correlation_id: 'corr-123',
      request_id: 'req-456',
      session_id: 'sess-789'
    });
    assert.deepEqual(responseContextHeaders(), {
      'x-correlation-id': 'corr-123',
      'x-request-id': 'req-456'
    });
  });
});

test('unsafe ids are rejected and session can be scoped', async () => {
  const generated = createRequestContext({ requestId: 'contains spaces', correlationId: '<script>' });
  assert.match(generated.requestId, /^[0-9a-f-]{36}$/);
  assert.equal(generated.correlationId, generated.requestId);

  await runWithContext({ requestId: 'req-1', correlationId: 'corr-1' }, async () => {
    assert.equal(getContext().sessionId, undefined);
    await withSessionId('game-session:42', async () => {
      assert.equal(getContext().sessionId, 'game-session:42');
    });
    assert.equal(getContext().sessionId, undefined);
  });
});
