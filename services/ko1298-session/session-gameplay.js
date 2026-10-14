'use strict';

const { GAME } = require('./protocol');
const { SESSION_STATES, OWNER } = require('./contracts');
const { SessionError, ERROR_CATEGORY } = require('./errors');
const { validateNpcRequestPacket, clientPacketsFrom, malformedPacket } = require('./session-helpers');
function install(GameSession) {
  GameSession.prototype._handleWorldPacket = async function(packet) {
    if (packet[0] === GAME.REQUEST_NPC_IN) {
      validateNpcRequestPacket(packet);
      if (this.npcRoutesRequestNpcIn && this.npcRouter) return this._handleNpcPacket(packet);
    }
    if (!this.worldSession || typeof this.worldSession.handleClientPacket !== 'function') return [];
    try {
      const outcome = await this.worldSession.handleClientPacket(this.socketId, packet);
      await this._applyWorldOutcome(outcome);
      this._emitWorldBroadcast(outcome);
      return clientPacketsFrom(outcome);
    } catch (error) {
      throw new SessionError('WORLD_HANDLER_FAILED', 'WS14 world handler failed', {
        category: ERROR_CATEGORY.DOWNSTREAM,
        fatal: true,
        details: { owner: OWNER.WS14, opcode: packet[0] },
        cause: error,
      });
    }
  };

  GameSession.prototype._handleMovementPacket = async function(packet) {
    if (!this.movementSession) {
      this.logger('downstream_unavailable', this._packetMeta(packet, { owner: OWNER.WS15 }));
      return [];
    }
    if (packet[0] === GAME.MOVE && packet.length !== 10) {
      throw malformedPacket(new Error('WIZ_MOVE requires exactly 9 bytes after opcode'), packet[0], packet.length, 'game');
    }
    if (packet[0] === GAME.ROTATE && packet.length !== 3) {
      throw malformedPacket(new Error('WIZ_ROTATE requires exactly 2 bytes after opcode'), packet[0], packet.length, 'game');
    }
    try {
      const outcome = packet[0] === GAME.MOVE
        ? await this.movementSession.handleMovePacket(this.sessionId, packet.subarray(1))
        : await this.movementSession.handleRotatePacket(this.sessionId, packet.subarray(1));
      this._emitGameplayOutcome(OWNER.WS15, outcome);
      return clientPacketsFrom(outcome);
    } catch (error) {
      this.logger('downstream_rejected', this._packetMeta(packet, { owner: OWNER.WS15, downstreamCode: error?.code || 'ERROR' }));
      return [];
    }
  };

  GameSession.prototype._handleNpcPacket = async function(packet) {
    if (packet[0] === GAME.NPC_EVENT && packet.length !== 3) {
      throw malformedPacket(new Error('WIZ_NPC_EVENT must contain runtime npc id u16'), packet[0], packet.length, 'game');
    }
    if (packet[0] === GAME.TARGET_HP && packet.length !== 4) {
      throw malformedPacket(new Error('WIZ_TARGET_HP request must contain target id u16 and immediate u8'), packet[0], packet.length, 'game');
    }
    if (packet[0] === GAME.REQUEST_NPC_IN) validateNpcRequestPacket(packet);
    if (!this.npcRouter || typeof this.npcRouter.route !== 'function') {
      this.logger('downstream_unavailable', this._packetMeta(packet, { owner: OWNER.WS16 }));
      return [];
    }
    try {
      const outcome = await this.npcRouter.route(Buffer.from(packet), this.actorContext());
      this._emitGameplayOutcome(OWNER.WS16, outcome);
      return clientPacketsFrom(outcome);
    } catch (error) {
      this.logger('downstream_rejected', this._packetMeta(packet, { owner: OWNER.WS16, downstreamCode: error?.code || 'ERROR' }));
      return [];
    }
  };

  GameSession.prototype._applyWorldOutcome = async function(outcome) {
    const snapshot = outcome?.snapshot || null;
    if (snapshot) {
      if (Number.isInteger(snapshot.zoneId)) this.state.zoneId = snapshot.zoneId;
      if (Number.isInteger(snapshot.socketId)) this.state.entityId = snapshot.entityId ?? snapshot.socketId;
      else if (Number.isInteger(snapshot.entityId)) this.state.entityId = snapshot.entityId;
      if ([snapshot.x, snapshot.y, snapshot.z].every(Number.isFinite)) {
        this.state.position = { x: snapshot.x, y: snapshot.y, z: snapshot.z };
      }
    }

    if (outcome?.state === 'WORLD_READY') {
      if (this.state.phase !== SESSION_STATES.WORLD_READY) this._transition(SESSION_STATES.WORLD_READY, 'WS14 WORLD_READY');
      await this._registerMovementIfNeeded();
      return;
    }

    if (this.state.phase === SESSION_STATES.WORLD_READY && typeof outcome?.state === 'string' && outcome.state !== 'WORLD_READY') {
      await this._resetMovementForWorldTransition(outcome.state);
      this._transition(SESSION_STATES.WORLD_LOADING, `WS14 ${outcome.state}`);
    }
  };

  GameSession.prototype._resetMovementForWorldTransition = async function(worldState) {
    if (!this.movementRegistered || !this.movementSession) return;
    const actor = this.actorContext();
    try {
      if (typeof this.movementSession.teleport === 'function' && Number.isInteger(actor.zoneId) && actor.position) {
        await this.movementSession.teleport(this.sessionId, {
          zoneId: actor.zoneId,
          position: actor.position,
          headingRaw: this.state.headingRaw,
          reason: `WS14:${worldState}`,
        });
        return;
      }
      if (typeof this.movementSession.disconnect === 'function') await this.movementSession.disconnect(this.sessionId);
      this.movementRegistered = false;
    } catch (error) {
      throw new SessionError('MOVEMENT_WORLD_TRANSITION_FAILED', 'WS15 movement baseline reset failed during world transition', {
        category: ERROR_CATEGORY.DOWNSTREAM,
        fatal: true,
        details: { owner: OWNER.WS15, worldState },
        cause: error,
      });
    }
  };

  GameSession.prototype._registerMovementIfNeeded = async function() {
    if (this.movementRegistered || !this.movementSession || typeof this.movementSession.registerSession !== 'function') return;
    const actor = this.actorContext();
    if (!Number.isInteger(actor.entityId) || !Number.isInteger(actor.zoneId) || !actor.position) {
      throw new SessionError('MOVEMENT_CONTEXT_INCOMPLETE', 'WS15 registration requires verified entity/zone/position context', {
        category: ERROR_CATEGORY.DOWNSTREAM,
        fatal: true,
        details: { entityId: actor.entityId, zoneId: actor.zoneId },
      });
    }
    try {
      await this.movementSession.registerSession({
        sessionId: this.sessionId,
        entityId: actor.entityId,
        zoneId: actor.zoneId,
        position: actor.position,
        headingRaw: this.state.headingRaw,
      });
      this.movementRegistered = true;
    } catch (error) {
      throw new SessionError('MOVEMENT_REGISTER_FAILED', 'WS15 movement registration failed', {
        category: ERROR_CATEGORY.DOWNSTREAM,
        fatal: true,
        details: { owner: OWNER.WS15 },
        cause: error,
      });
    }
  };

  GameSession.prototype._emitWorldBroadcast = function(outcome) {
    for (const packet of outcome?.broadcastPackets || []) {
      this.onWorldBroadcast({ packet: Buffer.from(packet), snapshot: outcome.snapshot || null, actor: this.actorContext() });
    }
  };

  GameSession.prototype._emitGameplayOutcome = function(owner, outcome) {
    if (!outcome) return;
    const packets = [];
    if (Buffer.isBuffer(outcome.packet)) packets.push({ packet: outcome.packet, recipients: outcome.recipients || [] });
    for (const item of outcome.broadcastPackets || []) {
      if (Buffer.isBuffer(item)) packets.push({ packet: item, recipients: outcome.recipients || [] });
      else if (item?.packet) packets.push({ packet: item.packet, recipients: item.recipients || outcome.recipients || [] });
    }
    for (const item of packets) {
      this.onGameplayBroadcast({
        owner,
        packet: Buffer.from(item.packet),
        recipients: Array.isArray(item.recipients) ? [...item.recipients] : [],
        actor: this.actorContext(),
      });
    }
  };

}

module.exports = { install };
