'use strict';

const { QuestError } = require('./errors');

const QuestStatus = Object.freeze({
  NOT_STARTED: 'not_started',
  ACTIVE: 'active',
  COMPLETED: 'completed'
});

const ScriptOp = Object.freeze({
  DIALOGUE: 'dialogue',
  QUEST_VIEW: 'quest_view',
  QUEST_ACCEPT: 'quest_accept',
  QUEST_COMPLETE: 'quest_complete',
  QUEST_ABANDON: 'quest_abandon',
  GOTO_IF_STATE: 'goto_if_state',
  END: 'end'
});

function assert(condition, code, message, details) {
  if (!condition) throw new QuestError(code, message, details);
}

function isOpaqueId(value) {
  return (typeof value === 'string' && value.length > 0 && value.length <= 128)
    || (Number.isSafeInteger(value) && value >= 0);
}

function validateQuestDefinition(input) {
  assert(input && typeof input === 'object' && !Array.isArray(input), 'INVALID_DEFINITION', 'Quest definition must be an object');
  assert(isOpaqueId(input.id), 'INVALID_DEFINITION', 'Quest id must be an opaque non-empty string or non-negative integer');
  assert(typeof input.name === 'string' && input.name.length > 0, 'INVALID_DEFINITION', 'Quest name is required');
  assert(typeof input.repeatable === 'boolean', 'INVALID_DEFINITION', 'repeatable must be explicit');
  assert(typeof input.allowAbandon === 'boolean', 'INVALID_DEFINITION', 'allowAbandon must be explicit');

  const requirements = input.requirements || {};
  if (requirements.minLevel !== undefined) {
    assert(Number.isInteger(requirements.minLevel) && requirements.minLevel >= 0, 'INVALID_DEFINITION', 'minLevel must be a non-negative integer');
  }
  if (requirements.maxLevel !== undefined) {
    assert(Number.isInteger(requirements.maxLevel) && requirements.maxLevel >= 0, 'INVALID_DEFINITION', 'maxLevel must be a non-negative integer');
  }
  if (requirements.minLevel !== undefined && requirements.maxLevel !== undefined) {
    assert(requirements.minLevel <= requirements.maxLevel, 'INVALID_DEFINITION', 'minLevel cannot exceed maxLevel');
  }

  for (const key of ['classes', 'nations', 'prerequisites']) {
    if (requirements[key] !== undefined) {
      assert(Array.isArray(requirements[key]), 'INVALID_DEFINITION', `${key} must be an array`);
      assert(requirements[key].every(isOpaqueId), 'INVALID_DEFINITION', `${key} entries must be opaque ids`);
    }
  }

  const objectives = input.objectives || [];
  assert(Array.isArray(objectives), 'INVALID_DEFINITION', 'objectives must be an array');
  const objectiveIds = new Set();
  for (const objective of objectives) {
    assert(objective && typeof objective === 'object', 'INVALID_DEFINITION', 'objective must be an object');
    assert(isOpaqueId(objective.id), 'INVALID_DEFINITION', 'objective id is required');
    assert(!objectiveIds.has(String(objective.id)), 'INVALID_DEFINITION', 'objective ids must be unique');
    objectiveIds.add(String(objective.id));
    assert(typeof objective.eventType === 'string' && objective.eventType.length > 0, 'INVALID_DEFINITION', 'objective eventType is required');
    assert(Number.isInteger(objective.requiredCount) && objective.requiredCount > 0, 'INVALID_DEFINITION', 'objective requiredCount must be a positive integer');
    if (objective.targetId !== undefined) assert(isOpaqueId(objective.targetId), 'INVALID_DEFINITION', 'objective targetId must be an opaque id');
  }

  const rewards = input.rewards || {};
  for (const key of ['xp', 'coins']) {
    if (rewards[key] !== undefined) assert(Number.isSafeInteger(rewards[key]) && rewards[key] >= 0, 'INVALID_DEFINITION', `${key} reward must be a non-negative safe integer`);
  }
  if (rewards.items !== undefined) {
    assert(Array.isArray(rewards.items), 'INVALID_DEFINITION', 'items reward must be an array');
    for (const item of rewards.items) {
      assert(item && isOpaqueId(item.itemId), 'INVALID_DEFINITION', 'reward itemId must be an opaque id');
      assert(Number.isInteger(item.count) && item.count > 0, 'INVALID_DEFINITION', 'reward item count must be a positive integer');
    }
  }

  if (input.dialogue !== undefined) {
    assert(input.dialogue && typeof input.dialogue === 'object' && !Array.isArray(input.dialogue), 'INVALID_DEFINITION', 'dialogue must be an object');
    for (const [state, key] of Object.entries(input.dialogue)) {
      assert(['available', 'active', 'ready', 'completed', 'ineligible'].includes(state), 'INVALID_DEFINITION', `unsupported dialogue state: ${state}`);
      assert(typeof key === 'string' && key.length > 0, 'INVALID_DEFINITION', `dialogue key for ${state} must be a string`);
    }
  }

  return Object.freeze({
    ...input,
    requirements: Object.freeze({ ...requirements }),
    objectives: Object.freeze(objectives.map((objective) => Object.freeze({ ...objective }))),
    rewards: Object.freeze({
      xp: rewards.xp || 0,
      coins: rewards.coins || 0,
      items: Object.freeze((rewards.items || []).map((item) => Object.freeze({ ...item })))
    }),
    dialogue: Object.freeze({ ...(input.dialogue || {}) })
  });
}

function makeInitialState(characterId, questId) {
  return {
    characterId,
    questId,
    status: QuestStatus.NOT_STARTED,
    run: 0,
    completionCount: 0,
    objectiveProgress: {},
    revision: 0
  };
}

function cloneState(state) {
  return {
    ...state,
    objectiveProgress: { ...(state.objectiveProgress || {}) }
  };
}

module.exports = {
  QuestStatus,
  ScriptOp,
  validateQuestDefinition,
  makeInitialState,
  cloneState,
  isOpaqueId
};
