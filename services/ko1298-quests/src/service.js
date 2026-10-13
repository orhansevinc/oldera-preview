'use strict';

const { QuestError } = require('./errors');
const { QuestStatus, validateQuestDefinition } = require('./model');

class QuestService {
  constructor({ definitions, repository, rewardGateway }) {
    this.repository = repository;
    this.rewardGateway = rewardGateway;
    this.definitions = new Map();
    for (const raw of definitions || []) {
      const definition = validateQuestDefinition(raw);
      const key = String(definition.id);
      if (this.definitions.has(key)) throw new QuestError('DUPLICATE_QUEST', `Duplicate quest id: ${key}`);
      this.definitions.set(key, definition);
    }
  }

  definition(questId) {
    const definition = this.definitions.get(String(questId));
    if (!definition) throw new QuestError('QUEST_NOT_FOUND', `Unknown quest: ${String(questId)}`);
    return definition;
  }

  async eligibility(characterId, questId, player = {}) {
    const definition = this.definition(questId);
    const requirements = definition.requirements;
    const reasons = [];

    if (requirements.minLevel !== undefined && (!Number.isInteger(player.level) || player.level < requirements.minLevel)) {
      reasons.push({ code: 'MIN_LEVEL', expected: requirements.minLevel, actual: player.level });
    }
    if (requirements.maxLevel !== undefined && (!Number.isInteger(player.level) || player.level > requirements.maxLevel)) {
      reasons.push({ code: 'MAX_LEVEL', expected: requirements.maxLevel, actual: player.level });
    }
    if (requirements.classes && requirements.classes.length > 0 && !requirements.classes.map(String).includes(String(player.classId))) {
      reasons.push({ code: 'CLASS', allowed: requirements.classes, actual: player.classId });
    }
    if (requirements.nations && requirements.nations.length > 0 && !requirements.nations.map(String).includes(String(player.nationId))) {
      reasons.push({ code: 'NATION', allowed: requirements.nations, actual: player.nationId });
    }

    for (const prerequisiteId of requirements.prerequisites || []) {
      const prerequisite = await this.repository.get(characterId, prerequisiteId);
      if (prerequisite.completionCount < 1) reasons.push({ code: 'PREREQUISITE', questId: prerequisiteId });
    }

    const state = await this.repository.get(characterId, questId);
    if (state.status === QuestStatus.ACTIVE) reasons.push({ code: 'ALREADY_ACTIVE' });
    if (!definition.repeatable && state.completionCount > 0) reasons.push({ code: 'ALREADY_COMPLETED' });

    return { eligible: reasons.length === 0, reasons };
  }

  async accept(characterId, questId, player = {}) {
    const definition = this.definition(questId);
    const gate = await this.eligibility(characterId, questId, player);
    if (!gate.eligible) throw new QuestError('QUEST_NOT_ELIGIBLE', `Quest ${String(questId)} cannot be accepted`, gate.reasons);

    return this.repository.mutate(characterId, questId, (state) => {
      if (state.status === QuestStatus.ACTIVE) throw new QuestError('QUEST_ALREADY_ACTIVE', `Quest ${String(questId)} is already active`);
      if (!definition.repeatable && state.completionCount > 0) throw new QuestError('QUEST_ALREADY_COMPLETED', `Quest ${String(questId)} is not repeatable`);
      return {
        ...state,
        status: QuestStatus.ACTIVE,
        run: state.run + 1,
        objectiveProgress: {}
      };
    });
  }

  async recordProgress(characterId, questId, event) {
    const definition = this.definition(questId);
    if (!event || typeof event.type !== 'string' || event.type.length === 0) {
      throw new QuestError('INVALID_PROGRESS_EVENT', 'Progress event.type is required');
    }
    const amount = event.count === undefined ? 1 : event.count;
    if (!Number.isInteger(amount) || amount <= 0) throw new QuestError('INVALID_PROGRESS_EVENT', 'Progress event count must be a positive integer');

    return this.repository.mutate(characterId, questId, (state) => {
      if (state.status !== QuestStatus.ACTIVE) throw new QuestError('QUEST_NOT_ACTIVE', `Quest ${String(questId)} is not active`);
      const next = { ...state, objectiveProgress: { ...state.objectiveProgress } };
      for (const objective of definition.objectives) {
        if (objective.eventType !== event.type) continue;
        if (objective.targetId !== undefined && String(objective.targetId) !== String(event.targetId)) continue;
        const key = String(objective.id);
        const current = next.objectiveProgress[key] || 0;
        next.objectiveProgress[key] = Math.min(objective.requiredCount, current + amount);
      }
      return next;
    });
  }

  _isReady(definition, state) {
    return definition.objectives.every((objective) => {
      const current = state.objectiveProgress[String(objective.id)] || 0;
      return current >= objective.requiredCount;
    });
  }

  async complete(characterId, questId) {
    const definition = this.definition(questId);
    return this.repository.mutate(characterId, questId, async (state) => {
      if (state.status !== QuestStatus.ACTIVE) throw new QuestError('QUEST_NOT_ACTIVE', `Quest ${String(questId)} is not active`);
      if (!this._isReady(definition, state)) throw new QuestError('QUEST_NOT_READY', `Quest ${String(questId)} objectives are incomplete`);

      const idempotencyKey = `quest:${String(characterId)}:${String(questId)}:run:${state.run}`;
      await this.rewardGateway.grantBundle({
        idempotencyKey,
        characterId,
        questId: definition.id,
        rewards: definition.rewards
      });

      return {
        ...state,
        status: QuestStatus.COMPLETED,
        completionCount: state.completionCount + 1
      };
    });
  }

  async abandon(characterId, questId) {
    const definition = this.definition(questId);
    if (!definition.allowAbandon) throw new QuestError('ABANDON_NOT_ALLOWED', `Quest ${String(questId)} is not configured as abandonable`);
    return this.repository.mutate(characterId, questId, (state) => {
      if (state.status !== QuestStatus.ACTIVE) throw new QuestError('QUEST_NOT_ACTIVE', `Quest ${String(questId)} is not active`);
      return { ...state, status: QuestStatus.NOT_STARTED, objectiveProgress: {} };
    });
  }

  async view(characterId, questId, player = {}) {
    const definition = this.definition(questId);
    const state = await this.repository.get(characterId, questId);
    let dialogueState;
    let eligibility = null;

    if (state.status === QuestStatus.ACTIVE) {
      dialogueState = this._isReady(definition, state) ? 'ready' : 'active';
    } else if (state.completionCount > 0 && !definition.repeatable) {
      dialogueState = 'completed';
    } else {
      eligibility = await this.eligibility(characterId, questId, player);
      dialogueState = eligibility.eligible ? 'available' : 'ineligible';
    }

    return {
      definition,
      state,
      ready: state.status === QuestStatus.ACTIVE && this._isReady(definition, state),
      dialogueState,
      dialogueKey: definition.dialogue[dialogueState] || null,
      eligibility
    };
  }
}

module.exports = { QuestService };
