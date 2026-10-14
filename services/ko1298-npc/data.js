'use strict';

const { NPC_BAND, INVALID_BAND } = require('./protocol');

const NPC_ROLES = Object.freeze({
  STATIC: 'static',
  MERCHANT: 'merchant',
  QUEST: 'quest',
  GATE: 'gate',
  INN: 'inn',
  OTHER: 'other',
});

const HEIGHT_AUTHORITY_DEPENDENCY = 'terrain.height-authority';
const AUTHORITATIVE_HEIGHT_STATUS = 'authoritative';

class NpcHeightAuthorityError extends Error {
  constructor(code, message, details = {}) {
    super(message || code);
    this.name = 'NpcHeightAuthorityError';
    this.code = code;
    this.details = details;
  }
}

function assertSource(record, fallbackSource, label) {
  const direct = record?.source;
  if (direct && typeof direct === 'object' && typeof direct.ref === 'string' && direct.ref.length > 0) return;
  if (typeof record?.sourceRow === 'string' && record.sourceRow.length > 0
      && fallbackSource && typeof fallbackSource.ref === 'string' && fallbackSource.ref.length > 0) return;
  throw new Error(`${label} requires record provenance (source.ref or sourceRow + pinned source)`);
}

function validateNpcCatalog(document) {
  if (!document || !Array.isArray(document.templates)) throw new TypeError('document.templates is required');
  const spawns = Array.isArray(document.spawns) ? document.spawns : document.instances;
  if (!Array.isArray(spawns)) throw new TypeError('document.spawns or document.instances is required');

  const templateIds = new Set();
  for (const [i, template] of document.templates.entries()) {
    if (!Number.isInteger(template.templateSid)) throw new Error(`templates[${i}].templateSid must be an integer`);
    if (templateIds.has(template.templateSid)) throw new Error(`duplicate NPC templateSid ${template.templateSid}`);
    templateIds.add(template.templateSid);
    assertSource(template, document.provenance?.templateSource, `template ${template.templateSid}`);
  }

  const spawnKeys = new Set();
  for (const [i, spawn] of spawns.entries()) {
    const key = spawn.spawnKey || `legacy:${spawn.instanceId}`;
    if (spawnKeys.has(key)) throw new Error(`duplicate NPC spawn ${key}`);
    spawnKeys.add(key);
    if (!templateIds.has(spawn.templateSid)) throw new Error(`missing NPC template ${spawn.templateSid}`);
    if (!Number.isInteger(spawn.zoneId)) throw new Error(`spawns[${i}].zoneId must be an integer`);
    assertSource(spawn, document.provenance?.positionSource, `spawn ${key}`);
    if (spawn.spawnCount != null && (!Number.isInteger(spawn.spawnCount) || spawn.spawnCount < 1)) {
      throw new Error(`spawn ${key} has invalid spawnCount`);
    }
    if (spawn.anchor != null) {
      if (!Number.isFinite(spawn.anchor.x) || !Number.isFinite(spawn.anchor.z)) {
        throw new Error(`spawn ${key} has invalid anchor`);
      }
      if (spawn.anchor.y != null) throw new Error(`spawn ${key} must not declare Y; terrain.height-authority owns Y`);
    }
    if (spawn.y != null) throw new Error(`spawn ${key} must not declare Y; terrain.height-authority owns Y`);
  }
  return true;
}

function createHeightAuthorityPort(provider) {
  if (!provider || typeof provider.resolveHeight !== 'function') {
    throw new TypeError('heightAuthority.resolveHeight(zoneId, x, z) is required');
  }
  return Object.freeze({
    dependency: HEIGHT_AUTHORITY_DEPENDENCY,
    resolveHeight(zoneId, x, z) {
      return provider.resolveHeight(zoneId, x, z);
    },
  });
}

function defaultRuntimeAllocator(index) {
  const id = NPC_BAND + index;
  if (id >= INVALID_BAND) throw new Error('NPC instance ID band exhausted while materializing catalog');
  return id;
}

function resolveSpawnPosition(heightAuthority, spawn) {
  const { x, z } = spawn.anchor;
  let result;
  try {
    result = heightAuthority.resolveHeight(spawn.zoneId, x, z);
  } catch (error) {
    throw new NpcHeightAuthorityError(
      'NPC_HEIGHT_AUTHORITY_FAILED',
      `height authority failed for NPC template ${spawn.templateSid} spawn ${spawn.spawnKey}`,
      { spawnKey: spawn.spawnKey, templateSid: spawn.templateSid, zoneId: spawn.zoneId, x, z, cause: error.message },
    );
  }
  if (!result || result.status !== AUTHORITATIVE_HEIGHT_STATUS || !Number.isFinite(result.height)) {
    throw new NpcHeightAuthorityError(
      'NPC_HEIGHT_NOT_AUTHORITATIVE',
      `authoritative terrain height required for NPC template ${spawn.templateSid} spawn ${spawn.spawnKey}`,
      {
        spawnKey: spawn.spawnKey,
        templateSid: spawn.templateSid,
        zoneId: spawn.zoneId,
        x,
        z,
        status: result?.status ?? 'missing',
        reason: result?.reason ?? null,
      },
    );
  }
  return {
    x,
    y: result.height,
    z,
    authority: Object.freeze({
      dependency: HEIGHT_AUTHORITY_DEPENDENCY,
      status: AUTHORITATIVE_HEIGHT_STATUS,
      surface: result.surface ?? null,
      source: result.source ?? null,
    }),
  };
}

function buildRuntimeRecord({ template, spawn, instanceId, resolvedPosition, fallbackPositionSource }) {
  const identity = Object.freeze({
    templateSid: spawn.templateSid,
    instanceKey: spawn.spawnKey,
    runtimeId: instanceId,
  });
  const position = Object.freeze({
    zoneId: spawn.zoneId,
    x: resolvedPosition.x,
    y: resolvedPosition.y,
    z: resolvedPosition.z,
  });
  return {
    ...template,
    instanceId,
    runtimeId: instanceId,
    sourceInstanceKey: spawn.spawnKey,
    identity,
    zoneId: spawn.zoneId,
    x: position.x,
    y: position.y,
    z: position.z,
    position,
    positionAuthority: resolvedPosition.authority,
    direction: spawn.direction ?? 0,
    gateOpen: spawn.gateOpen ?? 1,
    objectType: spawn.objectType ?? 0,
    static: true,
    enabled: true,
    dead: false,
    spawnKey: spawn.spawnKey,
    sourcePopulation: spawn.spawnCount ?? 1,
    populationCoverage: (spawn.spawnCount ?? 1) === 1 ? 'exact-anchor' : 'verified-anchor-only',
    spawnSource: spawn.source || { ref: fallbackPositionSource?.ref, rowKey: spawn.sourceRow },
  };
}

function materializeNpcPopulation(document, { heightAuthority, allocateInstanceId } = {}) {
  validateNpcCatalog(document);
  const authority = createHeightAuthorityPort(heightAuthority);
  const templates = new Map(document.templates.map(t => [t.templateSid, t]));
  const rawSpawns = Array.isArray(document.spawns)
    ? document.spawns
    : document.instances.map((instance, index) => ({
      ...instance,
      spawnKey: instance.spawnKey || `legacy:${instance.instanceId ?? index}`,
      anchor: Number.isFinite(instance.x) && Number.isFinite(instance.z) ? { x: instance.x, z: instance.z } : null,
      spawnCount: instance.spawnCount ?? 1,
    }));

  const unresolved = [];
  const resolved = [];
  for (const spawn of rawSpawns) {
    if (!spawn.anchor) {
      unresolved.push(Object.freeze({
        spawnKey: spawn.spawnKey,
        templateSid: spawn.templateSid,
        zoneId: spawn.zoneId,
        reason: 'source-anchor-unavailable',
      }));
      continue;
    }
    const template = templates.get(spawn.templateSid);
    if (!template) throw new Error(`missing NPC template ${spawn.templateSid}`);
    resolved.push({ spawn, template, position: resolveSpawnPosition(authority, spawn) });
  }

  const allocator = typeof allocateInstanceId === 'function'
    ? allocateInstanceId
    : ((spawn, index) => defaultRuntimeAllocator(index));
  const records = resolved.map(({ spawn, template, position }, index) => {
    const instanceId = allocator(spawn, index);
    if (!Number.isInteger(instanceId) || instanceId < NPC_BAND || instanceId >= INVALID_BAND) {
      throw new Error(`invalid runtime NPC instanceId ${instanceId} for spawn ${spawn.spawnKey}`);
    }
    return buildRuntimeRecord({
      template,
      spawn,
      instanceId,
      resolvedPosition: position,
      fallbackPositionSource: document.provenance?.positionSource,
    });
  });

  const stats = catalogStats(document);
  return Object.freeze({
    records: Object.freeze(records),
    unresolved: Object.freeze(unresolved),
    authoritativeNpcCount: records.length,
    sourceDeclaredPopulation: stats.declaredPopulation,
    stats: Object.freeze(stats),
  });
}

function resolveNpcData(document, options = {}) {
  return [...materializeNpcPopulation(document, options).records];
}

function isAuthoritativeNpcPosition(npc) {
  return Boolean(
    npc
    && Number.isFinite(npc.x)
    && Number.isFinite(npc.y)
    && Number.isFinite(npc.z)
    && npc.positionAuthority?.dependency === HEIGHT_AUTHORITY_DEPENDENCY
    && npc.positionAuthority?.status === AUTHORITATIVE_HEIGHT_STATUS
    && npc.position
    && npc.position.zoneId === npc.zoneId
    && npc.position.x === npc.x
    && npc.position.y === npc.y
    && npc.position.z === npc.z
  );
}

function assertAuthoritativeNpcPosition(npc) {
  if (!isAuthoritativeNpcPosition(npc)) {
    throw new NpcHeightAuthorityError(
      'NPC_POSITION_NOT_AUTHORITATIVE',
      `NPC ${npc?.instanceId ?? 'unknown'} cannot enter visibility without authoritative X/Y/Z`,
      { instanceId: npc?.instanceId ?? null, zoneId: npc?.zoneId ?? null },
    );
  }
  return true;
}

function catalogStats(document) {
  validateNpcCatalog(document);
  const spawns = document.spawns || document.instances;
  const anchored = spawns.filter(s => s.anchor || (Number.isFinite(s.x) && Number.isFinite(s.z))).length;
  const declaredPopulation = spawns.reduce((sum, s) => sum + (s.spawnCount ?? 1), 0);
  const byRole = {};
  for (const template of document.templates) byRole[template.role || NPC_ROLES.OTHER] = (byRole[template.role || NPC_ROLES.OTHER] || 0) + 1;
  return {
    templates: document.templates.length,
    spawnGroups: spawns.length,
    anchoredSpawnGroups: anchored,
    declaredPopulation,
    byRole,
  };
}

module.exports = {
  NPC_ROLES,
  HEIGHT_AUTHORITY_DEPENDENCY,
  AUTHORITATIVE_HEIGHT_STATUS,
  NpcHeightAuthorityError,
  validateNpcCatalog,
  createHeightAuthorityPort,
  materializeNpcPopulation,
  resolveNpcData,
  isAuthoritativeNpcPosition,
  assertAuthoritativeNpcPosition,
  catalogStats,
};
