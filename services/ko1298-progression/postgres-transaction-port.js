'use strict';

class PersistentProgressionTransactionPort {
  constructor({ progressionRepository, receiptRepository }) {
    if (!progressionRepository || typeof progressionRepository.load !== 'function' || typeof progressionRepository.save !== 'function') {
      throw new TypeError('PgWs27ProgressionRepository-compatible repository is required');
    }
    if (!receiptRepository || typeof receiptRepository.runOnce !== 'function') {
      throw new TypeError('PgOperationReceiptRepository-compatible repository is required');
    }
    this.progressionRepository = progressionRepository;
    this.receiptRepository = receiptRepository;
  }

  async applyOnce({ operationId, characterId, metadata = {}, mutate }) {
    if (typeof operationId !== 'string' || !operationId) throw new TypeError('operationId is required');
    if (characterId === null || characterId === undefined) throw new TypeError('characterId is required');
    if (typeof mutate !== 'function') throw new TypeError('mutate is required');
    return this.receiptRepository.runOnce({
      operationId,
      kind: 'P2_07_COMBAT_PROGRESSION',
      characterId,
      metadata,
    }, async (tx) => {
      const before = await this.progressionRepository.load(characterId, { tx });
      if (!before) throw new Error('progression state not found');
      const result = await mutate(Object.freeze({ ...before }));
      if (!result || !result.state) throw new TypeError('mutate must return {state,...}');
      const expectedVersion = Number(before.version);
      const saved = await this.progressionRepository.save(characterId, result.state, { expectedVersion, tx });
      return Object.freeze({
        ...result,
        persistence: Object.freeze({
          operationId,
          expectedVersion,
          version: Number(saved.version),
        }),
      });
    });
  }
}

module.exports = { PersistentProgressionTransactionPort };
