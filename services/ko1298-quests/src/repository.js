'use strict';

const { makeInitialState, cloneState } = require('./model');

class QuestStateRepository {
  async get(_characterId, _questId) {
    throw new Error('QuestStateRepository.get() must be implemented');
  }

  async mutate(_characterId, _questId, _mutator) {
    throw new Error('QuestStateRepository.mutate() must be implemented atomically');
  }
}

class InMemoryQuestStateRepository extends QuestStateRepository {
  constructor() {
    super();
    this.states = new Map();
    this.queues = new Map();
  }

  _key(characterId, questId) {
    return `${String(characterId)}\u0000${String(questId)}`;
  }

  async get(characterId, questId) {
    const key = this._key(characterId, questId);
    const state = this.states.get(key) || makeInitialState(characterId, questId);
    return cloneState(state);
  }

  async mutate(characterId, questId, mutator) {
    const key = this._key(characterId, questId);
    const previous = this.queues.get(key) || Promise.resolve();
    const task = previous.then(async () => {
      const current = cloneState(this.states.get(key) || makeInitialState(characterId, questId));
      const candidate = await mutator(current);
      const next = cloneState(candidate || current);
      next.revision = current.revision + 1;
      this.states.set(key, next);
      return cloneState(next);
    });
    this.queues.set(key, task.catch(() => undefined));
    return task;
  }
}

module.exports = { QuestStateRepository, InMemoryQuestStateRepository };
