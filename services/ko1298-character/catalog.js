'use strict';

const NATIONS = Object.freeze({
  KARUS: 1,
  ELMORAD: 2,
});

const RACES = Object.freeze({
  KARUS_ARKTUAREK: 1,
  KARUS_TUAREK: 2,
  KARUS_WRINKLETUAREK: 3,
  KARUS_PURITUAREK: 4,
  ELMORAD_BARBARIAN: 11,
  ELMORAD_MAN: 12,
  ELMORAD_WOMAN: 13,
});

const CLASSES = Object.freeze({
  KARUS_WARRIOR: 101,
  KARUS_ROGUE: 102,
  KARUS_WIZARD: 103,
  KARUS_PRIEST: 104,
  ELMORAD_WARRIOR: 201,
  ELMORAD_ROGUE: 202,
  ELMORAD_WIZARD: 203,
  ELMORAD_PRIEST: 204,
});

const MAX_CHARACTER_SLOTS = 3;
const MIN_CHARACTER_NAME_LENGTH = 1;
const MAX_CHARACTER_NAME_LENGTH = 20;
const FACE_MIN = 0;
const FACE_MAX = 3;
const HAIR_MIN = 0;
const HAIR_MAX = 2;

const INITIAL_LEVEL = 1;
const INITIAL_EXPERIENCE = 0;
const INITIAL_UNSPENT_STAT_POINTS = 0;
const INITIAL_UNSPENT_SKILL_POINTS = 0;

// Extracted from the 1298 Data/NewChrValue.tbl asset. The key is race * 10000 + class.
// Each row contains the server-authoritative minimum stats and creation bonus budget.
const CREATION_PRESETS = Object.freeze({
  10101: freezePreset(1, 101, { strength: 65, stamina: 65, dexterity: 60, intelligence: 50, magicPower: 50 }, 10),
  20102: freezePreset(2, 102, { strength: 60, stamina: 60, dexterity: 70, intelligence: 50, magicPower: 50 }, 10),
  20104: freezePreset(2, 104, { strength: 60, stamina: 60, dexterity: 70, intelligence: 50, magicPower: 50 }, 10),
  30103: freezePreset(3, 103, { strength: 50, stamina: 50, dexterity: 70, intelligence: 70, magicPower: 50 }, 10),
  40104: freezePreset(4, 104, { strength: 50, stamina: 60, dexterity: 60, intelligence: 70, magicPower: 50 }, 10),
  110201: freezePreset(11, 201, { strength: 65, stamina: 65, dexterity: 60, intelligence: 50, magicPower: 50 }, 10),
  120201: freezePreset(12, 201, { strength: 60, stamina: 60, dexterity: 70, intelligence: 50, magicPower: 50 }, 10),
  120202: freezePreset(12, 202, { strength: 60, stamina: 60, dexterity: 70, intelligence: 50, magicPower: 50 }, 10),
  120203: freezePreset(12, 203, { strength: 60, stamina: 60, dexterity: 70, intelligence: 50, magicPower: 50 }, 10),
  120204: freezePreset(12, 204, { strength: 60, stamina: 60, dexterity: 70, intelligence: 50, magicPower: 50 }, 10),
  130201: freezePreset(13, 201, { strength: 50, stamina: 50, dexterity: 70, intelligence: 70, magicPower: 50 }, 10),
  130202: freezePreset(13, 202, { strength: 50, stamina: 50, dexterity: 70, intelligence: 70, magicPower: 50 }, 10),
  130203: freezePreset(13, 203, { strength: 50, stamina: 50, dexterity: 70, intelligence: 70, magicPower: 50 }, 10),
  130204: freezePreset(13, 204, { strength: 50, stamina: 50, dexterity: 70, intelligence: 70, magicPower: 50 }, 10),
});

const RACE_NATION = Object.freeze({
  [RACES.KARUS_ARKTUAREK]: NATIONS.KARUS,
  [RACES.KARUS_TUAREK]: NATIONS.KARUS,
  [RACES.KARUS_WRINKLETUAREK]: NATIONS.KARUS,
  [RACES.KARUS_PURITUAREK]: NATIONS.KARUS,
  [RACES.ELMORAD_BARBARIAN]: NATIONS.ELMORAD,
  [RACES.ELMORAD_MAN]: NATIONS.ELMORAD,
  [RACES.ELMORAD_WOMAN]: NATIONS.ELMORAD,
});

const CLASS_NATION = Object.freeze({
  [CLASSES.KARUS_WARRIOR]: NATIONS.KARUS,
  [CLASSES.KARUS_ROGUE]: NATIONS.KARUS,
  [CLASSES.KARUS_WIZARD]: NATIONS.KARUS,
  [CLASSES.KARUS_PRIEST]: NATIONS.KARUS,
  [CLASSES.ELMORAD_WARRIOR]: NATIONS.ELMORAD,
  [CLASSES.ELMORAD_ROGUE]: NATIONS.ELMORAD,
  [CLASSES.ELMORAD_WIZARD]: NATIONS.ELMORAD,
  [CLASSES.ELMORAD_PRIEST]: NATIONS.ELMORAD,
});

function freezePreset(race, classId, baseStats, bonusPoints) {
  return Object.freeze({
    race,
    classId,
    baseStats: Object.freeze({ ...baseStats }),
    bonusPoints,
  });
}

function presetKey(race, classId) {
  return (race * 10000) + classId;
}

function getCreationPreset(race, classId) {
  return CREATION_PRESETS[presetKey(race, classId)] || null;
}

module.exports = {
  NATIONS,
  RACES,
  CLASSES,
  RACE_NATION,
  CLASS_NATION,
  CREATION_PRESETS,
  MAX_CHARACTER_SLOTS,
  MIN_CHARACTER_NAME_LENGTH,
  MAX_CHARACTER_NAME_LENGTH,
  FACE_MIN,
  FACE_MAX,
  HAIR_MIN,
  HAIR_MAX,
  INITIAL_LEVEL,
  INITIAL_EXPERIENCE,
  INITIAL_UNSPENT_STAT_POINTS,
  INITIAL_UNSPENT_SKILL_POINTS,
  presetKey,
  getCreationPreset,
};
