'use strict';

const Nation = Object.freeze({
  KARUS: 1,
  ELMORAD: 2,
});

const ClanDuty = Object.freeze({
  UNKNOWN: 0,
  CHIEF: 1,
  VICE_CHIEF: 2,
  PUNISH: 3,
  TRAINEE: 4,
  KNIGHT: 5,
  OFFICER: 6,
});

const ClanRole = Object.freeze({
  CHIEF: 'chief',
  VICE_CHIEF: 'vice_chief',
  PUNISH: 'punish',
  TRAINEE: 'trainee',
  KNIGHT: 'knight',
  OFFICER: 'officer',
});

const ROLE_TO_DUTY = Object.freeze({
  [ClanRole.CHIEF]: ClanDuty.CHIEF,
  [ClanRole.VICE_CHIEF]: ClanDuty.VICE_CHIEF,
  [ClanRole.PUNISH]: ClanDuty.PUNISH,
  [ClanRole.TRAINEE]: ClanDuty.TRAINEE,
  [ClanRole.KNIGHT]: ClanDuty.KNIGHT,
  [ClanRole.OFFICER]: ClanDuty.OFFICER,
});

const ClanLimits = Object.freeze({
  MAX_MEMBERS: 24,
  MAX_VICE_CHIEFS: 3,
  MAX_NAME_BYTES: 30,
  CREATION_MIN_LEVEL: 20,
  CREATION_NOAH_COST: 500_000,
  KARUS_MIN_ID: 1,
  KARUS_MAX_ID: 14_999,
  ELMORAD_MIN_ID: 15_001,
  ELMORAD_MAX_ID: 30_000,
});

module.exports = {
  Nation,
  ClanDuty,
  ClanRole,
  ROLE_TO_DUTY,
  ClanLimits,
};
