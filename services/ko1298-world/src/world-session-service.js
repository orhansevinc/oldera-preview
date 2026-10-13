'use strict';

const {
  ZONE,
  MORADON_SPAWN,
  WORLD_STATE,
  USER_INOUT,
  GAMESTART_PHASE,
  ZONE_CHANGE_PHASE,
  OPCODE,
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

class WorldSessionService {
  constructor({ repository, victoryNation = 0, moradonSpawn = MORADON_SPAWN } = {}) {
    if (!repository) throw new Error('repository is required');
    this.repository = repository;
    this.victoryNation = victoryNation;
    this.moradonSpawn = { ...moradonSpawn };
    this.sessions = new Map();
  }

  async beginSelectedCharacter({ accountId, characterId, socketId }) {
    validateSessionIdentity({ accountId, characterId, socketId });
    const character = await this.repository.getCharacterForWorld(accountId, characterId);
    if (!character) throw new Error('selected character was not found for account');
    if (character.accountId !== accountId || character.characterId !== characterId) {
      throw new Error('repository returned a character outside the selected account boundary');
    }

    const session = {
      accountId,
      characterId,
      socketId,
      zoneId: ZONE.MORADON,
      x: this.moradonSpawn.x,
      z: this.moradonSpawn.z,
      y: this.moradonSpawn.y,
      state: WORLD_STATE.WAIT_GAMESTART_LOADING,
      character,
      nearbyUsers: new Map(),
      nearbyNpcs: new Map(),
    };
    this.sessions.set(socketId, session);

    return result(session, [buildCharacterSelectSuccess({
      zoneId: session.zoneId,
      x: session.x,
      z: session.z,
      y: session.y,
      victoryNation: this.victoryNation,
    })]);
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

  beginMoradonZoneChange(socketId, spawn = this.moradonSpawn) {
    const session = this.sessions.get(socketId);
    if (!session) throw new Error(`world session not found for socket ${socketId}`);
    if (session.state !== WORLD_STATE.WORLD_READY) throw new Error(`zone change requires WORLD_READY, got ${session.state}`);

    session.zoneId = ZONE.MORADON;
    session.x = spawn.x;
    session.z = spawn.z;
    session.y = spawn.y;
    session.nearbyUsers = new Map();
    session.nearbyNpcs = new Map();
    session.state = WORLD_STATE.ZONE_CHANGE_WAIT_LOADING;

    return result(session, [buildZoneChangeTeleport({
      zoneId: session.zoneId,
      x: session.x,
      z: session.z,
      y: session.y,
      victoryNation: this.victoryNation,
    })]);
  }

  getSession(socketId) {
    const session = this.sessions.get(socketId);
    return session ? publicSnapshot(session) : null;
  }

  async #handleGameStart(session, packet) {
    const { phase } = parseGameStart(packet);

    if (phase === GAMESTART_PHASE.LOADING) {
      if (session.state !== WORLD_STATE.WAIT_GAMESTART_LOADING) {
        if (session.state === WORLD_STATE.WORLD_READY) return ignoredResult(session);
        throw new Error(`WIZ_GAMESTART loading invalid in state ${session.state}`);
      }

      await this.#refreshSurroundings(session);
      session.state = WORLD_STATE.WAIT_GAMESTART_LOADED;
      return result(session, [
        buildMyInfo(session.character, session),
        buildMoradonZoneAbility(),
        buildRegionUserIds([...session.nearbyUsers.values()]),
        buildRegionNpcIds([...session.nearbyNpcs.values()]),
        buildGameStartAck(),
      ]);
    }

    if (session.state !== WORLD_STATE.WAIT_GAMESTART_LOADED) {
      if (session.state === WORLD_STATE.WORLD_READY) return ignoredResult(session);
      throw new Error(`WIZ_GAMESTART loaded invalid in state ${session.state}`);
    }

    session.state = WORLD_STATE.WORLD_READY;
    return result(session, [], [buildUserInOut(session.character, session, USER_INOUT.REGENE)]);
  }

  async #handleZoneChange(session, packet) {
    const { phase } = parseZoneChangePhase(packet);

    if (phase === ZONE_CHANGE_PHASE.LOADING) {
      if (session.state !== WORLD_STATE.ZONE_CHANGE_WAIT_LOADING) {
        throw new Error(`WIZ_ZONE_CHANGE loading invalid in state ${session.state}`);
      }
      await this.#refreshSurroundings(session);
      session.state = WORLD_STATE.ZONE_CHANGE_WAIT_LOADED;
      return result(session, [
        buildRegionUserIds([...session.nearbyUsers.values()]),
        buildRegionNpcIds([...session.nearbyNpcs.values()]),
        buildZoneChangeLoadedAck(),
      ]);
    }

    if (session.state !== WORLD_STATE.ZONE_CHANGE_WAIT_LOADED) {
      throw new Error(`WIZ_ZONE_CHANGE loaded invalid in state ${session.state}`);
    }
    session.state = WORLD_STATE.WORLD_READY;
    return result(session, [], [buildUserInOut(session.character, session, USER_INOUT.REGENE)]);
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
    const [users, npcs] = await Promise.all([
      this.repository.getSurroundingUsers({
        zoneId: session.zoneId,
        x: session.x,
        z: session.z,
        excludeSocketId: session.socketId,
      }),
      this.repository.getSurroundingNpcs({
        zoneId: session.zoneId,
        x: session.x,
        z: session.z,
      }),
    ]);
    const nearbyUsers = users || [];
    const nearbyNpcs = npcs || [];
    session.nearbyUsers = new Map(nearbyUsers.map((user) => [user.socketId, user]));
    session.nearbyNpcs = new Map(nearbyNpcs.map((npc) => [npc.nid, npc]));
  }
}

function assertRegionDetailState(session, opcodeName) {
  const valid = new Set([
    WORLD_STATE.WAIT_GAMESTART_LOADED,
    WORLD_STATE.WORLD_READY,
    WORLD_STATE.ZONE_CHANGE_WAIT_LOADED,
  ]);
  if (!valid.has(session.state)) throw new Error(`${opcodeName} invalid in state ${session.state}`);
}

function validateSessionIdentity({ accountId, characterId, socketId }) {
  if (!accountId || typeof accountId !== 'string') throw new Error('accountId is required');
  if (!characterId || typeof characterId !== 'string') throw new Error('characterId is required');
  if (!Number.isInteger(socketId) || socketId < 0 || socketId > 0xffff) throw new Error('socketId must fit uint16');
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
  };
}

function result(session, clientPackets = [], broadcastPackets = []) {
  return { state: session.state, clientPackets, broadcastPackets, snapshot: publicSnapshot(session) };
}

function ignoredResult(session) {
  return { ...result(session), ignored: true };
}

module.exports = { WorldSessionService };
