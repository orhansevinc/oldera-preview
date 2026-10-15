'use strict';

const { I16_MAX } = require('./shared-runtime-id-namespace');

const KIND = Object.freeze({ PLAYER: 'player', NPC: 'npc', MOB: 'mob' });
const NPC_NAMESPACE_KINDS = new Set([KIND.NPC, KIND.MOB]);

class SharedWorldAoi {
  constructor() {
    this.entities = new Map();
    this.zoneMembers = new Map();
    this.npcNamespace = new Map();
  }

  upsert(entity) {
    const normalized = normalizeEntity(entity);
    const key = entityKey(normalized.kind, normalized.runtimeId);
    const prior = this.entities.get(key);
    if (prior) this.#detach(prior, key);

    if (NPC_NAMESPACE_KINDS.has(normalized.kind)) {
      const claimedBy = this.npcNamespace.get(normalized.runtimeId);
      if (claimedBy && claimedBy !== key) throw new Error(`shared KO1298_NPC runtime ID collision ${normalized.runtimeId}`);
      this.npcNamespace.set(normalized.runtimeId, key);
    }

    this.entities.set(key, normalized);
    let zone = this.zoneMembers.get(normalized.zoneId);
    if (!zone) this.zoneMembers.set(normalized.zoneId, zone = new Set());
    zone.add(key);
    return normalized;
  }

  remove(kind, runtimeId) {
    const key = entityKey(kind, runtimeId);
    const prior = this.entities.get(key);
    if (!prior) return false;
    this.#detach(prior, key);
    this.entities.delete(key);
    return true;
  }

  leaveZone(zoneId, predicate = null) {
    const zone = this.zoneMembers.get(zoneId);
    if (!zone) return 0;
    let removed = 0;
    for (const key of [...zone]) {
      const entity = this.entities.get(key);
      if (!entity || (predicate && !predicate(entity))) continue;
      if (this.remove(entity.kind, entity.runtimeId)) removed += 1;
    }
    return removed;
  }

  visibleFrom({ zoneId, x, z, radius, exclude = null, kinds = null }) {
    assertCoordinate(zoneId, x, z);
    if (!Number.isFinite(radius) || radius < 0) throw new TypeError('radius must be a non-negative finite number');
    const zone = this.zoneMembers.get(zoneId);
    if (!zone) return [];
    const allowed = kinds ? new Set(kinds) : null;
    const r2 = radius * radius;
    const result = [];
    for (const key of zone) {
      if (exclude && key === entityKey(exclude.kind, exclude.runtimeId)) continue;
      const entity = this.entities.get(key);
      if (!entity || (allowed && !allowed.has(entity.kind))) continue;
      const dx = entity.x - x;
      const dz = entity.z - z;
      if (dx * dx + dz * dz <= r2) result.push(entity);
    }
    return result.sort(compareEntity);
  }

  snapshot(zoneId) {
    const zone = this.zoneMembers.get(zoneId);
    if (!zone) return Object.freeze([]);
    return Object.freeze([...zone].map((key) => this.entities.get(key)).filter(Boolean).sort(compareEntity));
  }

  #detach(entity, key) {
    const zone = this.zoneMembers.get(entity.zoneId);
    if (zone) {
      zone.delete(key);
      if (zone.size === 0) this.zoneMembers.delete(entity.zoneId);
    }
    if (NPC_NAMESPACE_KINDS.has(entity.kind) && this.npcNamespace.get(entity.runtimeId) === key) {
      this.npcNamespace.delete(entity.runtimeId);
    }
  }
}

function normalizeEntity(entity) {
  const kind = entity?.kind;
  if (!Object.values(KIND).includes(kind)) throw new TypeError(`unsupported AOI entity kind ${String(kind)}`);
  const runtimeId = entity.runtimeId;
  if (!Number.isInteger(runtimeId) || runtimeId < 0 || runtimeId > I16_MAX) throw new RangeError('runtimeId must fit KO1298 signed i16 identity field');
  const zoneId = entity.zoneId;
  assertCoordinate(zoneId, entity.x, entity.z);
  const y = Number(entity.y ?? 0);
  if (!Number.isFinite(y)) throw new TypeError('entity y must be finite');
  return Object.freeze({ ...entity, kind, runtimeId, zoneId, x: Number(entity.x), z: Number(entity.z), y });
}

function assertCoordinate(zoneId, x, z) {
  if (!Number.isInteger(zoneId) || zoneId < 0 || zoneId > 0xff) throw new RangeError('zoneId must fit uint8');
  if (!Number.isFinite(Number(x)) || !Number.isFinite(Number(z))) throw new TypeError('x/z must be finite');
}
function entityKey(kind, runtimeId) { return `${kind}:${runtimeId}`; }
function compareEntity(a, b) { return a.runtimeId - b.runtimeId || a.kind.localeCompare(b.kind); }

module.exports = { AOI_ENTITY_KIND: KIND, SharedWorldAoi };
