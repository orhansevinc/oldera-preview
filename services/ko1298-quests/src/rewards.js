'use strict';

class RewardGateway {
  async grantBundle(_request) {
    throw new Error('RewardGateway.grantBundle() must be implemented and idempotent by idempotencyKey');
  }
}

class InMemoryRewardGateway extends RewardGateway {
  constructor() {
    super();
    this.grants = new Map();
  }

  async grantBundle(request) {
    if (this.grants.has(request.idempotencyKey)) return this.grants.get(request.idempotencyKey);
    const result = Object.freeze({
      idempotencyKey: request.idempotencyKey,
      characterId: request.characterId,
      questId: request.questId,
      rewards: request.rewards
    });
    this.grants.set(request.idempotencyKey, result);
    return result;
  }
}

module.exports = { RewardGateway, InMemoryRewardGateway };
