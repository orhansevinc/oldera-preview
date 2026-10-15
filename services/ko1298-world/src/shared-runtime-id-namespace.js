'use strict';

const I16_MAX = 0x7fff;

function assertInteger(value, label) {
  if (!Number.isInteger(value)) throw new TypeError(`${label} must be an integer`);
  return value;
}

function runtimeIdOf(value) {
  if (Number.isInteger(value)) return value;
  const id = value?.runtimeId ?? value?.instanceId ?? value?.nid;
  if (!Number.isInteger(id)) throw new TypeError('reserved runtime identity requires runtimeId/instanceId/nid');
  return id;
}

function createSharedNpcRuntimeIdNamespace({
  minInclusive,
  maxExclusive,
  reserved = [],
} = {}) {
  assertInteger(minInclusive, 'minInclusive');
  assertInteger(maxExclusive, 'maxExclusive');
  if (minInclusive < 0 || maxExclusive <= minInclusive || maxExclusive > I16_MAX + 1) {
    throw new RangeError('shared KO1298_NPC runtime namespace bounds must fit signed i16');
  }

  const occupied = new Map();
  const claims = new Map();
  let cursor = minInclusive;

  function reserve(value, metadata = {}) {
    const id = runtimeIdOf(value);
    if (id < minInclusive || id >= maxExclusive || id > I16_MAX) {
      throw new RangeError(`reserved runtime id ${id} is outside shared KO1298_NPC namespace`);
    }
    if (occupied.has(id)) {
      throw new Error(`shared KO1298_NPC runtime ID collision ${id}`);
    }
    occupied.set(id, Object.freeze({
      kind: metadata.kind ?? 'reserved',
      sourceIdentity: metadata.sourceIdentity ?? value?.sourceInstanceKey ?? value?.spawnKey ?? null,
    }));
    while (occupied.has(cursor) && cursor < maxExclusive) cursor += 1;
    return id;
  }

  for (const entry of reserved) reserve(entry, { kind: 'npc' });

  function claim(request = {}) {
    if (request.namespace !== 'KO1298_NPC') {
      throw new Error(`unsupported runtime namespace ${String(request.namespace)}`);
    }
    const sourceIdentity = String(request.sourceIdentity ?? '');
    if (!sourceIdentity) throw new TypeError('runtime claim sourceIdentity is required');
    const key = `${request.kind ?? 'entity'}:${sourceIdentity}`;
    if (claims.has(key)) return claims.get(key);

    while (occupied.has(cursor) && cursor < maxExclusive) cursor += 1;
    if (cursor >= maxExclusive || cursor > I16_MAX) {
      throw new RangeError('shared KO1298_NPC runtime namespace exhausted');
    }

    const id = cursor;
    occupied.set(id, Object.freeze({
      kind: request.kind ?? 'entity',
      sourceIdentity,
    }));
    claims.set(key, id);
    cursor += 1;
    while (occupied.has(cursor) && cursor < maxExclusive) cursor += 1;
    return id;
  }

  function snapshot() {
    return Object.freeze({
      minInclusive,
      maxExclusive,
      reserved: occupied.size - claims.size,
      claimed: claims.size,
      occupied: occupied.size,
      ids: Object.freeze([...occupied.keys()].sort((a, b) => a - b)),
    });
  }

  return Object.freeze({
    reserve,
    claim,
    snapshot,
  });
}

module.exports = {
  I16_MAX,
  createSharedNpcRuntimeIdNamespace,
};
