'use strict';

const { ClanService } = require('./clan-service');
const { MemoryClanRepository } = require('./memory-repository');
const { createClanChatDirectory } = require('./clan-chat-interface');
const { ClanError, ErrorCode } = require('./errors');
const { Nation, ClanDuty, ClanRole, ROLE_TO_DUTY, ClanLimits } = require('./constants');
const { validateClanName, calculateClanGrade, idRangeForNation } = require('./rules');
const { REQUIRED_METHODS, assertClanRepository } = require('./repository');

module.exports = {
  ClanService,
  MemoryClanRepository,
  createClanChatDirectory,
  ClanError,
  ErrorCode,
  Nation,
  ClanDuty,
  ClanRole,
  ROLE_TO_DUTY,
  ClanLimits,
  validateClanName,
  calculateClanGrade,
  idRangeForNation,
  REQUIRED_METHODS,
  assertClanRepository,
};
