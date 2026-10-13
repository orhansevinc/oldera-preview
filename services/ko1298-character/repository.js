'use strict';

/**
 * Persistence boundary for WS34. Implementations live outside this workstream.
 *
 * Atomicity requirement for createCharacter(record):
 * - re-check account slot ownership/availability,
 * - enforce the three-slot account limit,
 * - enforce globally unique character identity according to DB collation,
 * - write the character and account-slot link in one transaction.
 *
 * Conflict errors should use CharacterRepositoryConflictError with code
 * DUPLICATE_NAME, SLOT_OCCUPIED or ACCOUNT_CHARACTER_LIMIT.
 */
class CharacterRepository {
  async getAccountCharacterState(_accountId) {
    throw new Error('CharacterRepository.getAccountCharacterState() is not implemented.');
  }

  async isCharacterNameTaken(_name) {
    throw new Error('CharacterRepository.isCharacterNameTaken() is not implemented.');
  }

  async createCharacter(_record) {
    throw new Error('CharacterRepository.createCharacter() is not implemented.');
  }

  async getCharacterAtSlot(_accountId, _slot) {
    throw new Error('CharacterRepository.getCharacterAtSlot() is not implemented.');
  }
}

/** Starting zone/position boundary. WS34 owns the decision request, not world coordinates. */
class StartingSpawnProvider {
  async resolveStartingSpawn(_identity) {
    throw new Error('StartingSpawnProvider.resolveStartingSpawn() is not implemented.');
  }
}

/** Starting inventory boundary. Item IDs/serial creation belong to the item/data integration. */
class StartingItemProvider {
  async resolveStartingItems(_identity) {
    throw new Error('StartingItemProvider.resolveStartingItems() is not implemented.');
  }
}

module.exports = {
  CharacterRepository,
  StartingSpawnProvider,
  StartingItemProvider,
};
