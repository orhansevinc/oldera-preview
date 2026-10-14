'use strict';

const REPOSITORY_METHODS = Object.freeze([
  'transaction', 'overview', 'listPlayers', 'getCharacter', 'updateCharacter', 'updateStats', 'updateSkills',
  'getInventory', 'getInn', 'getTransactions', 'getSanctions', 'searchItems', 'itemHistory', 'itemAction',
  'findDuplicateSerials', 'createSanction', 'removeSanction', 'appendAudit', 'listAudit',
  'createAdminSession', 'getAdminSession', 'revokeAdminSession',
  'runIdempotent', 'enqueueCommand', 'updateCommand', 'getCommand'
]);

const RUNTIME_METHODS = Object.freeze([
  'listOnlineCharacters', 'getCharacterState', 'mutateOnlineCharacter'
]);

function requireMethods(value, methods, label) {
  if (!value || typeof value !== 'object') throw new TypeError(`${label} is required`);
  for (const method of methods) {
    if (typeof value[method] !== 'function') throw new TypeError(`${label} missing method: ${method}`);
  }
  return value;
}

function assertProductionRepository(repository) {
  if (repository?.constructor?.name === 'MemoryAdminRepository') {
    throw new Error('MemoryAdminRepository is forbidden in production');
  }
  return requireMethods(repository, REPOSITORY_METHODS, 'Production admin repository');
}

function assertRuntimeAuthority(runtimeAuthority) {
  return requireMethods(runtimeAuthority, RUNTIME_METHODS, 'Authoritative game runtime adapter');
}

function assertCommandBus(commandBus) {
  return requireMethods(commandBus, ['execute'], 'WS28 command bus');
}

module.exports = {
  REPOSITORY_METHODS,
  RUNTIME_METHODS,
  requireMethods,
  assertProductionRepository,
  assertRuntimeAuthority,
  assertCommandBus
};
