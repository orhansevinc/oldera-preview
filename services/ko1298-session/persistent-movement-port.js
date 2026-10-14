'use strict';

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
  teleport(sessionId, input) { return this.movement.teleport(sessionId, input); }
  disconnect(sessionId) { return this.movement.disconnect(sessionId); }
  cleanup(sessionId) { return this.disconnect(sessionId); }

  async handleMovePacket(sessionId, payload, context = {}) {
    const previous = this.movement.getState(sessionId);
    const outcome = await this.movement.handleMovePacket(sessionId, payload, context);
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

  handleRotatePacket(sessionId, payload, context = {}) {
    return this.movement.handleRotatePacket(sessionId, payload, context);
  }

  getDiagnostics() {
    return this.movement.getDiagnostics();
  }

  #rollback(sessionId, previous) {
    if (!previous) return;
    this.movement.teleport(sessionId, {
      zoneId: previous.zoneId,
      position: previous.position,
      headingRaw: previous.headingRaw,
      reason: 'PERSISTENCE_ROLLBACK',
    });
  }
}

module.exports = { PersistentMovementPort };
