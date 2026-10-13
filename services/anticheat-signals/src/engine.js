import { createSignal, validateCandidate } from './model.js';
import { sanitizeEvidence } from './privacy.js';
import { buildRuleConfig } from './rules.js';
import { RiskWindowStore, SlidingWindowCounterStore } from './counters.js';
import { NoopAdminReviewAdapter, NoopObservabilityAdapter } from './adapters.js';

const DEFAULT_RISK_WINDOW_MS = 15 * 60_000;

function subjectKey(subject) {
  return `${subject.kind}:${subject.id.trim()}`;
}

function counterKey(candidate, rule) {
  return [rule.id, subjectKey(candidate.subject), candidate.sessionId?.trim() ?? '-'].join('|');
}

function emissionKey(candidate, rule) {
  return [rule.id, subjectKey(candidate.subject), candidate.sessionId?.trim() ?? '-'].join('|');
}

export class AntiCheatSignalEngine {
  #rules;
  #counterStore;
  #riskStore;
  #lastEmission = new Map();
  #reviewAdapter;
  #observability;
  #clock;
  #idFactory;
  #riskWindowMs;

  constructor({
    rules = {},
    reviewAdapter = new NoopAdminReviewAdapter(),
    observability = new NoopObservabilityAdapter(),
    clock = () => Date.now(),
    idFactory,
    riskWindowMs = DEFAULT_RISK_WINDOW_MS
  } = {}) {
    if (!Number.isInteger(riskWindowMs) || riskWindowMs <= 0) throw new TypeError('riskWindowMs must be a positive integer');
    this.#rules = buildRuleConfig(rules);
    this.#counterStore = new SlidingWindowCounterStore();
    this.#riskStore = new RiskWindowStore();
    this.#reviewAdapter = reviewAdapter;
    this.#observability = observability;
    this.#clock = clock;
    this.#idFactory = idFactory;
    this.#riskWindowMs = riskWindowMs;
  }

  getRule(type) {
    return this.#rules[type];
  }

  getRiskScore(subject) {
    return this.#riskStore.score(subjectKey(subject), this.#clock(), this.#riskWindowMs);
  }

  async record(candidate) {
    validateCandidate(candidate);
    const rule = this.#rules[candidate.type];
    const now = candidate.observedAt ?? this.#clock();

    if (!rule.enabled) {
      this.#observability.emit('anticheat.signal_ignored', {
        type: candidate.type,
        reason: 'rule_disabled',
        subjectKind: candidate.subject.kind
      });
      return { emitted: false, reason: 'rule_disabled' };
    }

    const aggregate = this.#counterStore.hit(counterKey(candidate, rule), now, rule.aggregationWindowMs);
    this.#observability.emit('anticheat.observation', {
      type: candidate.type,
      subjectKind: candidate.subject.kind,
      occurrenceCount: aggregate.count,
      threshold: rule.threshold
    });

    if (aggregate.count < rule.threshold) {
      return { emitted: false, reason: 'below_threshold', occurrenceCount: aggregate.count };
    }

    const suppressKey = emissionKey(candidate, rule);
    const previousEmissionAt = this.#lastEmission.get(suppressKey);
    if (previousEmissionAt != null && now - previousEmissionAt < rule.suppressionWindowMs) {
      this.#observability.emit('anticheat.signal_suppressed', {
        type: candidate.type,
        subjectKind: candidate.subject.kind,
        occurrenceCount: aggregate.count,
        suppressionWindowMs: rule.suppressionWindowMs
      });
      return { emitted: false, reason: 'duplicate_suppressed', occurrenceCount: aggregate.count };
    }

    this.#lastEmission.set(suppressKey, now);
    const evidence = sanitizeEvidence(candidate.type, candidate.evidence);
    const riskScore = this.#riskStore.add(subjectKey(candidate.subject), rule.points, now, this.#riskWindowMs);
    const signal = createSignal({
      candidate,
      rule,
      evidence,
      aggregation: {
        occurrenceCount: aggregate.count,
        threshold: rule.threshold,
        windowMs: rule.aggregationWindowMs,
        firstSeenAt: new Date(aggregate.firstSeenAt).toISOString(),
        lastSeenAt: new Date(aggregate.lastSeenAt).toISOString()
      },
      risk: {
        points: rule.points,
        rollingScore: riskScore,
        windowMs: this.#riskWindowMs
      },
      now,
      idFactory: this.#idFactory
    });

    this.#observability.emit('anticheat.signal', {
      signalId: signal.signalId,
      type: signal.type,
      severity: signal.severity,
      subjectKind: signal.subject.kind,
      sessionId: signal.sessionId,
      correlationId: signal.correlationId,
      ruleId: signal.rule.id,
      occurrenceCount: signal.aggregation.occurrenceCount,
      riskScore: signal.risk.rollingScore,
      autoAction: 'none'
    });

    try {
      await this.#reviewAdapter.submit(signal);
    } catch (error) {
      this.#observability.emit('anticheat.review_adapter_error', {
        signalId: signal.signalId,
        type: signal.type,
        errorName: error?.name ?? 'Error'
      });
    }

    return { emitted: true, signal };
  }
}
