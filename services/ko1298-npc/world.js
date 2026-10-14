'use strict';

const { NPC_BAND, INVALID_BAND, VIEW_DISTANCE, validateNpcRecord } = require('./protocol');

function normalizedNpc(npc) {
  return { ...npc, direction: npc.direction ?? 0 };
}

function sameNpc(a, b) {
  return JSON.stringify(a) === JSON.stringify(normalizedNpc(b));
}

class NpcWorld {
  constructor({ viewDistance = VIEW_DISTANCE } = {}) {
    this.viewDistance = viewDistance;
    this.byId = new Map();
    this.byZone = new Map();
    this.listeners = new Set();
    this.revision = 0;
  }

  subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function');
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  _emit(type, npc, extra = {}) {
    const event = Object.freeze({ type, npc, revision: ++this.revision, ...extra });
    for (const listener of this.listeners) listener(event);
    return event;
  }

  _insert(npc) {
    validateNpcRecord(npc);
    if (this.byId.has(npc.instanceId)) throw new Error(`duplicate NPC instanceId ${npc.instanceId}`);
    const frozen = Object.freeze(normalizedNpc(npc));
    this.byId.set(frozen.instanceId, frozen);
    if (!this.byZone.has(frozen.zoneId)) this.byZone.set(frozen.zoneId, new Set());
    this.byZone.get(frozen.zoneId).add(frozen.instanceId);
    return frozen;
  }

  add(npc) {
    const frozen = this._insert(npc);
    this._emit('spawn', frozen);
    return frozen;
  }

  spawn(npc) { return this.add(npc); }

  _delete(instanceId) {
    const npc = this.byId.get(instanceId);
    if (!npc) return null;
    this.byId.delete(instanceId);
    const zone = this.byZone.get(npc.zoneId);
    if (zone) {
      zone.delete(instanceId);
      if (zone.size === 0) this.byZone.delete(npc.zoneId);
    }
    return npc;
  }

  remove(instanceId) {
    const npc = this._delete(instanceId);
    if (npc) this._emit('despawn', npc);
    return npc;
  }

  despawn(instanceId) { return this.remove(instanceId); }

  get(instanceId) { return this.byId.get(instanceId) || null; }

  regionFor(x, z) {
    return { x: Math.trunc(x / this.viewDistance), z: Math.trunc(z / this.viewDistance) };
  }

  nearby(zoneId, x, z) {
    const center = this.regionFor(x, z);
    const ids = this.byZone.get(zoneId);
    if (!ids) return [];
    const out = [];
    for (const id of ids) {
      const npc = this.byId.get(id);
      const region = this.regionFor(npc.x, npc.z);
      if (Math.abs(region.x - center.x) <= 1 && Math.abs(region.z - center.z) <= 1) out.push(npc);
    }
    return out.sort((a, b) => a.instanceId - b.instanceId);
  }

  regionDelta(zoneId, x, z, previousIds = []) {
    const current = this.nearby(zoneId, x, z);
    const currentIds = new Set(current.map(n => n.instanceId));
    const previous = new Set(previousIds);
    return {
      enter: current.filter(n => !previous.has(n.instanceId)),
      stay: current.filter(n => previous.has(n.instanceId)),
      leave: [...previous].filter(id => !currentIds.has(id)).sort((a, b) => a - b),
      ids: [...currentIds].sort((a, b) => a - b),
    };
  }

  reloadZone(zoneId, npcs) {
    if (!Array.isArray(npcs)) throw new TypeError('npcs must be an array');
    const incoming = new Map();
    for (const npc of npcs) {
      validateNpcRecord(npc);
      if (npc.zoneId !== zoneId) throw new Error(`reload NPC ${npc.instanceId} belongs to zone ${npc.zoneId}, expected ${zoneId}`);
      if (incoming.has(npc.instanceId)) throw new Error(`duplicate NPC instanceId ${npc.instanceId} in reload`);
      incoming.set(npc.instanceId, npc);
    }

    const result = { spawned: [], despawned: [], updated: [], unchanged: [] };
    const existingIds = [...(this.byZone.get(zoneId) || [])];
    for (const id of existingIds) {
      if (!incoming.has(id)) {
        const old = this._delete(id);
        result.despawned.push(old);
        this._emit('despawn', old, { reason: 'reload' });
      }
    }
    for (const [id, npc] of incoming) {
      const old = this.byId.get(id);
      if (!old) {
        const added = this._insert(npc);
        result.spawned.push(added);
        this._emit('spawn', added, { reason: 'reload' });
      } else if (sameNpc(old, npc)) {
        result.unchanged.push(old);
      } else {
        this._delete(id);
        const added = this._insert(npc);
        result.updated.push({ before: old, after: added });
        this._emit('update', added, { before: old, reason: 'reload' });
      }
    }
    return result;
  }

  setState(instanceId, patch) {
    const old = this.get(instanceId);
    if (!old) return null;
    const updated = { ...old, ...patch, instanceId: old.instanceId, zoneId: old.zoneId };
    validateNpcRecord(updated);
    this._delete(instanceId);
    const frozen = this._insert(updated);
    this._emit('update', frozen, { before: old, reason: 'state' });
    return frozen;
  }

  allocateInstanceId() {
    for (let id = NPC_BAND; id < INVALID_BAND; id++) if (!this.byId.has(id)) return id;
    throw new Error('NPC instance ID band exhausted');
  }
}

module.exports = { NpcWorld };
