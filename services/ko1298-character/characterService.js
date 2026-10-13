'use strict';

const {
  MAX_CHARACTER_SLOTS,
  INITIAL_LEVEL,
  INITIAL_EXPERIENCE,
  INITIAL_UNSPENT_STAT_POINTS,
  INITIAL_UNSPENT_SKILL_POINTS,
} = require('./catalog');
const {
  assertValidSlot,
  assertValidCharacterName,
  assertValidIdentity,
  assertValidAppearance,
  assertValidStats,
} = require('./rules');
const {
  ERROR_CODES,
  CharacterRuleError,
  CharacterRepositoryConflictError,
} = require('./errors');

class CharacterIdentityService {
  constructor({ repository, startingSpawnProvider, startingItemProvider }) {
    if (!repository || !startingSpawnProvider || !startingItemProvider) {
      throw new TypeError('repository, startingSpawnProvider and startingItemProvider are required.');
    }
    this.repository = repository;
    this.startingSpawnProvider = startingSpawnProvider;
    this.startingItemProvider = startingItemProvider;
  }

  async createCharacter(request) {
    if (!request || typeof request !== 'object') {
      throw new CharacterRuleError(ERROR_CODES.INVALID_NAME, 'Character create request is required.');
    }

    const { accountId, slot, name, nameByteLength, race, classId, face, hair, stats } = request;
    if (typeof accountId !== 'string' || accountId.length === 0) {
      throw new CharacterRuleError(ERROR_CODES.ACCOUNT_NOT_FOUND, 'Account identity is required.');
    }

    assertValidSlot(slot);
    assertValidCharacterName(name, nameByteLength);

    const account = await this.repository.getAccountCharacterState(accountId);
    if (!account) {
      throw new CharacterRuleError(ERROR_CODES.ACCOUNT_NOT_FOUND, 'Account was not found.');
    }

    const slots = normalizeSlots(account.slots);
    const occupiedCount = slots.filter(Boolean).length;
    if (occupiedCount >= MAX_CHARACTER_SLOTS) {
      throw new CharacterRuleError(ERROR_CODES.ACCOUNT_CHARACTER_LIMIT, 'Account already has three characters.');
    }
    if (slots[slot]) {
      throw new CharacterRuleError(ERROR_CODES.SLOT_OCCUPIED, 'Requested character slot is occupied.');
    }

    const preset = assertValidIdentity(account.nation, race, classId);
    assertValidAppearance(face, hair);
    assertValidStats(stats, preset);

    if (request.nation !== undefined && request.nation !== account.nation) {
      throw new CharacterRuleError(ERROR_CODES.NATION_RACE_MISMATCH, 'Packet nation does not match server-side account nation.');
    }

    if (await this.repository.isCharacterNameTaken(name)) {
      throw new CharacterRuleError(ERROR_CODES.DUPLICATE_NAME, 'Character name already exists.');
    }

    const identity = Object.freeze({ nation: account.nation, race, classId });
    const [startingSpawn, startingItems] = await Promise.all([
      this.startingSpawnProvider.resolveStartingSpawn(identity),
      this.startingItemProvider.resolveStartingItems(identity),
    ]);

    const record = Object.freeze({
      accountId,
      slot,
      name,
      nation: account.nation,
      race,
      classId,
      face,
      hair,
      stats: Object.freeze({ ...stats }),
      level: INITIAL_LEVEL,
      experience: INITIAL_EXPERIENCE,
      unspentStatPoints: INITIAL_UNSPENT_STAT_POINTS,
      unspentSkillPoints: INITIAL_UNSPENT_SKILL_POINTS,
      startingSpawn,
      startingItems,
    });

    try {
      await this.repository.createCharacter(record);
    } catch (error) {
      throw mapRepositoryConflict(error);
    }

    return record;
  }

  /**
   * Patch 1298 carries WIZ_DEL_CHAR, but the referenced Aujard implementation leaves
   * DB deletion disabled. This method only validates identity/slot ownership and
   * returns a deletion plan; it deliberately performs no destructive persistence.
   */
  async prepareDeleteCharacter({ accountId, slot, characterName }) {
    if (typeof accountId !== 'string' || accountId.length === 0) {
      throw new CharacterRuleError(ERROR_CODES.ACCOUNT_NOT_FOUND, 'Account identity is required.');
    }
    assertValidSlot(slot);

    const character = await this.repository.getCharacterAtSlot(accountId, slot);
    if (!character) {
      throw new CharacterRuleError(ERROR_CODES.CHARACTER_NOT_FOUND, 'Character slot is empty.');
    }
    if (typeof characterName !== 'string' || character.name !== characterName) {
      throw new CharacterRuleError(
        ERROR_CODES.CHARACTER_IDENTITY_MISMATCH,
        'Delete request character identity does not match the selected slot.',
      );
    }

    return Object.freeze({
      accountId,
      slot,
      characterName,
      destructiveDeleteEnabled: false,
    });
  }
}

function normalizeSlots(slots) {
  if (!Array.isArray(slots)) {
    return Array(MAX_CHARACTER_SLOTS).fill(null);
  }
  return Array.from({ length: MAX_CHARACTER_SLOTS }, (_, index) => slots[index] || null);
}

function mapRepositoryConflict(error) {
  if (!(error instanceof CharacterRepositoryConflictError)) {
    return error;
  }

  if (error.code === ERROR_CODES.DUPLICATE_NAME
      || error.code === ERROR_CODES.SLOT_OCCUPIED
      || error.code === ERROR_CODES.ACCOUNT_CHARACTER_LIMIT) {
    return new CharacterRuleError(error.code, error.message);
  }
  return new CharacterRuleError(ERROR_CODES.PERSISTENCE_CONFLICT, error.message);
}

module.exports = {
  CharacterIdentityService,
};
