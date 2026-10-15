'use strict';

const catalog = require('../data/zones.1298.json');
const { MORADON_SPAWN, ZONE } = require('./constants');

const ENTRY_STATUS = Object.freeze({
  PRODUCTION_READY: 'PRODUCTION_READY',
  RULES_PENDING: 'RULES_PENDING',
  IDENTITY_ONLY: 'IDENTITY_ONLY',
  DATA_CONFLICT: 'DATA_CONFLICT',
});

class ZoneDefinition {
  constructor(raw) {
    if (!Number.isInteger(raw?.zoneId) || raw.zoneId < 0 || raw.zoneId > 0xff) {
      throw new Error(`zoneId must fit uint8: ${String(raw?.zoneId)}`);
    }
    if (!raw.name || typeof raw.name !== 'string') throw new Error(`zone ${raw.zoneId} name is required`);
    this.zoneId = raw.zoneId;
    this.name = raw.name;
    this.zoneType = raw.zoneType || 'UNKNOWN';
    this.nationConstraint = raw.nationConstraint ?? null;
    this.mapRef = raw.mapRef ?? null;
    this.spawn = raw.spawn ? normalizePosition(raw.spawn) : null;
    this.zoneAbility = raw.zoneAbility ? Object.freeze({ ...raw.zoneAbility }) : null;
    this.entryStatus = raw.entryStatus || ENTRY_STATUS.IDENTITY_ONLY;
    this.unknown = Object.freeze([...(raw.unknown || [])]);
    this.rawSpawnHundredths = raw.rawSpawnHundredths ? Object.freeze({ ...raw.rawSpawnHundredths }) : null;
    this.sourceRefs = Object.freeze([...(raw.sourceRefs || [])]);
    Object.freeze(this);
  }

  get productionReady() {
    return this.entryStatus === ENTRY_STATUS.PRODUCTION_READY && this.spawn !== null && this.zoneAbility !== null;
  }
}

class ZoneRuntime {
  constructor(definition) {
    this.definition = definition;
    this.members = new Map();
  }

  enter(snapshot) {
    if (snapshot.zoneId !== this.definition.zoneId) throw new Error('zone runtime entry snapshot targets another zone');
    this.members.set(snapshot.socketId, Object.freeze({ ...snapshot }));
  }

  leave(socketId) {
    return this.members.delete(socketId);
  }

  has(socketId) {
    return this.members.has(socketId);
  }

  get(socketId) {
    return this.members.get(socketId) || null;
  }

  get size() {
    return this.members.size;
  }
}

class ZoneRegistry {
  constructor(definitions = []) {
    this.definitions = new Map();
    this.runtimes = new Map();
    for (const input of definitions) {
      const definition = input instanceof ZoneDefinition ? input : new ZoneDefinition(input);
      if (this.definitions.has(definition.zoneId)) throw new Error(`duplicate zone definition ${definition.zoneId}`);
      this.definitions.set(definition.zoneId, definition);
      this.runtimes.set(definition.zoneId, new ZoneRuntime(definition));
    }
  }

  get(zoneId) {
    return this.definitions.get(zoneId) || null;
  }

  requireKnown(zoneId) {
    const definition = this.get(zoneId);
    if (!definition) throw new Error(`unknown zone ${zoneId}; fail closed`);
    return definition;
  }

  requireProductionReady(zoneId) {
    const definition = this.requireKnown(zoneId);
    if (!definition.productionReady) {
      const detail = definition.unknown.length ? `: ${definition.unknown.join('; ')}` : '';
      throw new Error(`zone ${zoneId} is not production-ready${detail}`);
    }
    return definition;
  }

  runtime(zoneId) {
    this.requireKnown(zoneId);
    return this.runtimes.get(zoneId);
  }

  list() {
    return [...this.definitions.values()];
  }
}

function createVerified1298ZoneRegistry({ moradonSpawn = MORADON_SPAWN } = {}) {
  const definitions = catalog.zones.map((zone) => {
    if (zone.zoneId !== ZONE.MORADON) return zone;
    return { ...zone, spawn: { ...moradonSpawn } };
  });
  return new ZoneRegistry(definitions);
}

function normalizePosition(position) {
  const result = { x: Number(position.x), z: Number(position.z), y: Number(position.y ?? 0) };
  if (![result.x, result.z, result.y].every(Number.isFinite)) throw new Error('zone position must contain finite x/z/y');
  if (result.x < 0 || Math.trunc(result.x * 10) > 0xffff) throw new Error(`x coordinate is not representable by 1298 protocol: ${result.x}`);
  if (result.z < 0 || Math.trunc(result.z * 10) > 0xffff) throw new Error(`z coordinate is not representable by 1298 protocol: ${result.z}`);
  const scaledY = Math.trunc(result.y * 10);
  if (scaledY < -0x8000 || scaledY > 0x7fff) throw new Error(`y coordinate is not representable by 1298 protocol: ${result.y}`);
  return Object.freeze(result);
}

module.exports = {
  ENTRY_STATUS,
  ZoneDefinition,
  ZoneRuntime,
  ZoneRegistry,
  createVerified1298ZoneRegistry,
  normalizePosition,
};
