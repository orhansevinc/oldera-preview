'use strict';

const { ClanLimits, Nation } = require('./constants');
const { ClanError, ErrorCode } = require('./errors');

function assertNation(nation) {
  if (nation !== Nation.KARUS && nation !== Nation.ELMORAD) {
    throw new ClanError(ErrorCode.INVALID_NATION, `Unsupported 1298 nation: ${nation}`);
  }
}

function validateClanName(name) {
  if (typeof name !== 'string' || name.length === 0) {
    throw new ClanError(ErrorCode.INVALID_CLAN_NAME, 'Clan name must be a non-empty string.');
  }

  const bytes = Buffer.byteLength(name, 'utf8');
  if (bytes > ClanLimits.MAX_NAME_BYTES) {
    throw new ClanError(
      ErrorCode.INVALID_CLAN_NAME,
      `Clan name exceeds ${ClanLimits.MAX_NAME_BYTES} UTF-8 bytes.`,
      { bytes },
    );
  }

  // Safety hardening only: the 1298 server uses C strings, so embedded control/NUL
  // characters are rejected rather than being allowed to create ambiguous names.
  if (/[\u0000-\u001f\u007f]/u.test(name)) {
    throw new ClanError(ErrorCode.INVALID_CLAN_NAME, 'Clan name contains a control character.');
  }

  return name;
}

function calculateClanGrade(totalNationalPoints) {
  if (!Number.isSafeInteger(totalNationalPoints) || totalNationalPoints < 0) {
    throw new TypeError('totalNationalPoints must be a non-negative safe integer.');
  }

  const clanPoints = Math.floor(totalNationalPoints / 24);
  if (clanPoints < 2_000) return 5;
  if (clanPoints < 5_000) return 4;
  if (clanPoints < 10_000) return 3;
  if (clanPoints < 20_000) return 2;
  return 1;
}

function idRangeForNation(nation) {
  assertNation(nation);
  if (nation === Nation.KARUS) {
    return { min: ClanLimits.KARUS_MIN_ID, max: ClanLimits.KARUS_MAX_ID };
  }
  return { min: ClanLimits.ELMORAD_MIN_ID, max: ClanLimits.ELMORAD_MAX_ID };
}

module.exports = {
  assertNation,
  validateClanName,
  calculateClanGrade,
  idRangeForNation,
};
