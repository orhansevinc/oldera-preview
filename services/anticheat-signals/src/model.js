import { randomUUID } from 'node:crypto';

export const SIGNAL_TYPES = Object.freeze({
  IMPOSSIBLE_MOVEMENT: 'impossible_movement',
  REPEATED_INVALID_POSITION: 'repeated_invalid_position',
  IMPOSSIBLE_ATTACK_RANGE: 'impossible_attack_range',
  IMPOSSIBLE_ATTACK_FREQUENCY: 'impossible_attack_frequency',
  INVALID_SKILL_REQUEST: 'invalid_skill_request',
  INVALID_ITEM_OWNERSHIP: 'invalid_item_ownership',
  DUPLICATE_SERIAL_DETECTION: 'duplicate_serial_detection',
  IMPOSSIBLE_COIN_TRANSACTION: 'impossible_coin_transaction',
  REPEATED_MALFORMED_PACKET_METADATA: 'repeated_malformed_packet_metadata',
  SUSPICIOUS_RECONNECT_PATTERN: 'suspicious_reconnect_pattern',
  EXCESSIVE_FAILED_ACTIONS: 'excessive_failed_actions'
});

export const SEVERITIES = Object.freeze(['info', 'low', 'medium', 'high', 'critical']);
export const SUBJECT_KINDS = Object.freeze(['session', 'account', 'character', 'item', 'transaction']);

const SIGNAL_TYPE_SET = new Set(Object.values(SIGNAL_TYPES));
const SEVERITY_SET = new Set(SEVERITIES);
const SUBJECT_KIND_SET = new Set(SUBJECT_KINDS);

function nonEmptyString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${field} must be a non-empty string`);
  return value.trim();
}

export function validateCandidate(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new TypeError('candidate must be an object');
  if (!SIGNAL_TYPE_SET.has(candidate.type)) throw new TypeError(`unknown signal type: ${candidate.type}`);
  if (!candidate.subject || typeof candidate.subject !== 'object') throw new TypeError('subject is required');
  if (!SUBJECT_KIND_SET.has(candidate.subject.kind)) throw new TypeError(`unknown subject kind: ${candidate.subject.kind}`);
  nonEmptyString(candidate.subject.id, 'subject.id');
  if (candidate.sessionId != null) nonEmptyString(candidate.sessionId, 'sessionId');
  if (candidate.correlationId != null) nonEmptyString(candidate.correlationId, 'correlationId');
  if (candidate.source != null) nonEmptyString(candidate.source, 'source');
  if (candidate.observedAt != null && !Number.isFinite(candidate.observedAt)) throw new TypeError('observedAt must be epoch milliseconds');
  if (candidate.evidence != null && (typeof candidate.evidence !== 'object' || Array.isArray(candidate.evidence))) {
    throw new TypeError('evidence must be an object');
  }
}

export function createSignal({
  candidate,
  rule,
  evidence,
  aggregation,
  risk,
  now,
  idFactory = randomUUID
}) {
  if (!SEVERITY_SET.has(rule.severity)) throw new TypeError(`unknown severity: ${rule.severity}`);
  return Object.freeze({
    schemaVersion: 1,
    signalId: idFactory(),
    type: candidate.type,
    severity: rule.severity,
    observedAt: new Date(now).toISOString(),
    subject: Object.freeze({ kind: candidate.subject.kind, id: candidate.subject.id.trim() }),
    sessionId: candidate.sessionId?.trim() ?? null,
    correlationId: candidate.correlationId?.trim() ?? null,
    source: candidate.source?.trim() ?? 'server',
    rule: Object.freeze({ id: rule.id, version: rule.version }),
    evidence: Object.freeze(evidence),
    aggregation: Object.freeze(aggregation),
    risk: Object.freeze(risk),
    disposition: 'admin_review',
    autoAction: 'none'
  });
}
