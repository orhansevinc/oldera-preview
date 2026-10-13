'use strict';

const {
  NATIONS,
  RACE_NATION,
  CLASS_NATION,
  MAX_CHARACTER_SLOTS,
  MIN_CHARACTER_NAME_LENGTH,
  MAX_CHARACTER_NAME_LENGTH,
  FACE_MIN,
  FACE_MAX,
  HAIR_MIN,
  HAIR_MAX,
  getCreationPreset,
} = require('./catalog');
const { ERROR_CODES, CharacterRuleError } = require('./errors');

const STAT_FIELDS = Object.freeze(['strength', 'stamina', 'dexterity', 'intelligence', 'magicPower']);

// Exact blacklist in the 1298 character-create client, plus all control/whitespace
// characters as a server-side anti-bypass guard. Underscore is intentionally allowed.
const LEGACY_FORBIDDEN_NAME_CHARACTERS = new Set([
  '~', '`', '!', '@', '#', '$', '%', '^', '&', '*', '(', ')', '-', '+', '=', '|', '\\',
  '<', '>', ',', '.', '?', '/', '{', '[', '}', ']', '"', "'", ' ',
]);

function assertValidSlot(slot) {
  if (!Number.isInteger(slot) || slot < 0 || slot >= MAX_CHARACTER_SLOTS) {
    throw new CharacterRuleError(ERROR_CODES.INVALID_SLOT, `Character slot must be 0-${MAX_CHARACTER_SLOTS - 1}.`);
  }
}

function assertValidCharacterName(name, nameByteLength) {
  if (typeof name !== 'string' || name.length === 0) {
    throw new CharacterRuleError(ERROR_CODES.INVALID_NAME, 'Character name is required.');
  }

  // MAX_ID_SIZE is a byte-oriented legacy protocol/server limit. WS03 should pass the
  // original encoded byte length. ASCII callers may omit it and use character count.
  const characterLength = Array.from(name).length;
  const effectiveLength = nameByteLength === undefined ? characterLength : nameByteLength;
  if (!Number.isInteger(effectiveLength)
      || effectiveLength < MIN_CHARACTER_NAME_LENGTH
      || effectiveLength > MAX_CHARACTER_NAME_LENGTH
      || characterLength > MAX_CHARACTER_NAME_LENGTH
      || effectiveLength < characterLength) {
    throw new CharacterRuleError(
      ERROR_CODES.INVALID_NAME_LENGTH,
      `Character name length must be ${MIN_CHARACTER_NAME_LENGTH}-${MAX_CHARACTER_NAME_LENGTH} legacy bytes.`,
    );
  }

  for (const char of name) {
    const codePoint = char.codePointAt(0);
    if (LEGACY_FORBIDDEN_NAME_CHARACTERS.has(char)
        || /\s/u.test(char)
        || codePoint < 0x20
        || codePoint === 0x7f) {
      throw new CharacterRuleError(
        ERROR_CODES.INVALID_NAME_CHARACTER,
        'Character name contains a character rejected by 1298 creation rules.',
        { character: char },
      );
    }
  }
}

function assertValidNation(nation) {
  if (nation !== NATIONS.KARUS && nation !== NATIONS.ELMORAD) {
    throw new CharacterRuleError(ERROR_CODES.INVALID_ACCOUNT_NATION, 'Account nation must be Karus or El Morad.');
  }
}

function assertValidIdentity(nation, race, classId) {
  assertValidNation(nation);

  const raceNation = RACE_NATION[race];
  if (!raceNation) {
    throw new CharacterRuleError(ERROR_CODES.INVALID_RACE, 'Race is not a 1298 playable creation race.');
  }
  if (raceNation !== nation) {
    throw new CharacterRuleError(ERROR_CODES.NATION_RACE_MISMATCH, 'Race is not compatible with the account nation.');
  }

  const classNation = CLASS_NATION[classId];
  if (!classNation) {
    throw new CharacterRuleError(ERROR_CODES.INVALID_CLASS, 'Class is not a 1298 base creation class.');
  }
  if (classNation !== nation) {
    throw new CharacterRuleError(ERROR_CODES.NATION_CLASS_MISMATCH, 'Class is not compatible with the account nation.');
  }

  const preset = getCreationPreset(race, classId);
  if (!preset) {
    throw new CharacterRuleError(ERROR_CODES.RACE_CLASS_MISMATCH, 'Race/class pair does not exist in 1298 NewChrValue.tbl.');
  }
  return preset;
}

function assertValidAppearance(face, hair) {
  if (!Number.isInteger(face) || face < FACE_MIN || face > FACE_MAX) {
    throw new CharacterRuleError(ERROR_CODES.INVALID_FACE, `Face must be ${FACE_MIN}-${FACE_MAX}.`);
  }
  if (!Number.isInteger(hair) || hair < HAIR_MIN || hair > HAIR_MAX) {
    throw new CharacterRuleError(ERROR_CODES.INVALID_HAIR, `Hair must be ${HAIR_MIN}-${HAIR_MAX}.`);
  }
}

function assertValidStats(stats, preset) {
  if (!stats || typeof stats !== 'object') {
    throw new CharacterRuleError(ERROR_CODES.INVALID_STATS, 'Five creation stats are required.');
  }

  let spent = 0;
  for (const field of STAT_FIELDS) {
    const value = stats[field];
    const base = preset.baseStats[field];
    if (!Number.isInteger(value) || value < 0 || value > 255) {
      throw new CharacterRuleError(ERROR_CODES.INVALID_STATS, `${field} must be an unsigned byte integer.`);
    }
    if (value < base) {
      throw new CharacterRuleError(
        ERROR_CODES.INVALID_STAT_DISTRIBUTION,
        `${field} cannot be below the 1298 base value.`,
        { field, base, value },
      );
    }
    spent += value - base;
  }

  if (spent !== preset.bonusPoints) {
    throw new CharacterRuleError(
      ERROR_CODES.INVALID_STAT_DISTRIBUTION,
      `Exactly ${preset.bonusPoints} creation bonus points must be spent.`,
      { expected: preset.bonusPoints, spent },
    );
  }
}

module.exports = {
  STAT_FIELDS,
  LEGACY_FORBIDDEN_NAME_CHARACTERS,
  assertValidSlot,
  assertValidCharacterName,
  assertValidNation,
  assertValidIdentity,
  assertValidAppearance,
  assertValidStats,
};
