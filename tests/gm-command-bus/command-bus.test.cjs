'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createGmCommandBus,
  ServiceUnavailableError,
} = require('../../services/gm-command-bus/src');

function actor() {
  return { id: 'admin-1', type: 'user', roles: ['root-gm'], authnMethod: 'mfa', sessionId: 'session-1' };
}

function req(overrides = {}) {
  return {
    requestId: 'req-00000001',
    command: 'player.kick',
    actor: actor(),
    reason: 'Operational moderation request',
    args: { playerId: 'player-1' },
    metadata: { source: 'ws08', correlationId: 'corr-1' },
    ...overrides,
  };
}

function harness({ allowed = true, adapters = {}, auditAppend } = {}) {
  const audit = [];
  const authorizer = {
    calls: [],
    async authorize(input) {
      this.calls.push(input);
      return { allowed, reason: allowed ? undefined : 'missing permission' };
    },
  };
  const auditSink = {
    async append(event) {
      if (auditAppend) return auditAppend(event, audit);
      audit.push(event);
    },
  };
  return {
    audit,
    authorizer,
    bus: createGmCommandBus({ adapters, authorizer, auditSink, timeoutMs: 75 }),
  };
}

test('executes an allowlisted command with actor/reason/request audit metadata', async () => {
  let calls = 0;
  const h = harness({
    adapters: {
      gameOperations: {
        async kickPlayer(ctx) {
          calls += 1;
          assert.equal(ctx.actor.id, 'admin-1');
          assert.equal(ctx.reason, 'Operational moderation request');
          assert.equal(ctx.args.playerId, 'player-1');
          return { disconnected: true };
        },
        async previewKickPlayer() { throw new Error('not expected'); },
      },
    },
  });

  const result = await h.bus.execute(req());
  assert.equal(result.status, 'ok');
  assert.equal(result.code, 'OK');
  assert.deepEqual(result.data, { disconnected: true });
  assert.equal(calls, 1);
  assert.equal(h.audit.length, 2);
  assert.equal(h.audit[0].event, 'command.accepted');
  assert.equal(h.audit[1].event, 'command.completed');
});

test('rejects commands not present in the server-side allowlist, including shell execution', async () => {
  const h = harness();
  const result = await h.bus.execute(req({ command: 'shell.exec', args: { command: 'rm -rf /' } }));
  assert.equal(result.status, 'failed');
  assert.equal(result.code, 'COMMAND_NOT_ALLOWED');
  assert.equal(h.authorizer.calls.length, 0);
  assert.equal(h.audit.length, 0);
});

test('authorization is enforced before adapter execution', async () => {
  let called = false;
  const h = harness({ allowed: false, adapters: { gameOperations: { async kickPlayer() { called = true; } } } });
  const result = await h.bus.execute(req());
  assert.equal(result.code, 'FORBIDDEN');
  assert.equal(called, false);
});

test('dry-run uses a separate preview adapter and never invokes the mutating operation', async () => {
  let executeCalls = 0;
  let previewCalls = 0;
  const h = harness({ adapters: { gameOperations: {
    async kickPlayer() { executeCalls += 1; },
    async previewKickPlayer() { previewCalls += 1; return { wouldDisconnect: true }; },
  } } });
  const result = await h.bus.execute(req({ requestId: 'req-00000002', dryRun: true }));
  assert.equal(result.status, 'dry-run');
  assert.equal(executeCalls, 0);
  assert.equal(previewCalls, 1);
});

test('dry-run is rejected for commands without an explicit preview handler', async () => {
  const h = harness({ adapters: { notices: { async sendGlobalNotice() { throw new Error('not expected'); } } } });
  const result = await h.bus.execute(req({ requestId: 'req-00000003', command: 'notice.global', args: { message: 'Maintenance soon' }, dryRun: true }));
  assert.equal(result.code, 'DRY_RUN_UNSUPPORTED');
});

test('concurrent duplicate request IDs execute only once', async () => {
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const h = harness({ adapters: { gameOperations: {
    async kickPlayer() { calls += 1; await gate; return { ok: true }; }, async previewKickPlayer() {},
  } } });
  const first = h.bus.execute(req({ requestId: 'req-00000004' }));
  const second = h.bus.execute(req({ requestId: 'req-00000004' }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal([a.idempotentReplay, b.idempotentReplay].filter(Boolean).length, 1);
  assert.equal(calls, 1);
});

test('maps adapter timeout to a failed command result and abort signal', async () => {
  let aborted = false;
  const h = harness({ adapters: { gameOperations: {
    async kickPlayer(ctx) {
      await new Promise((resolve) => ctx.signal.addEventListener('abort', () => { aborted = true; resolve(); }, { once: true }));
      throw new Error('after abort');
    }, async previewKickPlayer() {},
  } } });
  const result = await h.bus.execute(req({ requestId: 'req-00000005' }));
  assert.equal(result.code, 'TIMEOUT');
  assert.equal(aborted, true);
});

test('missing or unavailable game service is reported without arbitrary fallback behavior', async () => {
  const h = harness({ adapters: {} });
  assert.equal((await h.bus.execute(req({ requestId: 'req-00000006' }))).code, 'SERVICE_UNAVAILABLE');
  const h2 = harness({ adapters: { gameOperations: {
    async kickPlayer() { throw new ServiceUnavailableError('gameOperations'); }, async previewKickPlayer() {},
  } } });
  assert.equal((await h2.bus.execute(req({ requestId: 'req-00000007' }))).code, 'SERVICE_UNAVAILABLE');
});

test('ban delegates to moderation adapter rather than implementing database writes', async () => {
  let captured;
  const h = harness({ adapters: { moderation: {
    async banAccount(ctx) { captured = ctx; return { accepted: true }; }, async previewBanAccount() {},
  } } });
  const result = await h.bus.execute(req({ requestId: 'req-00000008', command: 'account.ban', args: { accountId: 'account-9', durationSeconds: 3600 } }));
  assert.equal(result.code, 'OK');
  assert.equal(captured.args.accountId, 'account-9');
});

test('audit acceptance failure is fail-closed before side effects', async () => {
  let called = false;
  const h = harness({ adapters: { gameOperations: {
    async kickPlayer() { called = true; }, async previewKickPlayer() {},
  } }, auditAppend() { throw new Error('audit offline'); } });
  const result = await h.bus.execute(req({ requestId: 'req-00000009' }));
  assert.equal(result.code, 'AUDIT_UNAVAILABLE');
  assert.equal(called, false);
});

test('sensitive arbitrary audit metadata is rejected', async () => {
  const h = harness();
  const result = await h.bus.execute(req({ requestId: 'req-00000010', metadata: { authToken: 'secret-value' } }));
  assert.equal(result.code, 'VALIDATION_ERROR');
});
