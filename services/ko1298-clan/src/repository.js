'use strict';

/**
 * Persistence contract for the clan domain.
 *
 * Production adapters (expected to be backed by WS07) must provide all methods
 * on both the repository and the transaction object passed to transaction().
 * The domain intentionally does not import a DB client or migrations.
 */
const REQUIRED_METHODS = Object.freeze([
  'transaction',
  'getCharacter',
  'saveCharacter',
  'getClanById',
  'findClanByNameInsensitive',
  'allocateClanId',
  'createClan',
  'saveClan',
  'deleteClan',
  'getMembershipByCharacter',
  'listClanMembers',
  'addMembership',
  'updateMembership',
  'removeMembership',
]);

function assertClanRepository(repository) {
  if (!repository || typeof repository !== 'object') {
    throw new TypeError('A clan repository is required.');
  }
  for (const method of REQUIRED_METHODS) {
    if (typeof repository[method] !== 'function') {
      throw new TypeError(`Clan repository is missing method: ${method}`);
    }
  }
  return repository;
}

module.exports = {
  REQUIRED_METHODS,
  assertClanRepository,
};
