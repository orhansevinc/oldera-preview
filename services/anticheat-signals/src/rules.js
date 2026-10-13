import { SEVERITIES, SIGNAL_TYPES } from './model.js';

const BASE = Object.freeze({
  enabled: true,
  version: 1,
  aggregationWindowMs: 10_000,
  threshold: 1,
  suppressionWindowMs: 5_000
});

const DEFAULT_RULES = Object.freeze({
  [SIGNAL_TYPES.IMPOSSIBLE_MOVEMENT]: { severity: 'high', points: 25, aggregationWindowMs: 5_000, threshold: 1, suppressionWindowMs: 3_000 },
  [SIGNAL_TYPES.REPEATED_INVALID_POSITION]: { severity: 'medium', points: 12, aggregationWindowMs: 10_000, threshold: 3, suppressionWindowMs: 10_000 },
  [SIGNAL_TYPES.IMPOSSIBLE_ATTACK_RANGE]: { severity: 'high', points: 22, aggregationWindowMs: 5_000, threshold: 1, suppressionWindowMs: 3_000 },
  [SIGNAL_TYPES.IMPOSSIBLE_ATTACK_FREQUENCY]: { severity: 'high', points: 22, aggregationWindowMs: 5_000, threshold: 3, suppressionWindowMs: 5_000 },
  [SIGNAL_TYPES.INVALID_SKILL_REQUEST]: { severity: 'medium', points: 10, aggregationWindowMs: 10_000, threshold: 3, suppressionWindowMs: 10_000 },
  [SIGNAL_TYPES.INVALID_ITEM_OWNERSHIP]: { severity: 'high', points: 25, aggregationWindowMs: 30_000, threshold: 1, suppressionWindowMs: 30_000 },
  [SIGNAL_TYPES.DUPLICATE_SERIAL_DETECTION]: { severity: 'critical', points: 40, aggregationWindowMs: 60_000, threshold: 1, suppressionWindowMs: 60_000 },
  [SIGNAL_TYPES.IMPOSSIBLE_COIN_TRANSACTION]: { severity: 'high', points: 25, aggregationWindowMs: 30_000, threshold: 1, suppressionWindowMs: 30_000 },
  [SIGNAL_TYPES.REPEATED_MALFORMED_PACKET_METADATA]: { severity: 'medium', points: 8, aggregationWindowMs: 10_000, threshold: 5, suppressionWindowMs: 10_000 },
  [SIGNAL_TYPES.SUSPICIOUS_RECONNECT_PATTERN]: { severity: 'medium', points: 10, aggregationWindowMs: 60_000, threshold: 4, suppressionWindowMs: 60_000 },
  [SIGNAL_TYPES.EXCESSIVE_FAILED_ACTIONS]: { severity: 'low', points: 5, aggregationWindowMs: 30_000, threshold: 10, suppressionWindowMs: 30_000 }
});

const severitySet = new Set(SEVERITIES);
const typeSet = new Set(Object.values(SIGNAL_TYPES));

function positiveInteger(value, field, allowZero = false) {
  const ok = Number.isInteger(value) && (allowZero ? value >= 0 : value > 0);
  if (!ok) throw new TypeError(`${field} must be ${allowZero ? 'a non-negative' : 'a positive'} integer`);
}

export function buildRuleConfig(overrides = {}) {
  for (const type of Object.keys(overrides)) {
    if (!typeSet.has(type)) throw new TypeError(`unknown rule type: ${type}`);
  }

  const rules = {};
  for (const type of Object.values(SIGNAL_TYPES)) {
    const merged = {
      ...BASE,
      ...DEFAULT_RULES[type],
      ...(overrides[type] ?? {}),
      id: `ws47.${type}`
    };
    if (typeof merged.enabled !== 'boolean') throw new TypeError(`${type}.enabled must be boolean`);
    if (!severitySet.has(merged.severity)) throw new TypeError(`${type}.severity is invalid`);
    positiveInteger(merged.version, `${type}.version`);
    positiveInteger(merged.points, `${type}.points`, true);
    positiveInteger(merged.aggregationWindowMs, `${type}.aggregationWindowMs`);
    positiveInteger(merged.threshold, `${type}.threshold`);
    positiveInteger(merged.suppressionWindowMs, `${type}.suppressionWindowMs`, true);
    rules[type] = Object.freeze(merged);
  }
  return Object.freeze(rules);
}

export { DEFAULT_RULES };
