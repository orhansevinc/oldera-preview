'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { PersistentMovementPort } = require('./persistent-movement-port');

const DOMAIN_LIVE_PROVIDER_PINS = Object.freeze({
  WS14: 'ed5f806ce7505f4dfae406e4164735def63b6c86',
  WS15: 'ce9bed13b8d45c32ff0592595aa3a0d1e7b3964d',
  WS16: '5ed48ff32187000312652838674388df52fc3fb7',
  WS25: '18c9e9b8439fef88fc93d74bfec7981b0cb41958',
});

function providerError(label, error) {
  const wrapped = new Error(`${label} production provider is required for oldkoweb-domain-live-20261015`, { cause: error });
  wrapped.code = 'PRODUCTION_PROVIDER_MISSING';
  return wrapped;
}

function loadProvider(modulePath, label, requireFn = require) {
  try {
    return requireFn(modulePath);
  } catch (error) {
    throw providerError(label, error);
  }
}

function requiredFile(value, label, existsSync = fs.existsSync) {
  if (!value || !existsSync(value)) {
    const error = new Error(`${label} file is required and must exist`);
    error.code = 'PRODUCTION_PROVIDER_INPUT_MISSING';
    throw error;
  }
  return path.resolve(value);
}

function createProductionProviderComposition({
  repository,
  env = process.env,
  requireFn = require,
  readFileSync = fs.readFileSync,
  existsSync = fs.existsSync,
  providers = null,
  heightResolver = null,
} = {}) {
  if (!repository || typeof repository.setNpcWorld !== 'function') {
    throw new TypeError('production PostgreSQL repository with setNpcWorld() is required');
  }

  const world = providers?.world || loadProvider('../ko1298-world', 'WS14', requireFn);
  const movement = providers?.movement || loadProvider('../ko1298-movement', 'WS15', requireFn);
  const npc = providers?.npc || loadProvider('../ko1298-npc', 'WS16', requireFn);
  const mobs = providers?.mobs || loadProvider('../ko1298-mobs', 'WS25', requireFn);

  const requiredFunctions = [
    [world.WorldSessionService, 'WS14.WorldSessionService'],
    [world.createSharedNpcRuntimeIdNamespace, 'WS14.createSharedNpcRuntimeIdNamespace'],
    [movement.MovementService, 'WS15.MovementService'],
    [npc.NpcWorld, 'WS16.NpcWorld'],
    [npc.materializeNpcPopulation, 'WS16.materializeNpcPopulation'],
    [mobs.MobVisibilityService, 'WS25.MobVisibilityService'],
    [mobs.loadVerifiedWorldDefinition, 'WS25.loadVerifiedWorldDefinition'],
  ];
  for (const [surface, label] of requiredFunctions) {
    if (typeof surface !== 'function') throw providerError(label, new TypeError(`${label} is not callable`));
  }

  let resolver = heightResolver;
  if (!resolver) {
    if (typeof world.createMoradonHeightResolver !== 'function') {
      throw providerError('WS14.createMoradonHeightResolver', new TypeError('missing height resolver'));
    }
    const smdPath = requiredFile(env.OLDKO_MORADON_SMD, 'OLDKO_MORADON_SMD', existsSync);
    resolver = world.createMoradonHeightResolver({ smdPath });
  }
  if (!resolver || typeof resolver.resolveHeight !== 'function') {
    throw new TypeError('authoritative Moradon height resolver is required');
  }

  const npcDataPath = requiredFile(
    env.OLDKO_MORADON_NPC_DATA || path.resolve(__dirname, '../../world-data/npc/moradon.json'),
    'OLDKO_MORADON_NPC_DATA',
    existsSync,
  );
  const mobDataPath = requiredFile(
    env.OLDKO_MORADON_MOB_DATA || path.resolve(__dirname, '../../world-data/mobs/verified/moradon-zone21.verified.json'),
    'OLDKO_MORADON_MOB_DATA',
    existsSync,
  );

  const npcDocument = JSON.parse(readFileSync(npcDataPath, 'utf8'));
  const npcPopulation = npc.materializeNpcPopulation(npcDocument, { heightAuthority: resolver });
  if (!Array.isArray(npcPopulation.records) || npcPopulation.records.length === 0) {
    throw new Error('WS16 produced no authoritative Moradon NPC records');
  }

  const npcWorld = new npc.NpcWorld();
  for (const record of npcPopulation.records) npcWorld.add(record);
  repository.setNpcWorld(npcWorld);

  const runtimeIds = world.createSharedNpcRuntimeIdNamespace({
    minInclusive: mobs.RUNTIME_ID_CONTRACT.NPC_BAND,
    maxExclusive: mobs.RUNTIME_ID_CONTRACT.INVALID_BAND,
    reserved: npcPopulation.records,
  });
  const mobDocument = JSON.parse(readFileSync(mobDataPath, 'utf8'));
  const worldDefinition = mobs.loadVerifiedWorldDefinition(mobDocument);
  const mobService = new mobs.MobVisibilityService(worldDefinition, {
    terrain: {
      resolveHeight(zoneId, x, z) {
        return resolver.resolveHeight(Number(zoneId), x, z);
      },
    },
    runtimeIds,
  });
  const materializedMobs = mobService.initialize(0);
  if (!Array.isArray(materializedMobs) || materializedMobs.length !== 135) {
    throw new Error(`WS25 Moradon population mismatch: expected 135, got ${materializedMobs?.length ?? 'invalid'}`);
  }

  const zoneBounds = {
    isValidPosition(zoneId, position) {
      if (Number(zoneId) !== 21 || !position || !Number.isFinite(position.x) || !Number.isFinite(position.y) || !Number.isFinite(position.z)) {
        return false;
      }
      const result = resolver.resolveHeight(21, position.x, position.z, { yHint: position.y });
      return result?.status === 'authoritative' && Number.isFinite(result.height);
    },
  };
  const baseWorldSession = new world.WorldSessionService({
    repository,
    mobPort: mobService,
  });
  const worldSession = new Proxy(baseWorldSession, {
    get(target, property, receiver) {
      if (property === 'beginSelectedCharacter') {
        return (input) => target.restoreAuthoritativeSession(input);
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const baseMovementSession = new movement.MovementService({ zoneBounds });
  const movementSession = new PersistentMovementPort({
    movement: baseMovementSession,
    repository,
    worldSession,
  });

  return Object.freeze({
    worldSession,
    movementSession,
    npcWorld,
    mobService,
    providerPins: DOMAIN_LIVE_PROVIDER_PINS,
    evidence: Object.freeze({
      npcRecords: npcPopulation.records.length,
      mobRecords: materializedMobs.length,
      sharedRuntimeNamespace: runtimeIds.snapshot ? runtimeIds.snapshot() : null,
      moradonSmdRequired: !heightResolver,
    }),
  });
}

module.exports = {
  DOMAIN_LIVE_PROVIDER_PINS,
  createProductionProviderComposition,
};
