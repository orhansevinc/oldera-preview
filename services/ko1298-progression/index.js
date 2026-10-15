const { ProgressionError } = require('./errors');
const { PersistentProgressionTransactionPort } = require('./postgres-transaction-port');
const {
  DEATH_STATE,
  XP_SOURCE,
  VERIFIED_MAX_LEVEL_1298,
  VERIFIED_RESPAWN_BLINK_MS_1298,
  ProgressionService,
  Verified1298PveDeathLossPolicy,
  compute1298LevelPointRewards,
  toXp,
  toSignedXp,
} = require('./progression-service');

module.exports = {
  DEATH_STATE,
  XP_SOURCE,
  VERIFIED_MAX_LEVEL_1298,
  VERIFIED_RESPAWN_BLINK_MS_1298,
  PersistentProgressionTransactionPort,
  ProgressionError,
  ProgressionService,
  Verified1298PveDeathLossPolicy,
  compute1298LevelPointRewards,
  toXp,
  toSignedXp,
};
