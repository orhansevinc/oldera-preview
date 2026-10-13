import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AntiCheatSignalEngine,
  InMemoryAdminReviewAdapter,
  InMemoryObservabilityAdapter,
  SIGNAL_TYPES,
  buildRuleConfig,
  sanitizeEvidence
} from '../../services/anticheat-signals/src/index.js';

function harness(options = {}) {
  let now = 1_700_000_000_000;
  let id = 0;
  const reviewAdapter = options.reviewAdapter ?? new InMemoryAdminReviewAdapter();
  const observability = options.observability ?? new InMemoryObservabilityAdapter();
  const engine = new AntiCheatSignalEngine({
    rules: options.rules,
    riskWindowMs: options.riskWindowMs,
    reviewAdapter,
    observability,
    clock: () => now,
    idFactory: () => `sig-${++id}`
  });
  return {
    engine,
    reviewAdapter,
    observability,
    advance(ms) { now += ms; },
    now() { return now; }
  };
}

const baseCandidate = (type, evidence = {}) => ({
  type,
  subject: { kind: 'character', id: 'char-17' },
  sessionId: 'sess-99',
  correlationId: 'corr-1',
  source: 'game-server',
  evidence
});

test('one-off impossible movement emits a review-only typed signal', async () => {
  const h = harness();
  const result = await h.engine.record(baseCandidate(SIGNAL_TYPES.IMPOSSIBLE_MOVEMENT, {
    distance: 60,
    elapsedMs: 100,
    observedSpeed: 600,
    maxSpeed: 8,
    zoneId: 21,
    reasonCode: 'speed_envelope'
  }));

  assert.equal(result.emitted, true);
  assert.equal(result.signal.schemaVersion, 1);
  assert.equal(result.signal.severity, 'high');
  assert.equal(result.signal.disposition, 'admin_review');
  assert.equal(result.signal.autoAction, 'none');
  assert.equal(result.signal.sessionId, 'sess-99');
  assert.equal(result.signal.correlationId, 'corr-1');
  assert.equal(result.signal.aggregation.occurrenceCount, 1);
  assert.equal(h.reviewAdapter.signals.length, 1);
});

test('repeated invalid position uses a threshold within a time window', async () => {
  const h = harness();
  for (let i = 1; i <= 2; i += 1) {
    const result = await h.engine.record(baseCandidate(SIGNAL_TYPES.REPEATED_INVALID_POSITION, { zoneId: 1, invalidCount: i }));
    assert.equal(result.emitted, false);
    assert.equal(result.reason, 'below_threshold');
  }
  const third = await h.engine.record(baseCandidate(SIGNAL_TYPES.REPEATED_INVALID_POSITION, { zoneId: 1, invalidCount: 3 }));
  assert.equal(third.emitted, true);
  assert.equal(third.signal.aggregation.occurrenceCount, 3);
});

test('expired observations do not satisfy a threshold', async () => {
  const h = harness();
  await h.engine.record(baseCandidate(SIGNAL_TYPES.REPEATED_INVALID_POSITION));
  await h.engine.record(baseCandidate(SIGNAL_TYPES.REPEATED_INVALID_POSITION));
  h.advance(10_001);
  const result = await h.engine.record(baseCandidate(SIGNAL_TYPES.REPEATED_INVALID_POSITION));
  assert.equal(result.emitted, false);
  assert.equal(result.occurrenceCount, 1);
});

test('duplicate emission suppression reduces alert floods without losing rate count', async () => {
  const h = harness({
    rules: {
      [SIGNAL_TYPES.IMPOSSIBLE_MOVEMENT]: { threshold: 1, aggregationWindowMs: 20_000, suppressionWindowMs: 5_000 }
    }
  });
  const first = await h.engine.record(baseCandidate(SIGNAL_TYPES.IMPOSSIBLE_MOVEMENT));
  h.advance(100);
  const second = await h.engine.record(baseCandidate(SIGNAL_TYPES.IMPOSSIBLE_MOVEMENT));
  assert.equal(first.emitted, true);
  assert.equal(second.emitted, false);
  assert.equal(second.reason, 'duplicate_suppressed');
  assert.equal(second.occurrenceCount, 2);
  h.advance(5_000);
  const third = await h.engine.record(baseCandidate(SIGNAL_TYPES.IMPOSSIBLE_MOVEMENT));
  assert.equal(third.emitted, true);
  assert.equal(third.signal.aggregation.occurrenceCount, 3);
});

test('risk score aggregates emitted signals in a bounded rolling window', async () => {
  const h = harness({ riskWindowMs: 1_000 });
  const movement = await h.engine.record(baseCandidate(SIGNAL_TYPES.IMPOSSIBLE_MOVEMENT));
  const range = await h.engine.record(baseCandidate(SIGNAL_TYPES.IMPOSSIBLE_ATTACK_RANGE));
  assert.equal(movement.signal.risk.rollingScore, 25);
  assert.equal(range.signal.risk.rollingScore, 47);
  assert.equal(h.engine.getRiskScore({ kind: 'character', id: 'char-17' }), 47);
  h.advance(1_001);
  assert.equal(h.engine.getRiskScore({ kind: 'character', id: 'char-17' }), 0);
});

test('evidence is allowlisted and sensitive packet content is never retained', async () => {
  const h = harness({
    rules: {
      [SIGNAL_TYPES.REPEATED_MALFORMED_PACKET_METADATA]: { threshold: 1 }
    }
  });
  const result = await h.engine.record(baseCandidate(SIGNAL_TYPES.REPEATED_MALFORMED_PACKET_METADATA, {
    opcode: 0x31,
    declaredLength: 4,
    actualLength: 90,
    direction: 'client_to_server',
    reasonCode: 'length_mismatch',
    payload: 'SECRET PACKET CONTENT',
    rawBytes: [1, 2, 3],
    token: 'secret-token',
    arbitraryField: 'drop-me'
  }));
  assert.deepEqual(result.signal.evidence, {
    opcode: 0x31,
    declaredLength: 4,
    actualLength: 90,
    direction: 'client_to_server',
    reasonCode: 'length_mismatch'
  });
  assert.equal(JSON.stringify(result.signal).includes('SECRET PACKET CONTENT'), false);
  assert.equal(JSON.stringify(result.signal).includes('secret-token'), false);
});

test('duplicate serial evidence expects a derived hash, never the raw serial', () => {
  const clean = sanitizeEvidence(SIGNAL_TYPES.DUPLICATE_SERIAL_DETECTION, {
    itemId: 900001,
    serialHash: 'sha256:abcdef',
    serial: 'RAW-SERIAL-123',
    ownerCount: 2,
    storageScopes: ['inventory', 'inn']
  });
  assert.deepEqual(clean, {
    itemId: 900001,
    serialHash: 'sha256:abcdef',
    ownerCount: 2,
    storageScopes: ['inventory', 'inn']
  });
});

test('disabled rules produce no signal and no review submission', async () => {
  const h = harness({ rules: { [SIGNAL_TYPES.INVALID_ITEM_OWNERSHIP]: { enabled: false } } });
  const result = await h.engine.record(baseCandidate(SIGNAL_TYPES.INVALID_ITEM_OWNERSHIP, { itemId: 1 }));
  assert.deepEqual(result, { emitted: false, reason: 'rule_disabled' });
  assert.equal(h.reviewAdapter.signals.length, 0);
});

test('attack frequency and failed actions use independent rate counters', async () => {
  const h = harness({
    rules: {
      [SIGNAL_TYPES.IMPOSSIBLE_ATTACK_FREQUENCY]: { threshold: 2, suppressionWindowMs: 0 },
      [SIGNAL_TYPES.EXCESSIVE_FAILED_ACTIONS]: { threshold: 2, suppressionWindowMs: 0 }
    }
  });
  assert.equal((await h.engine.record(baseCandidate(SIGNAL_TYPES.IMPOSSIBLE_ATTACK_FREQUENCY))).emitted, false);
  assert.equal((await h.engine.record(baseCandidate(SIGNAL_TYPES.EXCESSIVE_FAILED_ACTIONS))).emitted, false);
  assert.equal((await h.engine.record(baseCandidate(SIGNAL_TYPES.IMPOSSIBLE_ATTACK_FREQUENCY))).emitted, true);
  assert.equal((await h.engine.record(baseCandidate(SIGNAL_TYPES.EXCESSIVE_FAILED_ACTIONS))).emitted, true);
});

test('observability output carries metadata but not evidence body', async () => {
  const h = harness();
  await h.engine.record(baseCandidate(SIGNAL_TYPES.IMPOSSIBLE_COIN_TRANSACTION, {
    amount: 999999,
    balanceBefore: 1,
    balanceAfter: 1000000,
    operation: 'merchant_sell',
    reasonCode: 'balance_invariant'
  }));
  const emitted = h.observability.events.find((entry) => entry.eventName === 'anticheat.signal');
  assert.ok(emitted);
  assert.equal(Object.hasOwn(emitted.fields, 'evidence'), false);
  assert.equal(emitted.fields.autoAction, 'none');
});

test('review adapter failures are observable and never trigger enforcement', async () => {
  const observability = new InMemoryObservabilityAdapter();
  const h = harness({
    observability,
    reviewAdapter: { async submit() { throw new Error('review unavailable'); } }
  });
  const result = await h.engine.record(baseCandidate(SIGNAL_TYPES.IMPOSSIBLE_ATTACK_RANGE));
  assert.equal(result.emitted, true);
  assert.equal(result.signal.autoAction, 'none');
  assert.ok(observability.events.some((entry) => entry.eventName === 'anticheat.review_adapter_error'));
});

test('rule configuration rejects unknown types and invalid thresholds', () => {
  assert.throws(() => buildRuleConfig({ unknown_signal: { threshold: 1 } }), /unknown rule type/);
  assert.throws(() => buildRuleConfig({ [SIGNAL_TYPES.INVALID_SKILL_REQUEST]: { threshold: 0 } }), /positive integer/);
  assert.throws(() => buildRuleConfig({ [SIGNAL_TYPES.INVALID_SKILL_REQUEST]: { severity: 'ban-now' } }), /severity is invalid/);
});

test('candidate validation prevents malformed state from entering the pipeline', async () => {
  const h = harness();
  await assert.rejects(
    h.engine.record({ type: SIGNAL_TYPES.IMPOSSIBLE_MOVEMENT, subject: { kind: 'character', id: '' } }),
    /subject.id/
  );
  await assert.rejects(
    h.engine.record({ type: 'client_file_scan', subject: { kind: 'character', id: 'x' } }),
    /unknown signal type/
  );
});
