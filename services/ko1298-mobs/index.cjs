'use strict';

const { MobService: DomainMobService } = require('./mob-service.cjs');
const { MobVisibilityService, RUNTIME_ID_CONTRACT } = require('./mob-visibility-service.cjs');
const { MobCombatService } = require('./mob-combat-service.cjs');
const { MobState, validateWorldDefinition } = require('./mob-model.cjs');
const { DeterministicMobScheduler } = require('./scheduler.cjs');
const { loadVerifiedWorldDefinition, loadWs31MonsterTemplates, deterministicInt } = require('./verified-data-loader.cjs');
const { MORADON_VISIBILITY_SOURCE } = require('./mob-visibility-authority.cjs');
const { MORADON_COMBAT_SOURCE, combatAuthorityForTemplate } = require('./mob-combat-authority.cjs');
const {
  DEFAULT_TICK_MS,
  DEATH_LEDGER_LIMIT,
  MobProductionRuntime,
  createMobProductionRuntime,
  normalizePlayer,
} = require('./production-runtime.cjs');

module.exports = {
  MobService: MobCombatService,
  DomainMobService,
  MobVisibilityService,
  MobCombatService,
  MobProductionRuntime,
  createMobProductionRuntime,
  DEFAULT_TICK_MS,
  DEATH_LEDGER_LIMIT,
  normalizePlayer,
  MobState,
  DeterministicMobScheduler,
  MORADON_VISIBILITY_SOURCE,
  MORADON_COMBAT_SOURCE,
  RUNTIME_ID_CONTRACT,
  combatAuthorityForTemplate,
  deterministicInt,
  loadVerifiedWorldDefinition,
  loadWs31MonsterTemplates,
  validateWorldDefinition,
};
