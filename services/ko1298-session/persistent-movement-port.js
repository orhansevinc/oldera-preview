'use strict';

function isMovementPolicyRejection(error) {
  return error?.name === 'MovementRejectedError' && typeof error?.code === 'string';
}

function nonFatalMovementRejection(error) {
  return Object.freeze({
    accepted: false,
    rejected: true,
    disconnect: false,
    rejection: Object.freeze({
      category: 'MOVEMENT_POLICY',
      code: error.code,
      details: error.details && typeof error.details === 'object'
        ? Object.freeze({ ...error.details })
        : Object.freeze({}),
    }),
  });
}

class PersistentMovementPort {
  constructor({ movement, repository, worldSession }) {
    if (!movement || !repository || !worldSession) throw new TypeError('movement, repository and worldSession are required');
    this.movement = movement;
    this.repository = repository;
    this.worldSession = worldSession;
  }

  registerSession(input) { return this.movement.registerSession(input); }
  restoreSession(input) { return this.movement.restoreSession(input); }
  getState(sessionId) { return this.movement.getState(sessionId); }
  getPositionSnapshot(sessionId) { return this.movement.getPositionSnapshot(sessionId); }
  getEntityPositionSnapshot(entityId) { return this.movement.getEntityPositionSnapshot(entityId); }
  hasSession(sessionId) { return this.movement.hasSession(sessionId); }
  resetMovementBaseline(sessionId, input) { return this.movement.teleport(sessionId, input); }
  teleport(sessionId, input) { return this.resetMovementBaseline(sessionId, input); }
  disconnect(sessionId) { return this.movement.disconnect(sessionId); }
  cleanup(sessionId) { return this.disconnect(sessionId); }

  async handleMovePacket(sessionId, payload, context = {}) {
    const previous = this.movement.getState(sessionId);
    let outcome;
    try {
      outcome = await this.movement.handleMovePacket(sessionId, payload, context);
    } catch (error) {
      if (isMovementPolicyRejection(error)) return nonFatalMovementRejection(error);
      throw error;
    }
    if (!outcome?.accepted || outcome.deduplicated || !outcome.state) return outcome;

    const fallbackSocketId = Number(String(sessionId).split(':').pop());
    const world = this.worldSession.getSession(outcome.state.entityId)
      || (Number.isInteger(fallbackSocketId) ? this.worldSession.getSession(fallbackSocketId) : null);
    if (!world?.accountId || !world?.characterId) {
      this.#rollback(sessionId, previous);
      const error = new Error('authoritative world identity is unavailable for movement persistence');
      error.code = 'MOVEMENT_WORLD_IDENTITY_MISSING';
      throw error;
    }

    try {
      await this.repository.saveWorldPosition({
        accountId: world.accountId,
        characterId: world.characterId,
        zoneId: outcome.state.zoneId,
        x: outcome.state.position.x,
        y: outcome.state.position.y,
        z: outcome.state.position.z,
      });
    } catch (error) {
      this.#rollback(sessionId, previous);
      const wrapped = new Error('movement persistence failed; authoritative movement was rolled back', { cause: error });
      wrapped.code = 'MOVEMENT_PERSISTENCE_FAILED';
      throw wrapped;
    }
    return outcome;
  }

  async handleRotatePacket(sessionId, payload, context = {}) {
    try {
      return await this.movement.handleRotatePacket(sessionId, payload, context);
    } catch (error) {
      if (isMovementPolicyRejection(error)) return nonFatalMovementRejection(error);
      throw error;
    }
  }

  getDiagnostics() {
    return this.movement.getDiagnostics();
  }

  #rollback(sessionId, previous) {
    if (!previous) return;
    this.resetMovementBaseline(sessionId, {
      zoneId: previous.zoneId,
      position: previous.position,
      headingRaw: previous.headingRaw,
      reason: 'PERSISTENCE_ROLLBACK',
    });
  }
}

module.exports = { PersistentMovementPort, isMovementPolicyRejection, nonFatalMovementRejection };