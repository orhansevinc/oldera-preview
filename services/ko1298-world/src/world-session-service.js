'use strict';

const {
  ZONE,
  MORADON_SPAWN,
  WORLD_STATE,
  USER_INOUT,
  GAMESTART_PHASE,
  ZONE_CHANGE_PHASE,
  OPCODE,
  TRANSITION_REASON,
  WORLD_ENTRY_REASON,
  BOOTSTRAP_STAGE,
} = require('./constants');
const {
  buildCharacterSelectSuccess,
  buildGameStartAck,
  buildZoneChangeTeleport,
  buildZoneChangeLoadedAck,
  buildMoradonZoneAbility,
  buildMyInfo,
  buildUserInOut,
  buildRegionUserIds,
  buildRegionNpcIds,
  buildSurroundingUsers,
  buildSurroundingNpcs,
  parseEntityIdRequest,
  parseGameStart,
  parseZoneChangePhase,
} = require('./protocol');
const { buildZoneAbility } = require('./zone-ability');
const {
  createVerified1298ZoneRegistry,
  normalizePosition,
} = require('./zone-registry');

const TRANSITION_REASONS = new Set(Object.values(TRANSITION_REASON));

class WorldSessionService {
  constructor({
    repository,
    victoryNation = 0,
    moradonSpawn = MORADON_SPAWN,
    zoneRegistry,
    zonePolicy,
    lifecycle,
    regionPort,
    movementPort,
    mobPort,
    bootstrapPort,
    auditSink,
    auditLimit = 256,
  } = {}) {
    if (!repository) throw new Error('repository is required');
    if (!Number.isInteger(auditLimit) || auditLimit < 1) throw new Error('auditLimit must be a positive integer');
    this.repository = repository;
    this.victoryNation = victoryNation;
    this.moradonSpawn = { ...moradonSpawn };
    this.zoneRegistry = zoneRegistry || createVerified1298ZoneRegistry({ moradonSpawn: this.moradonSpawn });
    this.zonePolicy = zonePolicy || null;
    this.lifecycle = lifecycle || {};
    this.regionPort = regionPort || {};
    this.movementPort = movementPort || {};
    this.mobPort = mobPort || {};
    this.bootstrapPort = bootstrapPort || {};
    this.auditSink = typeof auditSink === 'function' ? auditSink : null;
    this.auditLimit = auditLimit;
    this.sessions = new Map();
    this.closedAudit = new Map();
    this.nextTransitionId = 1;
    this.nextAuditSequence = 1;
  }

  async beginSelectedCharacter({ accountId, characterId, socketId }) {
    return this.beginWorldEntry({
      accountId,
      characterId,
      socketId,
      zoneId: ZONE.MORADON,
      position: this.moradonSpawn,
      reason: WORLD_ENTRY_REASON.INITIAL,
    });
  }

  async beginWorldEntry({
    accountId,
    characterId,
    socketId,
    zoneId,
    position,
    reason = WORLD_ENTRY_REASON.INITIAL,
  }) {
    validateSessionIdentity({ accountId, characterId, socketId });
    if (this.sessions.has(socketId)) throw new Error(`world session already exists for socket ${socketId}`);

    const character = await this.repository.getCharacterForWorld(accountId, characterId);
    if (!character) throw new Error('selected character was not found for account');
    if (character.accountId !== accountId || character.characterId !== characterId) {
      throw new Error('repository returned a character outside the selected account boundary');
    }

    const zone = this.zoneRegistry.requireProductionReady(zoneId);
    const resolvedPosition = normalizePosition(position || zone.spawn);
    this.#authorizeZoneEntry({ character, sourceZone: null, targetZone: zone, reason });

    const session = {
      accountId,
      characterId,
      socketId,
      zoneId: zone.zoneId,
      x: resolvedPosition.x,
      z: resolvedPosition.z,
      y: resolvedPosition.y,
      state: WORLD_STATE.WAIT_GAMESTART_LOADING,
      character,
      nearbyUsers: new Map(),
      nearbyNpcs: new Map(),
      nearbyMobs: new Map(),
      regionSubscribed: false,
      movementRegistered: false,
      transition: null,
      auditTrail: [],
      entryReason: reason,
    };
    this.sessions.set(socketId, session);
    this.#audit(session, 'WORLD_ENTRY_CREATED', { zoneId: zone.zoneId, reason });

    return result(session, [buildCharacterSelectSuccess({
      zoneId: session.zoneId,
      x: session.x,
      z: session.z,
      y: session.y,
      victoryNation: this.victoryNation,
    })], [], { capabilities: capabilitiesFor(session) });
  }

  async restoreAuthoritativeSession({ accountId, characterId, socketId }) {
    if (typeof this.repository.getAuthoritativeWorldState !== 'function') {
      throw new Error('repository.getAuthoritativeWorldState is required for reconnect restore');
    }
    const restored = await this.repository.getAuthoritativeWorldState(accountId, characterId);
    if (!restored) throw new Error('authoritative world state was not found for reconnect');
    if (restored.accountId && restored.accountId !== accountId) throw new Error('authoritative world state account mismatch');
    if (restored.characterId && restored.characterId !== characterId) throw new Error('authoritative world state character mismatch');
    return this.beginWorldEntry({
      accountId,
      characterId,
      socketId,
      zoneId: restored.zoneId,
      position: { x: restored.x, z: restored.z, y: restored.y },
      reason: WORLD_ENTRY_REASON.RECONNECT,
    });
  }

  async handleClientPacket(socketId, packet) {
    const session = this.sessions.get(socketId);
    if (!session) throw new Error(`world session not found for socket ${socketId}`);
    const p = Buffer.from(packet);
    if (p.length === 0) throw new Error('empty packet');

    if (p[0] === OPCODE.GAMESTART) return this.#handleGameStart(session, p);
    if (p[0] === OPCODE.ZONE_CHANGE) return this.#handleZoneChange(session, p);
    if (p[0] === OPCODE.REQUEST_USER_IN) return this.#handleUserInfoRequest(session, p);
    if (p[0] === OPCODE.REQUEST_NPC_IN) return this.#handleNpcInfoRequest(session, p);
    throw new Error(`opcode 0x${p[0].toString(16).padStart(2, '0')} is outside WS14 scope`);
  }

  requestZoneChange({
    socketId,
    targetZoneId,
    position,
    reason = TRANSITION_REASON.TELEPORT,
    subZone = 0,
  }) {
    const session = this.#requireSession(socketId);
    if (session.transition) throw new Error('zone change already in progress');
    if (session.state !== WORLD_STATE.WORLD_READY) {
      throw new Error(`zone change requires WORLD_READY, got ${session.state}`);
    }
    validateTransitionReason(reason);

    const sourceZone = this.zoneRegistry.requireKnown(session.zoneId);
    const targetZone = this.zoneRegistry.requireProductionReady(targetZoneId);
    const targetPosition = normalizePosition(position || targetZone.spawn);
    const transition = {
      id: this.nextTransitionId++,
      reason,
      subZone,
      state: null,
      source: freezeLocation(session, sourceZone),
      target: Object.freeze({
        zoneId: targetZone.zoneId,
        x: targetPosition.x,
        z: targetPosition.z,
        y: targetPosition.y,
        mapRef: targetZone.mapRef,
      }),
      sourceMembershipExisted: this.zoneRegistry.runtime(sourceZone.zoneId).has(socketId),
      sourceRegionSubscribed: session.regionSubscribed,
      sourceNearbyUsers: new Map(session.nearbyUsers),
      sourceNearbyNpcs: new Map(session.nearbyNpcs),
      sourceNearbyMobs: new Map(session.nearbyMobs),
      targetMembershipAdded: false,
      targetRegionSubscribed: false,
      movementTeleported: false,
      teleportSent: false,
    };
    session.transition = transition;

    try {
      this.#setTransitionState(session, WORLD_STATE.REQUESTED);
      this.#authorizeZoneEntry({ character: session.character, sourceZone, targetZone, reason });
      this.#setTransitionState(session, WORLD_STATE.AUTHORIZED);

      const stale = staleRegionDescriptor(session, transition);
      callSync(this.lifecycle.onClientRegionReset, stale, 'lifecycle.onClientRegionReset');
      this.#unsubscribeRegion(session, sourceZone.zoneId, 'ZONE_TRANSITION');
      if (transition.sourceMembershipExisted) this.zoneRegistry.runtime(sourceZone.zoneId).leave(socketId);
      callSync(this.lifecycle.onSourceLeave, {
        session: publicSnapshot(session),
        source: transition.source,
        target: transition.target,
        reason,
      }, 'lifecycle.onSourceLeave');
      this.#setTransitionState(session, WORLD_STATE.LEAVING_SOURCE);
      this.#setTransitionState(session, WORLD_STATE.TELEPORT);

      const teleportPacket = buildZoneChangeTeleport({
        zoneId: targetZone.zoneId,
        x: targetPosition.x,
        z: targetPosition.z,
        y: targetPosition.y,
        subZone,
        victoryNation: this.victoryNation,
      });
      const clientPackets = sourceZone.zoneId === targetZone.zoneId
        ? [teleportPacket]
        : [this.#buildZoneAbilityPacket(targetZone.zoneId), teleportPacket];
      transition.teleportSent = true;
      return result(session, clientPackets, [], {
        zoneBroadcasts: [{
          zoneId: sourceZone.zoneId,
          packet: buildUserInOut(session.character, transition.source, USER_INOUT.OUT),
        }],
        clientEntityCleanup: stale,
        capabilities: capabilitiesFor(session),
        transition: publicTransition(transition),
      });
    } catch (error) {
      const rollbackOutcome = this.#rollbackTransition(session, `REQUEST_FAILED:${error.message}`);
      error.rollbackOutcome = rollbackOutcome;
      throw error;
    }
  }

  beginMoradonZoneChange(socketId, spawn = this.moradonSpawn) {
    return this.requestZoneChange({
      socketId,
      targetZoneId: ZONE.MORADON,
      position: spawn,
      reason: TRANSITION_REASON.TELEPORT,
    });
  }

  planWorldReposition({ socketId, targetZoneId, position, reason = TRANSITION_REASON.RESPAWN }) {
    const session = this.#requireSession(socketId);
    if (session.state !== WORLD_STATE.WORLD_READY || session.transition) {
      throw new Error(`world reposition requires WORLD_READY, got ${session.state}`);
    }
    validateTransitionReason(reason);
    const sourceZone = this.zoneRegistry.requireKnown(session.zoneId);
    const targetZone = this.zoneRegistry.requireProductionReady(targetZoneId);
    const targetPosition = normalizePosition(position || targetZone.spawn);
    this.#authorizeZoneEntry({ character: session.character, sourceZone, targetZone, reason });
    return Object.freeze({
      kind: sourceZone.zoneId === targetZone.zoneId ? 'IN_ZONE_REPOSITION' : 'ZONE_TRANSITION',
      reason,
      source: freezeLocation(session, sourceZone),
      target: Object.freeze({ zoneId: targetZone.zoneId, ...targetPosition, mapRef: targetZone.mapRef }),
    });
  }

  disconnect(socketId, reason = 'DISCONNECT') {
    const session = this.sessions.get(socketId);
    if (!session) return { disconnected: false, socketId };

    const touchedZones = new Set([session.zoneId]);
    if (session.transition) {
      touchedZones.add(session.transition.source.zoneId);
      touchedZones.add(session.transition.target.zoneId);
    }
    for (const zoneId of touchedZones) {
      const definition = this.zoneRegistry.get(zoneId);
      if (definition) this.zoneRegistry.runtime(zoneId).leave(socketId);
    }
    if (session.regionSubscribed) this.#unsubscribeRegion(session, session.zoneId, reason);
    callSync(this.movementPort.disconnect, socketId, 'movementPort.disconnect');
    callSync(this.lifecycle.onDisconnect, {
      session: publicSnapshot(session),
      transition: session.transition ? publicTransition(session.transition) : null,
      reason,
    }, 'lifecycle.onDisconnect');
    this.#audit(session, 'DISCONNECTED', { reason });
    this.closedAudit.set(socketId, session.auditTrail.slice());
    this.sessions.delete(socketId);
    return { disconnected: true, socketId, cleanedZones: [...touchedZones] };
  }

  getSession(socketId) {
    const session = this.sessions.get(socketId);
    return session ? publicSnapshot(session) : null;
  }

  getAuditTrail(socketId) {
    const session = this.sessions.get(socketId);
    if (session) return session.auditTrail.map((event) => ({ ...event }));
    return (this.closedAudit.get(socketId) || []).map((event) => ({ ...event }));
  }

  getCapabilities(socketId) {
    return capabilitiesFor(this.#requireSession(socketId));
  }

  async #handleGameStart(session, packet) {
    const { phase } = parseGameStart(packet);

    if (phase === GAMESTART_PHASE.LOADING) {
      if (session.state !== WORLD_STATE.WAIT_GAMESTART_LOADING) {
        if (session.state === WORLD_STATE.WORLD_READY) return ignoredResult(session);
        throw new Error(`WIZ_GAMESTART loading invalid in state ${session.state}`);
      }

      this.#subscribeRegion(session, session.zoneId, 'WORLD_ENTRY');
      await this.#refreshSurroundings(session);
      session.state = WORLD_STATE.WAIT_GAMESTART_LOADED;
      this.#audit(session, 'WORLD_ENTRY_LOADING', { zoneId: session.zoneId });
      const mobPackets = await this.#buildMobBootstrap(session);
      return result(session, [
        buildMyInfo(session.character, session),
        this.#buildZoneAbilityPacket(session.zoneId),
        buildRegionUserIds([...session.nearbyUsers.values()]),
        buildRegionNpcIds([...session.nearbyNpcs.values()]),
        ...mobPackets,
        buildGameStartAck(),
      ], [], {
        bootstrapStages: [...Object.values(BOOTSTRAP_STAGE)],
        capabilities: capabilitiesFor(session),
      });
    }

    if (session.state !== WORLD_STATE.WAIT_GAMESTART_LOADED) {
      if (session.state === WORLD_STATE.WORLD_READY) return ignoredResult(session);
      throw new Error(`WIZ_GAMESTART loaded invalid in state ${session.state}`);
    }

    this.#registerInitialMovement(session);
    session.state = WORLD_STATE.WORLD_READY;
    this.zoneRegistry.runtime(session.zoneId).enter(runtimeSnapshot(session));
    this.#audit(session, WORLD_STATE.WORLD_READY, { zoneId: session.zoneId, reason: session.entryReason });
    callSync(this.lifecycle.onWorldReady, {
      session: publicSnapshot(session),
      reason: session.entryReason,
    }, 'lifecycle.onWorldReady');
    return result(session, [], [buildUserInOut(session.character, session, USER_INOUT.REGENE)], {
      capabilities: capabilitiesFor(session),
    });
  }

  async #handleZoneChange(session, packet) {
    const { phase } = parseZoneChangePhase(packet);

    if (phase === ZONE_CHANGE_PHASE.LOADING) {
      if (session.state !== WORLD_STATE.TELEPORT || !session.transition) {
        throw new Error(`WIZ_ZONE_CHANGE loading invalid in state ${session.state}`);
      }
      const transition = session.transition;
      try {
        this.#setTransitionState(session, WORLD_STATE.LOADING);
        session.zoneId = transition.target.zoneId;
        session.x = transition.target.x;
        session.z = transition.target.z;
        session.y = transition.target.y;

        this.zoneRegistry.runtime(session.zoneId).enter(runtimeSnapshot(session));
        transition.targetMembershipAdded = true;
        callSync(this.lifecycle.onTargetEnter, {
          session: publicSnapshot(session),
          source: transition.source,
          target: transition.target,
          reason: transition.reason,
        }, 'lifecycle.onTargetEnter');
        this.#subscribeRegion(session, session.zoneId, 'ZONE_TRANSITION');
        transition.targetRegionSubscribed = session.regionSubscribed;
        callSync(this.movementPort.teleport, socketIdFor(session), {
          zoneId: session.zoneId,
          position: { x: session.x, z: session.z, y: session.y },
          headingRaw: session.character.direction ?? 0,
          reason: transition.reason,
        }, 'movementPort.teleport');
        transition.movementTeleported = typeof this.movementPort.teleport === 'function';

        await this.#refreshSurroundings(session);
        const mobPackets = await this.#buildMobBootstrap(session);
        this.#setTransitionState(session, WORLD_STATE.LOADED);
        return result(session, [
          buildRegionUserIds([...session.nearbyUsers.values()]),
          buildRegionNpcIds([...session.nearbyNpcs.values()]),
          ...mobPackets,
          buildZoneChangeLoadedAck(),
        ], [], {
          bootstrapStages: [...Object.values(BOOTSTRAP_STAGE)],
          capabilities: capabilitiesFor(session),
          transition: publicTransition(transition),
        });
      } catch (error) {
        const rollbackOutcome = this.#rollbackTransition(session, `LOAD_FAILED:${error.message}`);
        error.rollbackOutcome = rollbackOutcome;
        throw error;
      }
    }

    if (session.state !== WORLD_STATE.LOADED || !session.transition) {
      throw new Error(`WIZ_ZONE_CHANGE loaded invalid in state ${session.state}`);
    }
    const completed = session.transition;
    session.state = WORLD_STATE.WORLD_READY;
    completed.state = WORLD_STATE.WORLD_READY;
    this.zoneRegistry.runtime(session.zoneId).enter(runtimeSnapshot(session));
    this.#audit(session, WORLD_STATE.WORLD_READY, {
      transitionId: completed.id,
      fromZoneId: completed.source.zoneId,
      toZoneId: completed.target.zoneId,
      reason: completed.reason,
    });
    session.transition = null;
    callSync(this.lifecycle.onWorldReady, {
      session: publicSnapshot(session),
      reason: completed.reason,
      transition: publicTransition(completed),
    }, 'lifecycle.onWorldReady');
    return result(session, [], [buildUserInOut(session.character, session, USER_INOUT.REGENE)], {
      capabilities: capabilitiesFor(session),
      completedTransition: publicTransition(completed),
    });
  }

  #handleUserInfoRequest(session, packet) {
    assertRegionDetailState(session, 'WIZ_REQ_USERIN');
    const ids = parseEntityIdRequest(packet, OPCODE.REQUEST_USER_IN);
    const users = ids.map((id) => session.nearbyUsers.get(id)).filter(Boolean);
    return result(session, [buildSurroundingUsers(users)]);
  }

  #handleNpcInfoRequest(session, packet) {
    assertRegionDetailState(session, 'WIZ_REQ_NPCIN');
    const ids = parseEntityIdRequest(packet, OPCODE.REQUEST_NPC_IN);
    const npcs = ids.map((id) => session.nearbyNpcs.get(id)).filter(Boolean);
    return result(session, [buildSurroundingNpcs(npcs)]);
  }

  async #refreshSurroundings(session) {
    const userPromise = this.repository.getSurroundingUsers({
      zoneId: session.zoneId,
      x: session.x,
      z: session.z,
      excludeSocketId: session.socketId,
    });
    const npcPromise = this.repository.getSurroundingNpcs({
      zoneId: session.zoneId,
      x: session.x,
      z: session.z,
    });
    const mobPromise = typeof this.mobPort.getNearby === 'function'
      ? this.mobPort.getNearby({ zoneId: session.zoneId, x: session.x, z: session.z, excludeSocketId: session.socketId })
      : [];
    const [users, npcs, mobs] = await Promise.all([userPromise, npcPromise, mobPromise]);
    const nearbyUsers = users || [];
    const nearbyNpcs = npcs || [];
    const nearbyMobs = mobs || [];
    session.nearbyUsers = new Map(nearbyUsers.map((user) => [user.socketId, user]));
    session.nearbyNpcs = new Map(nearbyNpcs.map((npc) => [npc.nid, npc]));
    session.nearbyMobs = new Map(nearbyMobs.map((mob) => [mobIdentity(mob), mob]));
  }

  async #buildMobBootstrap(session) {
    if (typeof this.bootstrapPort.buildMobBootstrap !== 'function') return [];
    const packets = await this.bootstrapPort.buildMobBootstrap({
      session: publicSnapshot(session),
      mobs: [...session.nearbyMobs.values()],
    });
    if (packets == null) return [];
    if (!Array.isArray(packets)) throw new Error('bootstrapPort.buildMobBootstrap must return an array of packets');
    return packets.map((packet) => Buffer.from(packet));
  }

  #buildZoneAbilityPacket(zoneId) {
    if (zoneId === ZONE.MORADON) return buildMoradonZoneAbility();
    const zone = this.zoneRegistry.requireProductionReady(zoneId);
    return buildZoneAbility(zone.zoneAbility);
  }

  #authorizeZoneEntry({ character, sourceZone, targetZone, reason }) {
    if (targetZone.nationConstraint !== null && character.nation !== targetZone.nationConstraint) {
      throw new Error(`nation ${character.nation} cannot enter zone ${targetZone.zoneId}`);
    }
    if (!this.zonePolicy) return;
    if (typeof this.zonePolicy.canEnter !== 'function') throw new Error('zonePolicy.canEnter is required when zonePolicy is provided');
    const decision = callSync(this.zonePolicy.canEnter, {
      character: Object.freeze({
        accountId: character.accountId,
        characterId: character.characterId,
        nation: character.nation,
      }),
      sourceZone,
      targetZone,
      reason,
    }, 'zonePolicy.canEnter');
    if (decision === false || (decision && decision.allowed === false)) {
      const detail = decision && decision.reason ? `: ${decision.reason}` : '';
      throw new Error(`zone ${targetZone.zoneId} entry denied${detail}`);
    }
  }

  #registerInitialMovement(session) {
    if (session.movementRegistered || typeof this.movementPort.registerSession !== 'function') return;
    callSync(this.movementPort.registerSession, {
      sessionId: session.socketId,
      entityId: session.characterId,
      zoneId: session.zoneId,
      position: { x: session.x, z: session.z, y: session.y },
      headingRaw: session.character.direction ?? 0,
    }, 'movementPort.registerSession');
    session.movementRegistered = true;
  }

  #subscribeRegion(session, zoneId, reason) {
    if (session.regionSubscribed) return;
    callSync(this.regionPort.subscribe, {
      socketId: session.socketId,
      zoneId,
      position: { x: session.x, z: session.z, y: session.y },
      reason,
    }, 'regionPort.subscribe');
    session.regionSubscribed = true;
  }

  #unsubscribeRegion(session, zoneId, reason) {
    if (!session.regionSubscribed) return;
    callSync(this.regionPort.unsubscribe, {
      socketId: session.socketId,
      zoneId,
      reason,
    }, 'regionPort.unsubscribe');
    session.regionSubscribed = false;
  }

  #setTransitionState(session, state) {
    if (!session.transition) throw new Error('transition state update without active transition');
    session.state = state;
    session.transition.state = state;
    this.#audit(session, state, {
      transitionId: session.transition.id,
      fromZoneId: session.transition.source.zoneId,
      toZoneId: session.transition.target.zoneId,
      reason: session.transition.reason,
    });
  }

  #rollbackTransition(session, cause) {
    const transition = session.transition;
    if (!transition) return { rolledBack: false, cause, clientPackets: [] };

    try {
      if (transition.targetRegionSubscribed && session.regionSubscribed) {
        this.#unsubscribeRegion(session, transition.target.zoneId, 'ROLLBACK');
      }
      if (transition.targetMembershipAdded) {
        this.zoneRegistry.runtime(transition.target.zoneId).leave(session.socketId);
      }
      if (transition.movementTeleported && typeof this.movementPort.teleport === 'function') {
        callSync(this.movementPort.teleport, session.socketId, {
          zoneId: transition.source.zoneId,
          position: { x: transition.source.x, z: transition.source.z, y: transition.source.y },
          headingRaw: session.character.direction ?? 0,
          reason: 'ROLLBACK',
        }, 'movementPort.teleport');
      }

      session.zoneId = transition.source.zoneId;
      session.x = transition.source.x;
      session.z = transition.source.z;
      session.y = transition.source.y;
      session.nearbyUsers = new Map(transition.sourceNearbyUsers);
      session.nearbyNpcs = new Map(transition.sourceNearbyNpcs);
      session.nearbyMobs = new Map(transition.sourceNearbyMobs);
      if (transition.sourceMembershipExisted) this.zoneRegistry.runtime(transition.source.zoneId).enter(runtimeSnapshot(session));
      if (transition.sourceRegionSubscribed) this.#subscribeRegion(session, transition.source.zoneId, 'ROLLBACK');
      session.state = WORLD_STATE.WORLD_READY;
      transition.state = 'ROLLED_BACK';
      this.#audit(session, 'ROLLED_BACK', {
        transitionId: transition.id,
        fromZoneId: transition.source.zoneId,
        toZoneId: transition.target.zoneId,
        reason: transition.reason,
        cause,
      });
      session.transition = null;
      callSync(this.lifecycle.onTransitionRollback, {
        session: publicSnapshot(session),
        transition: publicTransition(transition),
        cause,
      }, 'lifecycle.onTransitionRollback');

      const clientPackets = transition.teleportSent
        ? [buildZoneChangeTeleport({
          zoneId: transition.source.zoneId,
          x: transition.source.x,
          z: transition.source.z,
          y: transition.source.y,
          victoryNation: this.victoryNation,
        })]
        : [];
      return {
        rolledBack: true,
        cause,
        clientPackets,
        snapshot: publicSnapshot(session),
        transition: publicTransition(transition),
      };
    } catch (rollbackError) {
      session.state = 'TRANSITION_FAILED';
      this.#audit(session, 'ROLLBACK_FAILED', {
        transitionId: transition.id,
        cause,
        rollbackError: rollbackError.message,
      });
      return {
        rolledBack: false,
        cause,
        rollbackError,
        snapshot: publicSnapshot(session),
        clientPackets: [],
      };
    }
  }

  #audit(session, state, details = {}) {
    const event = Object.freeze({
      sequence: this.nextAuditSequence++,
      socketId: session.socketId,
      characterId: session.characterId,
      state,
      zoneId: session.zoneId,
      ...details,
    });
    session.auditTrail.push(event);
    if (session.auditTrail.length > this.auditLimit) session.auditTrail.splice(0, session.auditTrail.length - this.auditLimit);
    if (this.auditSink) {
      try { this.auditSink(event); } catch (_) { /* audit consumers cannot corrupt world state */ }
    }
  }

  #requireSession(socketId) {
    const session = this.sessions.get(socketId);
    if (!session) throw new Error(`world session not found for socket ${socketId}`);
    return session;
  }
}

function assertRegionDetailState(session, opcodeName) {
  const valid = new Set([
    WORLD_STATE.WAIT_GAMESTART_LOADED,
    WORLD_STATE.WORLD_READY,
    WORLD_STATE.LOADED,
  ]);
  if (!valid.has(session.state)) throw new Error(`${opcodeName} invalid in state ${session.state}`);
}

function validateSessionIdentity({ accountId, characterId, socketId }) {
  if (!accountId || typeof accountId !== 'string') throw new Error('accountId is required');
  if (!characterId || typeof characterId !== 'string') throw new Error('characterId is required');
  if (!Number.isInteger(socketId) || socketId < 0 || socketId > 0xffff) throw new Error('socketId must fit uint16');
}

function validateTransitionReason(reason) {
  if (!TRANSITION_REASONS.has(reason)) throw new Error(`unsupported transition reason ${String(reason)}`);
}

function callSync(fn, ...args) {
  const label = typeof args.at(-1) === 'string' ? args.pop() : 'adapter';
  if (typeof fn !== 'function') return undefined;
  const value = fn(...args);
  if (value && typeof value.then === 'function') throw new Error(`${label} must be synchronous at the WS14 lifecycle boundary`);
  return value;
}

function mobIdentity(mob) {
  const id = mob?.instanceId ?? mob?.nid ?? mob?.id;
  if (!Number.isInteger(id)) throw new Error('nearby mob requires integer instanceId/nid/id');
  return id;
}

function freezeLocation(session, zoneDefinition = null) {
  return Object.freeze({
    zoneId: session.zoneId,
    x: session.x,
    z: session.z,
    y: session.y,
    mapRef: zoneDefinition?.mapRef ?? null,
    socketId: session.socketId,
  });
}

function runtimeSnapshot(session) {
  return {
    accountId: session.accountId,
    characterId: session.characterId,
    socketId: session.socketId,
    zoneId: session.zoneId,
    x: session.x,
    z: session.z,
    y: session.y,
    state: session.state,
  };
}

function publicTransition(transition) {
  return {
    id: transition.id,
    reason: transition.reason,
    state: transition.state,
    source: { ...transition.source },
    target: { ...transition.target },
  };
}

function publicSnapshot(session) {
  return {
    accountId: session.accountId,
    characterId: session.characterId,
    socketId: session.socketId,
    zoneId: session.zoneId,
    x: session.x,
    z: session.z,
    y: session.y,
    state: session.state,
    capabilities: capabilitiesFor(session),
    transition: session.transition ? publicTransition(session.transition) : null,
  };
}

function capabilitiesFor(session) {
  const enabled = session.state === WORLD_STATE.WORLD_READY && !session.transition;
  return Object.freeze({ movement: enabled, combat: enabled });
}

function staleRegionDescriptor(session, transition) {
  return Object.freeze({
    socketId: session.socketId,
    zoneId: transition.source.zoneId,
    userIds: Object.freeze([...transition.sourceNearbyUsers.keys()]),
    npcIds: Object.freeze([...transition.sourceNearbyNpcs.keys()]),
    mobIds: Object.freeze([...transition.sourceNearbyMobs.keys()]),
    clearAll: true,
    reason: 'ZONE_TRANSITION',
  });
}

function socketIdFor(session) {
  return session.socketId;
}

function result(session, clientPackets = [], broadcastPackets = [], extra = {}) {
  return {
    state: session.state,
    clientPackets,
    broadcastPackets,
    snapshot: publicSnapshot(session),
    ...extra,
  };
}

function ignoredResult(session) {
  return { ...result(session), ignored: true };
}

module.exports = { WorldSessionService };
