import { SIGNAL_TYPES } from './model.js';

const BLOCKED_KEY = /(payload|packet[_-]?body|raw|content|password|passwd|token|secret|cookie|authorization|bytes|buffer|chat|message[_-]?text|serial$)/i;
const MAX_STRING_LENGTH = 120;

export const EVIDENCE_ALLOWLIST = Object.freeze({
  [SIGNAL_TYPES.IMPOSSIBLE_MOVEMENT]: ['distance', 'elapsedMs', 'observedSpeed', 'maxSpeed', 'zoneId', 'movementMode', 'reasonCode'],
  [SIGNAL_TYPES.REPEATED_INVALID_POSITION]: ['zoneId', 'invalidCount', 'positionClass', 'reasonCode'],
  [SIGNAL_TYPES.IMPOSSIBLE_ATTACK_RANGE]: ['skillId', 'observedRange', 'maxRange', 'targetKind', 'reasonCode'],
  [SIGNAL_TYPES.IMPOSSIBLE_ATTACK_FREQUENCY]: ['skillId', 'attacks', 'windowMs', 'minIntervalMs', 'expectedMinIntervalMs', 'reasonCode'],
  [SIGNAL_TYPES.INVALID_SKILL_REQUEST]: ['skillId', 'requiredLevel', 'currentLevel', 'classId', 'reasonCode'],
  [SIGNAL_TYPES.INVALID_ITEM_OWNERSHIP]: ['itemId', 'containerKind', 'ownerKind', 'reasonCode'],
  [SIGNAL_TYPES.DUPLICATE_SERIAL_DETECTION]: ['itemId', 'serialHash', 'ownerCount', 'storageScopes', 'reasonCode'],
  [SIGNAL_TYPES.IMPOSSIBLE_COIN_TRANSACTION]: ['amount', 'balanceBefore', 'balanceAfter', 'operation', 'reasonCode'],
  [SIGNAL_TYPES.REPEATED_MALFORMED_PACKET_METADATA]: ['opcode', 'declaredLength', 'actualLength', 'direction', 'reasonCode'],
  [SIGNAL_TYPES.SUSPICIOUS_RECONNECT_PATTERN]: ['reconnects', 'windowMs', 'previousSessionAgeMs', 'reasonCode'],
  [SIGNAL_TYPES.EXCESSIVE_FAILED_ACTIONS]: ['actionCategory', 'failures', 'windowMs', 'reasonCode']
});

function safeScalar(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.slice(0, MAX_STRING_LENGTH);
  if (Array.isArray(value)) {
    const safe = value.slice(0, 8).map(safeScalar).filter((entry) => entry !== undefined && !Array.isArray(entry));
    return safe;
  }
  return undefined;
}

export function sanitizeEvidence(type, evidence = {}) {
  const allowed = EVIDENCE_ALLOWLIST[type] ?? [];
  const result = {};
  for (const key of allowed) {
    if (BLOCKED_KEY.test(key)) continue;
    if (!Object.prototype.hasOwnProperty.call(evidence, key)) continue;
    const value = safeScalar(evidence[key]);
    if (value !== undefined) result[key] = value;
  }
  return result;
}

export function containsSensitiveEvidenceKey(value) {
  if (!value || typeof value !== 'object') return false;
  return Object.keys(value).some((key) => BLOCKED_KEY.test(key));
}
