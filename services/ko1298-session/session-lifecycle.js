'use strict';

const { GAME } = require('./protocol');
const { SESSION_STATES, canTransition } = require('./contracts');
const { SessionError, ERROR_CATEGORY } = require('./errors');

function install(GameSession) {
  GameSession.prototype._wrongStateResponse = function(opcode) {
    switch (opcode) {
      case GAME.NEW_CHAR: return [Buffer.from([GAME.NEW_CHAR, 1])];
      case GAME.SEL_CHAR: return [Buffer.from([GAME.SEL_CHAR, 0])];
      case GAME.SEL_NATION: return [Buffer.from([GAME.SEL_NATION, 0])];
      case GAME.ALLCHAR_INFO_REQ: return [Buffer.from([GAME.ALLCHAR_INFO_REQ, 0])];
      default: return [];
    }
  };

  GameSession.prototype._transition = function(next, reason) {
    const previous = this.state.phase;
    if (previous === next) return;
    if (!canTransition(previous, next)) {
      throw new SessionError('INVALID_STATE_TRANSITION', `invalid session transition ${previous} -> ${next}`, {
        category: ERROR_CATEGORY.WRONG_STATE,
        fatal: true,
        details: { previous, next },
      });
    }
    this.state.phase = next;
    this.onStateChange({ previous, next, reason, actor: this.actorContext() });
    this.logger('state_transition', { socketId: this.socketId, previous, next, reason });
  };

  GameSession.prototype._packetMeta = function(packet, extra = {}) {
    return {
      socketId: this.socketId,
      state: this.state.phase,
      opcode: packet[0],
      length: packet.length,
      ...extra,
    };
  };

  GameSession.prototype._disconnectOnce = async function({ reason, useGrace }) {
    if (this.state.phase === SESSION_STATES.CLOSED) return;
    if (this.state.phase !== SESSION_STATES.DISCONNECTING) this._transition(SESSION_STATES.DISCONNECTING, reason);
    const actor = this.actorContext();
    const cleanupSteps = [
      ['WS15', async () => {
        if (this.movementSession && typeof this.movementSession.disconnect === 'function') await this.movementSession.disconnect(this.sessionId);
        else if (this.movementSession && typeof this.movementSession.cleanup === 'function') await this.movementSession.cleanup(actor, { reason });
        this.movementRegistered = false;
      }],
      ['WS16', async () => { if (this.npcRouter && typeof this.npcRouter.cleanup === 'function') await this.npcRouter.cleanup(actor, { reason }); }],
      ['WS19', async () => { if (this.combatAdapter && typeof this.combatAdapter.cleanup === 'function') await this.combatAdapter.cleanup(actor, { reason }); }],
      ['WS17', async () => { if (this.inventoryAdapter && typeof this.inventoryAdapter.cleanup === 'function') await this.inventoryAdapter.cleanup(actor, { reason }); }],
      ['WS22', async () => { if (this.economyAdapter && typeof this.economyAdapter.cleanup === 'function') await this.economyAdapter.cleanup(actor, { reason }); }],
      ['WS25/26/27', async () => { if (this.domainEventAdapter && typeof this.domainEventAdapter.cleanup === 'function') await this.domainEventAdapter.cleanup(actor, { reason }); }],
      ['WS14', async () => {
        if (this.worldSession && typeof this.worldSession.disconnect === 'function') await this.worldSession.disconnect(this.socketId, reason);
        else if (this.worldSession && typeof this.worldSession.cleanup === 'function') await this.worldSession.cleanup(actor, { reason });
      }],
      ['WS45', async () => {
        if (this.ownership && typeof this.ownership.disconnect === 'function') {
          await this.ownership.disconnect(this.sessionId, { useGrace: Boolean(useGrace), reason });
        }
      }],
    ];

    for (const [owner, cleanup] of cleanupSteps) {
      try {
        await cleanup();
      } catch (error) {
        this.logger('cleanup_error', { owner, socketId: this.socketId, code: error?.code || 'ERROR' });
      }
    }
    this._transition(SESSION_STATES.CLOSED, reason);
  };
}

module.exports = { install };
