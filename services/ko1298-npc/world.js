'use strict';

const { NPC_BAND, INVALID_BAND, VIEW_DISTANCE, validateNpcRecord } = require('./protocol');

class NpcWorld {
  constructor({ viewDistance = VIEW_DISTANCE } = {}) {
    this.viewDistance = viewDistance;
    this.byId = new Map();
    this.byZone = new Map();
  }

  add(npc) {
    validateNpcRecord(npc);
    if (this.byId.has(npc.instanceId)) throw new Error(`duplicate NPC instanceId ${npc.instanceId}`);
    const frozen = Object.freeze({ ...npc, direction: npc.direction ?? 0 });
    this.byId.set(frozen.instanceId, frozen);
    if (!this.byZone.has(frozen.zoneId)) this.byZone.set(frozen.zoneId, new Set());
    this.byZone.get(frozen.zoneId).add(frozen.instanceId);
    return frozen;
  }

  remove(instanceId) {
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

  allocateInstanceId() {
    for (let id = NPC_BAND; id < INVALID_BAND; id++) if (!this.byId.has(id)) return id;
    throw new Error('NPC instance ID band exhausted');
  }
}

module.exports = { NpcWorld };
