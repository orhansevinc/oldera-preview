'use strict';

const ERROR_CODES = Object.freeze({
  ACCOUNT_NOT_FOUND: 'ACCOUNT_NOT_FOUND',
  INVALID_ACCOUNT_NATION: 'INVALID_ACCOUNT_NATION',
  INVALID_SLOT: 'INVALID_SLOT',
  SLOT_OCCUPIED: 'SLOT_OCCUPIED',
  ACCOUNT_CHARACTER_LIMIT: 'ACCOUNT_CHARACTER_LIMIT',
  INVALID_NAME: 'INVALID_NAME',
  INVALID_NAME_LENGTH: 'INVALID_NAME_LENGTH',
  INVALID_NAME_CHARACTER: 'INVALID_NAME_CHARACTER',
  DUPLICATE_NAME: 'DUPLICATE_NAME',
  INVALID_RACE: 'INVALID_RACE',
  INVALID_CLASS: 'INVALID_CLASS',
  NATION_RACE_MISMATCH: 'NATION_RACE_MISMATCH',
  NATION_CLASS_MISMATCH: 'NATION_CLASS_MISMATCH',
  RACE_CLASS_MISMATCH: 'RACE_CLASS_MISMATCH',
  INVALID_FACE: 'INVALID_FACE',
  INVALID_HAIR: 'INVALID_HAIR',
  INVALID_STATS: 'INVALID_STATS',
  INVALID_STAT_DISTRIBUTION: 'INVALID_STAT_DISTRIBUTION',
  CHARACTER_NOT_FOUND: 'CHARACTER_NOT_FOUND',
  CHARACTER_IDENTITY_MISMATCH: 'CHARACTER_IDENTITY_MISMATCH',
  PERSISTENCE_CONFLICT: 'PERSISTENCE_CONFLICT',
});

class CharacterRuleError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'CharacterRuleError';
    this.code = code;
    this.details = details;
  }
}

class CharacterRepositoryConflictError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'CharacterRepositoryConflictError';
    this.code = code;
  }
}

module.exports = {
  ERROR_CODES,
  CharacterRuleError,
  CharacterRepositoryConflictError,
};
