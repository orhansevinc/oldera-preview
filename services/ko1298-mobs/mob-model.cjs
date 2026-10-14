'use strict';

const MobState = Object.freeze({
  IDLE: 'idle',
  PATROLLING: 'patrolling',
  AGGRO: 'aggro',
  CHASING: 'chasing',
  ATTACK_INTENT: 'attack-intent',
  RETURNING: 'returning',
  DEAD: 'dead',
  CORPSE: 'corpse',
  DESPAWNED: 'despawned',
});

function fail(message) {
  throw new TypeError(`ko1298-mobs: ${message}`);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function requireFinite(value, label, { min = -Infinity } = {}) {
  if (!Number.isFinite(value) || value < min) fail(`${label} must be a finite number >= ${min}`);
  return value;
}

function requireInteger(value, label, { min = 0 } = {}) {
  if (!Number.isSafeInteger(value) || value < min) fail(`${label} must be an integer >= ${min}`);
  return value;
}

function normalizePosition(position, label = 'position', { allowUnresolvedHeight = false } = {}) {
  if (!position || typeof position !== 'object') fail(`${label} is required`);
  const y = position.y;
  if (y === null && allowUnresolvedHeight && position.requiresHeightResolve === true) {
    return Object.freeze({
      x: requireFinite(position.x, `${label}.x`),
      y: null,
      z: requireFinite(position.z, `${label}.z`),
      heading: requireFinite(position.heading ?? 0, `${label}.heading`),
      requiresHeightResolve: true,
    });
  }
  return Object.freeze({
    x: requireFinite(position.x, `${label}.x`),
    y: requireFinite(y, `${label}.y`),
    z: requireFinite(position.z, `${label}.z`),
    heading: requireFinite(position.heading ?? 0, `${label}.heading`),
    requiresHeightResolve: false,
  });
}

function validateTemplate(raw, expectedDataClass) {
  if (!raw || typeof raw !== 'object') fail('template must be an object');
  if (!isNonEmptyString(raw.templateId)) fail('template.templateId is required');
  if (!isNonEmptyString(raw.displayName)) fail(`${raw.templateId}.displayName is required`);
  if (raw.dataClass !== 'fixture' && raw.dataClass !== 'real') {
    fail(`${raw.templateId}.dataClass must be fixture or real`);
  }
  if (expectedDataClass && raw.dataClass !== expectedDataClass) {
    fail(`${raw.templateId}.dataClass must match world dataClass ${expectedDataClass}`);
  }
  if (raw.dataClass === 'fixture' && !raw.templateId.startsWith('fixture:')) {
    fail(`${raw.templateId} fixture templateId must start with fixture:`);
  }
  if (raw.dataClass === 'real' && !isNonEmptyString(raw.sourceRef)) {
    fail(`${raw.templateId}.sourceRef is required for real data`);
  }

  const maxHp = requireInteger(raw.maxHp, `${raw.templateId}.maxHp`, { min: 1 });
  const aggroRange = requireFinite(raw.aggroRange, `${raw.templateId}.aggroRange`, { min: 0 });
  const leashRange = requireFinite(raw.leashRange, `${raw.templateId}.leashRange`, { min: 0 });
  const attackRange = requireFinite(raw.attackRange ?? 0, `${raw.templateId}.attackRange`, { min: 0 });
  if (leashRange < aggroRange) fail(`${raw.templateId}.leashRange must be >= aggroRange`);
  if (leashRange < attackRange) fail(`${raw.templateId}.leashRange must be >= attackRange`);
  const returnTolerance = requireFinite(raw.returnTolerance ?? 0.5, `${raw.templateId}.returnTolerance`, { min: 0 });
  const corpseDespawnMs = requireInteger(raw.corpseDespawnMs ?? 3000, `${raw.templateId}.corpseDespawnMs`);
  const respawnDelayMs = requireInteger(raw.respawnDelayMs ?? corpseDespawnMs, `${raw.templateId}.respawnDelayMs`);
  if (respawnDelayMs < corpseDespawnMs) {
    fail(`${raw.templateId}.respawnDelayMs must be >= corpseDespawnMs`);
  }
  const attackDelayMs = requireInteger(raw.attackDelayMs ?? 1000, `${raw.templateId}.attackDelayMs`, { min: 1 });
  const stuckThreshold = requireInteger(raw.stuckThreshold ?? 3, `${raw.templateId}.stuckThreshold`, { min: 1 });

  return Object.freeze({
    templateId: raw.templateId,
    displayName: raw.displayName,
    dataClass: raw.dataClass,
    sourceRef: raw.sourceRef ?? null,
    modelRef: raw.modelRef ?? null,
    maxHp,
    aggroRange,
    leashRange,
    attackRange,
    returnTolerance,
    corpseDespawnMs,
    respawnDelayMs,
    attackDelayMs,
    stuckThreshold,
    level: Number.isInteger(raw.level) ? raw.level : null,
    metadata: Object.freeze({ ...(raw.metadata ?? {}) }),
  });
}

function validateWorldDefinition(raw) {
  if (!raw || typeof raw !== 'object') fail('world definition must be an object');
  if (raw.schemaVersion !== 1 && raw.schemaVersion !== 2) fail('schemaVersion must be 1 or 2');
  if (raw.dataClass !== 'fixture' && raw.dataClass !== 'real') fail('dataClass must be fixture or real');
  if (!isNonEmptyString(String(raw.zoneId))) fail('zoneId is required');
  const zoneId = String(raw.zoneId);
  if (raw.dataClass === 'fixture' && !zoneId.startsWith('fixture:')) {
    fail('fixture zoneId must start with fixture:');
  }
  if (!Array.isArray(raw.templates) || raw.templates.length === 0) fail('templates must be a non-empty array');
  if (!Array.isArray(raw.spawnGroups) || raw.spawnGroups.length === 0) fail('spawnGroups must be a non-empty array');

  const templates = new Map();
  for (const rawTemplate of raw.templates) {
    const template = validateTemplate(rawTemplate, raw.dataClass);
    if (templates.has(template.templateId)) fail(`duplicate templateId ${template.templateId}`);
    templates.set(template.templateId, template);
  }

  const groupIds = new Set();
  const instanceIds = new Set();
  const spawnGroups = raw.spawnGroups.map((group) => {
    if (!group || typeof group !== 'object') fail('spawnGroup must be an object');
    if (!isNonEmptyString(group.groupId)) fail('spawnGroup.groupId is required');
    if (raw.dataClass === 'fixture' && !group.groupId.startsWith('fixture:')) {
      fail(`${group.groupId} fixture groupId must start with fixture:`);
    }
    if (groupIds.has(group.groupId)) fail(`duplicate groupId ${group.groupId}`);
    groupIds.add(group.groupId);
    if (group.zoneId !== undefined && String(group.zoneId) !== zoneId) {
      fail(`${group.groupId}.zoneId must match world zoneId ${zoneId}`);
    }
    if (!templates.has(group.templateId)) fail(`${group.groupId} references unknown template ${group.templateId}`);
    if (!Array.isArray(group.spawns) || group.spawns.length === 0) fail(`${group.groupId}.spawns must be non-empty`);

    const spawnIds = new Set();
    const spawns = group.spawns.map((spawn) => {
      if (!spawn || typeof spawn !== 'object') fail(`${group.groupId} spawn must be an object`);
      if (!isNonEmptyString(spawn.spawnId)) fail(`${group.groupId}.spawnId is required`);
      if (spawnIds.has(spawn.spawnId)) fail(`duplicate spawnId ${spawn.spawnId} in ${group.groupId}`);
      spawnIds.add(spawn.spawnId);
      if (spawn.zoneId !== undefined && String(spawn.zoneId) !== zoneId) {
        fail(`${group.groupId}.${spawn.spawnId}.zoneId must match world zoneId ${zoneId}`);
      }
      const instanceId = `${group.groupId}/${spawn.spawnId}`;
      if (instanceIds.has(instanceId)) fail(`duplicate mob instance id ${instanceId}`);
      instanceIds.add(instanceId);
      const position = normalizePosition(spawn, `${group.groupId}.${spawn.spawnId}`, { allowUnresolvedHeight: raw.dataClass === 'real' });
      const respawnDelayMs = spawn.respawnDelayMs === undefined
        ? null
        : requireInteger(spawn.respawnDelayMs, `${group.groupId}.${spawn.spawnId}.respawnDelayMs`);
      const corpseDespawnMs = spawn.corpseDespawnMs === undefined
        ? null
        : requireInteger(spawn.corpseDespawnMs, `${group.groupId}.${spawn.spawnId}.corpseDespawnMs`);
      const template = templates.get(group.templateId);
      const effectiveCorpseMs = corpseDespawnMs ?? template.corpseDespawnMs;
      const effectiveRespawnMs = respawnDelayMs ?? template.respawnDelayMs;
      if (effectiveRespawnMs < effectiveCorpseMs) {
        fail(`${group.groupId}.${spawn.spawnId}.respawnDelayMs must be >= corpseDespawnMs`);
      }
      const patrolPath = Array.isArray(spawn.patrolPath)
        ? Object.freeze(spawn.patrolPath.map((point, i) => normalizePosition(point, `${group.groupId}.${spawn.spawnId}.patrolPath[${i}]`)))
        : Object.freeze([]);
      return Object.freeze({
        spawnId: spawn.spawnId,
        position,
        respawnDelayMs,
        corpseDespawnMs,
        patrolPath,
        sourceRef: spawn.sourceRef ?? group.sourceRef ?? null,
        sourceArea: spawn.sourceArea ? Object.freeze({ ...spawn.sourceArea }) : null,
      });
    });

    return Object.freeze({
      groupId: group.groupId,
      templateId: group.templateId,
      zoneId,
      sourceRef: group.sourceRef ?? null,
      spawns: Object.freeze(spawns),
    });
  });

  return Object.freeze({
    schemaVersion: raw.schemaVersion,
    dataClass: raw.dataClass,
    zoneId,
    note: raw.note ?? null,
    templates,
    spawnGroups: Object.freeze(spawnGroups),
    metadata: Object.freeze({ ...(raw.metadata ?? {}) }),
  });
}

function createMobInstance(zoneId, group, spawn, template) {
  const spawnAnchor = Object.freeze({
    x: spawn.position.x,
    z: spawn.position.z,
    heading: spawn.position.heading,
  });
  const spawnOrigin = Number.isFinite(spawn.position.y)
    ? Object.freeze({ ...spawn.position })
    : null;

  return {
    id: `${group.groupId}/${spawn.spawnId}`,
    templateId: template.templateId,
    groupId: group.groupId,
    spawnId: spawn.spawnId,
    zoneId,
    sourceRef: spawn.sourceRef ?? group.sourceRef ?? template.sourceRef,
    state: MobState.IDLE,
    hp: template.maxHp,
    maxHp: template.maxHp,
    position: { ...spawn.position },
    home: { ...spawn.position },
    spawnAnchor,
    spawnOrigin,
    heightAuthority: null,
    patrolPath: spawn.patrolPath,
    sourceArea: spawn.sourceArea,
    targetId: null,
    diedAt: null,
    corpseDespawnAt: null,
    respawnAt: null,
    respawnDelayMs: spawn.respawnDelayMs ?? template.respawnDelayMs,
    corpseDespawnMs: spawn.corpseDespawnMs ?? template.corpseDespawnMs,
    spawnEpoch: 0,
    lastAttackIntentAt: null,
    stuckCount: 0,
    revision: 0,
  };
}

function snapshotMob(mob) {
  return Object.freeze({
    id: mob.id,
    templateId: mob.templateId,
    groupId: mob.groupId,
    spawnId: mob.spawnId,
    zoneId: mob.zoneId,
    sourceRef: mob.sourceRef,
    state: mob.state,
    hp: mob.hp,
    maxHp: mob.maxHp,
    position: Object.freeze({ ...mob.position }),
    home: Object.freeze({ ...mob.home }),
    spawnAnchor: Object.freeze({ ...mob.spawnAnchor }),
    spawnOrigin: mob.spawnOrigin ? Object.freeze({ ...mob.spawnOrigin }) : null,
    heightAuthority: mob.heightAuthority ? Object.freeze({ ...mob.heightAuthority }) : null,
    targetId: mob.targetId,
    diedAt: mob.diedAt,
    corpseDespawnAt: mob.corpseDespawnAt,
    respawnAt: mob.respawnAt,
    spawnEpoch: mob.spawnEpoch,
    revision: mob.revision,
  });
}

function distanceSquared(a, b) {
  if (!a || !b || ![a.x, a.y, a.z, b.x, b.y, b.z].every(Number.isFinite)) return Infinity;
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

module.exports = {
  MobState,
  createMobInstance,
  distanceSquared,
  normalizePosition,
  snapshotMob,
  validateWorldDefinition,
};
