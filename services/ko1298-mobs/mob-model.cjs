'use strict';

const MobState = Object.freeze({
  IDLE: 'idle',
  CHASING: 'chasing',
  RETURNING: 'returning',
  DEAD: 'dead',
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
  if (!Number.isInteger(value) || value < min) fail(`${label} must be an integer >= ${min}`);
  return value;
}

function normalizePosition(position, label = 'position') {
  if (!position || typeof position !== 'object') fail(`${label} is required`);
  return Object.freeze({
    x: requireFinite(position.x, `${label}.x`),
    y: requireFinite(position.y, `${label}.y`),
    z: requireFinite(position.z, `${label}.z`),
    heading: requireFinite(position.heading ?? 0, `${label}.heading`),
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
  if (leashRange < aggroRange) fail(`${raw.templateId}.leashRange must be >= aggroRange`);
  const returnTolerance = requireFinite(raw.returnTolerance ?? 0.5, `${raw.templateId}.returnTolerance`, { min: 0 });
  const corpseDespawnMs = requireInteger(raw.corpseDespawnMs, `${raw.templateId}.corpseDespawnMs`);
  const respawnDelayMs = requireInteger(raw.respawnDelayMs, `${raw.templateId}.respawnDelayMs`);
  if (respawnDelayMs < corpseDespawnMs) {
    fail(`${raw.templateId}.respawnDelayMs must be >= corpseDespawnMs`);
  }

  return Object.freeze({
    templateId: raw.templateId,
    displayName: raw.displayName,
    dataClass: raw.dataClass,
    sourceRef: raw.sourceRef ?? null,
    modelRef: raw.modelRef ?? null,
    maxHp,
    aggroRange,
    leashRange,
    returnTolerance,
    corpseDespawnMs,
    respawnDelayMs,
  });
}

function validateWorldDefinition(raw) {
  if (!raw || typeof raw !== 'object') fail('world definition must be an object');
  if (raw.schemaVersion !== 1) fail('schemaVersion must be 1');
  if (raw.dataClass !== 'fixture' && raw.dataClass !== 'real') fail('dataClass must be fixture or real');
  if (!isNonEmptyString(raw.zoneId)) fail('zoneId is required');
  if (raw.dataClass === 'fixture' && !raw.zoneId.startsWith('fixture:')) {
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
    if (!templates.has(group.templateId)) fail(`${group.groupId} references unknown template ${group.templateId}`);
    if (!Array.isArray(group.spawns) || group.spawns.length === 0) fail(`${group.groupId}.spawns must be non-empty`);

    const spawnIds = new Set();
    const spawns = group.spawns.map((spawn) => {
      if (!spawn || typeof spawn !== 'object') fail(`${group.groupId} spawn must be an object`);
      if (!isNonEmptyString(spawn.spawnId)) fail(`${group.groupId}.spawnId is required`);
      if (spawnIds.has(spawn.spawnId)) fail(`duplicate spawnId ${spawn.spawnId} in ${group.groupId}`);
      spawnIds.add(spawn.spawnId);
      const instanceId = `${group.groupId}/${spawn.spawnId}`;
      if (instanceIds.has(instanceId)) fail(`duplicate mob instance id ${instanceId}`);
      instanceIds.add(instanceId);
      return Object.freeze({
        spawnId: spawn.spawnId,
        position: normalizePosition(spawn, `${group.groupId}.${spawn.spawnId}`),
      });
    });

    return Object.freeze({
      groupId: group.groupId,
      templateId: group.templateId,
      spawns: Object.freeze(spawns),
    });
  });

  return Object.freeze({
    schemaVersion: 1,
    dataClass: raw.dataClass,
    zoneId: raw.zoneId,
    templates,
    spawnGroups: Object.freeze(spawnGroups),
  });
}

function createMobInstance(zoneId, group, spawn, template) {
  return {
    id: `${group.groupId}/${spawn.spawnId}`,
    templateId: template.templateId,
    groupId: group.groupId,
    spawnId: spawn.spawnId,
    zoneId,
    state: MobState.IDLE,
    hp: template.maxHp,
    maxHp: template.maxHp,
    position: { ...spawn.position },
    home: { ...spawn.position },
    targetId: null,
    diedAt: null,
    corpseDespawnAt: null,
    respawnAt: null,
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
    state: mob.state,
    hp: mob.hp,
    maxHp: mob.maxHp,
    position: Object.freeze({ ...mob.position }),
    home: Object.freeze({ ...mob.home }),
    targetId: mob.targetId,
    diedAt: mob.diedAt,
    corpseDespawnAt: mob.corpseDespawnAt,
    respawnAt: mob.respawnAt,
    revision: mob.revision,
  });
}

function distanceSquared(a, b) {
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
