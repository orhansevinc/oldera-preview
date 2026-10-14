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
    }
  }
  return true;
}

function createTerrainHeightResolver({ terrainHeight, shapeHeight } = {}) {
  if (typeof terrainHeight !== 'function' && typeof shapeHeight !== 'function') {
    throw new TypeError('terrainHeight or shapeHeight resolver is required');
  }
  return ({ zoneId, x, z, templateSid }) => {
    const terrain = typeof terrainHeight === 'function' ? terrainHeight({ zoneId, x, z, templateSid }) : null;
    const shape = typeof shapeHeight === 'function' ? shapeHeight({ zoneId, x, z, templateSid }) : null;
    const candidates = [terrain, shape].filter(Number.isFinite);
    return candidates.length ? Math.max(...candidates) : null;
  };
}

function defaultRuntimeAllocator(index) {
  const id = NPC_BAND + index;
  if (id >= INVALID_BAND) throw new Error('NPC instance ID band exhausted while materializing catalog');
  return id;
}

function resolveNpcData(document, { terrainY, allocateInstanceId } = {}) {
  validateNpcCatalog(document);
  if (typeof terrainY !== 'function') throw new TypeError('terrainY resolver is required');
  const templates = new Map(document.templates.map(t => [t.templateSid, t]));

  if (Array.isArray(document.spawns)) {
    const allocator = typeof allocateInstanceId === 'function' ? allocateInstanceId : ((spawn, index) => defaultRuntimeAllocator(index));
    const out = [];
    document.spawns.forEach((spawn, index) => {
      if (!spawn.anchor) return;
      const template = templates.get(spawn.templateSid);
      const y = terrainY({ zoneId: spawn.zoneId, x: spawn.anchor.x, z: spawn.anchor.z, templateSid: spawn.templateSid });
      if (!Number.isFinite(y)) throw new Error(`unresolved terrain Y for NPC template ${spawn.templateSid} spawn ${spawn.spawnKey}`);
      const instanceId = allocator(spawn, index);
      const row = {
        ...template,
        instanceId,
        zoneId: spawn.zoneId,
        x: spawn.anchor.x,
        y,
        z: spawn.anchor.z,
        direction: spawn.direction ?? 0,
        gateOpen: spawn.gateOpen ?? 1,
        objectType: spawn.objectType ?? 0,
        static: true,
        enabled: true,
        dead: false,
        spawnKey: spawn.spawnKey,
        sourcePopulation: spawn.spawnCount ?? 1,
        populationCoverage: (spawn.spawnCount ?? 1) === 1 ? 'exact-anchor' : 'verified-anchor-only',
        spawnSource: spawn.source || { ref: document.provenance?.positionSource?.ref, rowKey: spawn.sourceRow },
      };
      out.push(row);
    });
    return out;
  }

  return document.instances.map(instance => {
    const template = templates.get(instance.templateSid);
    if (!template) throw new Error(`missing NPC template ${instance.templateSid}`);
    const row = { ...template, ...instance };
    if (row.y == null) {
      const y = terrainY({ zoneId: row.zoneId, x: row.x, z: row.z, templateSid: row.templateSid });
      if (!Number.isFinite(y)) throw new Error(`unresolved terrain Y for NPC template ${row.templateSid}`);
      row.y = y;
    }
    return row;
  });
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
  validateNpcCatalog,
  createTerrainHeightResolver,
  resolveNpcData,
  catalogStats,
};
