'use strict';

function fail(message) {
  throw new TypeError(`ko1298-mobs: ${message}`);
}

function int(value, label, min = 0) {
  if (!Number.isSafeInteger(value) || value < min) fail(`${label} must be integer >= ${min}`);
  return value;
}

function finite(value, label) {
  if (!Number.isFinite(value)) fail(`${label} must be finite`);
  return value;
}

function text(value, label) {
  if (typeof value !== 'string' || value.trim() === '') fail(`${label} is required`);
  return value;
}

function hash32(input) {
  let hash = 0x811c9dc5;
  for (const ch of String(input)) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function deterministicInt(seed, a, b) {
  const min = Math.min(a, b);
  const max = Math.max(a, b);
  if (min === max) return min;
  return min + (hash32(seed) % (max - min + 1));
}

function indexWs31Catalog(catalogRows = []) {
  const map = new Map();
  for (const row of catalogRows) {
    if (!row || row.category !== 'MONSTER') continue;
    if (!Number.isInteger(row.id)) fail('WS31 monster id must be integer');
    if (map.has(row.id)) fail(`duplicate WS31 monster id ${row.id}`);
    map.set(row.id, row);
  }
  return map;
}

function loadWs31MonsterTemplates(catalogRows, statRows, runtimePolicy = {}) {
  const catalog = indexWs31Catalog(catalogRows);
  const stats = new Map((statRows ?? []).map((row) => [row.id, row]));
  const templates = [];
  for (const [id, catalogRow] of [...catalog.entries()].sort((a, b) => a[0] - b[0])) {
    const stat = stats.get(id);
    if (!stat) continue;
    if (stat.name !== catalogRow.name) fail(`WS31/stat name mismatch for monster ${id}`);
    if (Number.isInteger(catalogRow.level) && stat.level !== catalogRow.level) fail(`WS31/stat level mismatch for monster ${id}`);
    templates.push(normalizeTemplate(stat, runtimePolicy, {
      ws31Source: catalogRow.source,
      catalogConfidence: catalogRow.confidence,
    }));
  }
  return Object.freeze(templates);
}

function normalizeTemplate(row, runtimePolicy, provenance = {}) {
  const id = int(row.id, 'monster.id', 1);
  const sourceRef = text(row.sourceRef, `monster ${id}.sourceRef`);
  const searchRange = int(row.searchRange, `monster ${id}.searchRange`);
  const tracingRange = int(row.tracingRange, `monster ${id}.tracingRange`);
  const attackRange = int(row.attackRange, `monster ${id}.attackRange`);
  return Object.freeze({
    templateId: `ko1298:monster:${id}`,
    displayName: text(row.name, `monster ${id}.name`),
    dataClass: 'real',
    sourceRef,
    modelRef: row.resourceId ?? null,
    maxHp: int(row.hp, `monster ${id}.hp`, 1),
    aggroRange: searchRange,
    leashRange: Math.max(searchRange, tracingRange, attackRange),
    attackRange,
    returnTolerance: Number.isFinite(runtimePolicy.returnTolerance) ? runtimePolicy.returnTolerance : 0.5,
    corpseDespawnMs: Number.isInteger(runtimePolicy.corpseDespawnMs) ? runtimePolicy.corpseDespawnMs : 3000,
    respawnDelayMs: Number.isInteger(runtimePolicy.defaultRespawnDelayMs) ? runtimePolicy.defaultRespawnDelayMs : 30000,
    attackDelayMs: int(row.attackDelayMs, `monster ${id}.attackDelayMs`, 1),
    stuckThreshold: Number.isInteger(runtimePolicy.stuckThreshold) ? runtimePolicy.stuckThreshold : 3,
    level: int(row.level, `monster ${id}.level`, 1),
    metadata: {
      resourceId: row.resourceId ?? null,
      speed1: row.speed1 ?? null,
      speed2: row.speed2 ?? null,
      searchRange,
      tracingRange,
      attackRange,
      group: Number.isInteger(row.group) ? row.group : null,
      family: Number.isInteger(row.family) ? row.family : null,
      sourceKind: row.sourceKind ?? 'DB_K_MONSTER',
      ...provenance,
    },
  });
}

function loadVerifiedWorldDefinition(raw, options = {}) {
  if (!raw || raw.dataClass !== 'real') fail('verified data must use dataClass=real');
  const zoneId = String(raw.zoneId);
  if (!Array.isArray(raw.monsters) || raw.monsters.length === 0) fail('verified monsters are required');
  if (!Array.isArray(raw.spawnRows) || raw.spawnRows.length === 0) fail('verified spawnRows are required');

  const catalog = indexWs31Catalog(options.ws31Catalog ?? []);
  const templateMap = new Map();
  for (const row of raw.monsters) {
    if (templateMap.has(row.id)) fail(`duplicate verified monster id ${row.id}`);
    const cat = catalog.get(row.id);
    if (cat) {
      if (cat.name !== row.name) fail(`WS31/verified name mismatch for monster ${row.id}`);
      if (Number.isInteger(cat.level) && cat.level !== row.level) fail(`WS31/verified level mismatch for monster ${row.id}`);
    } else if (options.requireWs31Catalog === true) {
      fail(`monster ${row.id} missing from WS31 catalog`);
    }
    templateMap.set(row.id, normalizeTemplate(row, options.runtimePolicy ?? {}, {
      catalogStatus: cat ? 'ws31-canonical' : (raw.catalogStatus ?? 'upstream-verified'),
      ws31Source: cat?.source ?? null,
    }));
  }

  const rowIds = new Set();
  const compositeRows = new Set();
  const spawnGroups = [];
  for (const row of raw.spawnRows) {
    const rowZone = String(row.zoneId);
    if (rowZone !== zoneId) fail(`spawn row ${row.rowId ?? '?'} zone ${rowZone} does not match world zone ${zoneId}`);
    const monsterId = int(row.npcId, 'spawn.npcId', 1);
    if (!templateMap.has(monsterId)) fail(`spawn row ${row.rowId ?? '?'} references unknown monster ${monsterId}`);
    const rowId = text(row.rowId, `spawn ${monsterId}.rowId`);
    if (rowIds.has(rowId)) fail(`duplicate verified spawn rowId ${rowId}`);
    rowIds.add(rowId);
    const composite = [rowZone, monsterId, row.leftX, row.topZ, row.rightX, row.bottomZ, row.numNpc, row.regTimeSeconds, row.path ?? ''].join(':');
    if (compositeRows.has(composite)) fail(`duplicate verified spawn geometry ${rowId}`);
    compositeRows.add(composite);

    if (row.actType !== 1) continue;
    const count = int(row.numNpc, `${rowId}.numNpc`, 1);
    const regTimeSeconds = int(row.regTimeSeconds, `${rowId}.regTimeSeconds`, 1);
    const leftX = int(row.leftX, `${rowId}.leftX`);
    const topZ = int(row.topZ, `${rowId}.topZ`);
    const rightX = int(row.rightX, `${rowId}.rightX`);
    const bottomZ = int(row.bottomZ, `${rowId}.bottomZ`);
    const groupId = `ko1298:${zoneId}:${monsterId}:${rowId}`;
    const spawns = [];
    for (let i = 0; i < count; i += 1) {
      const slot = i + 1;
      const x = deterministicInt(`${groupId}:x:${slot}`, leftX, rightX);
      const z = deterministicInt(`${groupId}:z:${slot}`, topZ, bottomZ);
      spawns.push(Object.freeze({
        spawnId: `slot-${String(slot).padStart(3, '0')}`,
        zoneId,
        x,
        y: null,
        z,
        heading: Number.isFinite(row.direction) ? row.direction : 0,
        requiresHeightResolve: true,
        corpseDespawnMs: regTimeSeconds * 1000,
        respawnDelayMs: regTimeSeconds * 1000,
        sourceRef: text(row.sourceRef, `${rowId}.sourceRef`),
        sourceArea: Object.freeze({
          leftX, topZ, rightX, bottomZ,
          limitMinX: row.limitMinX ?? null,
          limitMinZ: row.limitMinZ ?? null,
          limitMaxX: row.limitMaxX ?? null,
          limitMaxZ: row.limitMaxZ ?? null,
          sourceNumNpc: count,
          sourceRespawnSeconds: regTimeSeconds,
        }),
        patrolPath: Array.isArray(row.patrolPath) ? row.patrolPath : [],
      }));
    }
    spawnGroups.push(Object.freeze({
      groupId,
      templateId: `ko1298:monster:${monsterId}`,
      zoneId,
      sourceRef: row.sourceRef,
      spawns: Object.freeze(spawns),
    }));
  }

  if (spawnGroups.length === 0) fail('verified data produced no active monster spawn groups');
  return Object.freeze({
    schemaVersion: 2,
    dataClass: 'real',
    zoneId,
    note: raw.note ?? null,
    templates: Object.freeze([...templateMap.values()]),
    spawnGroups: Object.freeze(spawnGroups),
    metadata: Object.freeze({
      sourceRef: raw.sourceRef ?? null,
      catalogStatus: raw.catalogStatus ?? null,
      verifiedSpawnRows: spawnGroups.length,
    }),
  });
}

module.exports = {
  deterministicInt,
  loadVerifiedWorldDefinition,
  loadWs31MonsterTemplates,
};
