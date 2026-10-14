'use strict';

const {
  LOGIN,
  GAME,
  Writer,
  parseCredentials,
  buildCharacterList,
} = require('./protocol');
const {
  SESSION_STATES,
  OWNER,
  getOpcodeContract,
} = require('./contracts');
const { SessionError, ERROR_CATEGORY } = require('./errors');
const { malformedPacket, clientPacketsFrom, domainOwner } = require('./session-helpers');

const WORLD_OPCODES = new Set([
  GAME.GAMESTART,
  GAME.REQUEST_USER_IN,
  GAME.REQUEST_NPC_IN,
  GAME.ZONE_CHANGE,
]);
const MOVEMENT_OPCODES = new Set([GAME.MOVE, GAME.ROTATE]);
const NPC_OPCODES = new Set([GAME.NPC_EVENT, GAME.TARGET_HP]);
const COMBAT_OPCODES = new Set([GAME.ATTACK, GAME.MAGIC_PROCESS]);
const DOMAIN_EVENT_SOURCES = new Set(['WS25', 'WS26', 'WS27']);

class AuthSession {
  constructor(repo, { gameHost = '127.0.0.1', gameName = 'OldKO', concurrent = 0, logger = () => {} } = {}) {
    this.repo = repo;
    this.gameHost = gameHost;
    this.gameName = gameName;
    this.concurrent = concurrent;
    this.logger = typeof logger === 'function' ? logger : () => {};
  }

  handle(payload) {
    const packet = Buffer.from(payload || []);
    if (packet.length === 0) return [];
    try {
      switch (packet[0]) {
        case LOGIN.SERVER_LIST:
          return [new Writer().u8(LOGIN.SERVER_LIST).u8(1).str16(this.gameHost).str16(this.gameName).i16(this.concurrent).done()];
        case LOGIN.LOGIN_REQ: {
          const { username, password } = parseCredentials(packet, LOGIN.LOGIN_REQ);
          return [new Writer().u8(LOGIN.LOGIN_REQ).u8(this.repo.authenticate(username, password) ? 1 : (this.repo.accounts?.has(username) ? 3 : 2)).done()];
        }
        case LOGIN.NEWS:
          return [new Writer().u8(LOGIN.NEWS).str16('Login Notice').str16('#\0\nOldKO development server\0\n#\0\n').done()];
        default:
          this.logger('unknown_opcode', { channel: 'auth', opcode: packet[0], length: packet.length });
          return [];
      }
    } catch (error) {
      throw malformedPacket(error, packet[0], packet.length, 'auth');
    }
  }
}

class GameSession {
  constructor(repo, {
    version = 1298,
    publicKey = 0n,
    worldSession = null,
    movementSession = null,
    npcRouter = null,
    inventoryAdapter = null,
    combatAdapter = null,
    economyAdapter = null,
    domainEventAdapter = null,
    ownership = null,
    socketId = 0,
    sessionId = `game:${socketId}`,
    serverId = 'oldko-game',
    npcRoutesRequestNpcIn = false,
    onWorldBroadcast = () => {},
    onGameplayBroadcast = () => {},
    onCombatEvent = () => {},
    onStateChange = () => {},
    logger = () => {},
  } = {}) {
    this.repo = repo;
    this.version = version;
    this.publicKey = BigInt(publicKey);
    if (this.publicKey !== 0n) {
      throw new Error('non-zero JV publicKey is unsupported by WS03; use zero to keep the verified client plaintext');
    }
    if (!Number.isInteger(socketId) || socketId < 0 || socketId > 0xffff) throw new RangeError('socketId must fit uint16');
    this.socketId = socketId;
    this.sessionId = sessionId;
    this.serverId = serverId;
    this.worldSession = worldSession;
    this.movementSession = movementSession;
    this.npcRouter = npcRouter;
    this.inventoryAdapter = inventoryAdapter;
    this.combatAdapter = combatAdapter;
    this.economyAdapter = economyAdapter;
    this.domainEventAdapter = domainEventAdapter;
    this.ownership = ownership;
    this.npcRoutesRequestNpcIn = Boolean(npcRoutesRequestNpcIn);
    this.onWorldBroadcast = typeof onWorldBroadcast === 'function' ? onWorldBroadcast : () => {};
    this.onGameplayBroadcast = typeof onGameplayBroadcast === 'function' ? onGameplayBroadcast : () => {};
    this.onCombatEvent = typeof onCombatEvent === 'function' ? onCombatEvent : () => {};
    this.onStateChange = typeof onStateChange === 'function' ? onStateChange : () => {};
    this.logger = typeof logger === 'function' ? logger : () => {};
    this.state = {
      phase: SESSION_STATES.CONNECTED,
      socketId,
      sessionId,
      accountId: null,
      characterId: null,
      zoneId: null,
      entityId: null,
      position: null,
      headingRaw: 0,
    };
    this.movementRegistered = false;
    this.combatIngressSequence = 0;
    this.combatDeathSignals = new Set();
    this._disconnectPromise = null;
  }

  get account() { return this.state.accountId; }
  get selectedCharacterId() { return this.state.characterId; }
  get worldStarted() {
    return this.state.phase === SESSION_STATES.WORLD_LOADING || this.state.phase === SESSION_STATES.WORLD_READY;
  }
  get phase() { return this.state.phase; }

  actorContext() {
    return Object.freeze({
      socketId: this.state.socketId,
      sessionId: this.state.sessionId,
      accountId: this.state.accountId,
      characterId: this.state.characterId,
      zoneId: this.state.zoneId,
      entityId: this.state.entityId,
      position: this.state.position ? Object.freeze({ ...this.state.position }) : null,
      state: this.state.phase,
    });
  }

  async handle(payload, context = {}) {
    const packet = Buffer.from(payload || []);
    if (packet.length === 0) return [];
    const opcode = packet[0];
    const contract = getOpcodeContract(opcode);
    if (!contract) {
      this.logger('unknown_opcode', this._packetMeta(packet, { owner: 'UNOWNED' }));
      return [];
    }
    if (!contract.allowedStates.has(this.state.phase)) {
      this.logger('wrong_state', this._packetMeta(packet, { owner: contract.owner, expected: [...contract.allowedStates].join(','), actual: this.state.phase }));
      return this._wrongStateResponse(opcode);
    }

    try {
      if (WORLD_OPCODES.has(opcode)) return await this._handleWorldPacket(packet);
      if (MOVEMENT_OPCODES.has(opcode)) return await this._handleMovementPacket(packet);
      if (NPC_OPCODES.has(opcode)) return await this._handleNpcPacket(packet);
      if (COMBAT_OPCODES.has(opcode)) return await this._handleCombatPacket(packet, context);

      switch (opcode) {
        case GAME.VERSION_CHECK:
          if (packet.length !== 1) throw Error('WIZ_VERSION_CHECK must be opcode-only');
          return [new Writer().u8(GAME.VERSION_CHECK).i16(this.version).u64(this.publicKey).done()];

        case GAME.LOGIN:
          return await this._gameLogin(packet);

        case GAME.SEL_NATION:
          return this._selectNation(packet);

        case GAME.ALLCHAR_INFO_REQ:
          if (packet.length !== 1) throw Error('WIZ_ALLCHAR_INFO_REQ must be opcode-only');
          return [buildCharacterList(this.repo.listCharacters(this.state.accountId))];

        case GAME.NEW_CHAR:
          return this._createCharacter(packet);

        case GAME.SEL_CHAR:
          return await this._selectCharacter(packet);

        default:
          this.logger('unrouted_owned_opcode', this._packetMeta(packet, { owner: contract.owner }));
          return [];
      }
    } catch (error) {
      if (error instanceof SessionError) throw error;
      throw malformedPacket(error, opcode, packet.length, 'game');
    }
  }

  async trustedDomainCall(domain, operation) {
    if (this.state.phase !== SESSION_STATES.WORLD_READY) {
      throw new SessionError('WRONG_STATE', `trusted ${domain} call requires WORLD_READY`, {
        category: ERROR_CATEGORY.WRONG_STATE,
        details: { domain, state: this.state.phase },
      });
    }
    const adapters = {
      inventory: this.inventoryAdapter,
      combat: this.combatAdapter,
      economy: this.economyAdapter,
    };
    const adapter = adapters[domain];
    if (!adapter || typeof adapter.execute !== 'function') {
      throw new SessionError('DOMAIN_ADAPTER_UNAVAILABLE', `${domain} adapter is unavailable`, {
        category: ERROR_CATEGORY.DOWNSTREAM,
        details: { domain },
      });
    }
    try {
      return await adapter.execute({ actor: this.actorContext(), operation });
    } catch (error) {
      this.logger('downstream_error', { owner: domainOwner(domain), code: error?.code || 'ERROR', state: this.state.phase });
      throw new SessionError('DOWNSTREAM_DOMAIN_FAILURE', `${domain} adapter failed`, {
        category: ERROR_CATEGORY.DOWNSTREAM,
        fatal: false,
        details: { domain, downstreamCode: error?.code || null },
        cause: error,
      });
    }
  }

  async deliverDomainEvent(source, event) {
    if (!DOMAIN_EVENT_SOURCES.has(source)) {
      throw new SessionError('UNSUPPORTED_EVENT_SOURCE', `unsupported domain event source ${source}`, {
        category: ERROR_CATEGORY.DOWNSTREAM,
        details: { source },
      });
    }
    if (this.state.phase !== SESSION_STATES.WORLD_READY) return [];

    if (source === 'WS25' && event?.sourceAttack && Number.isInteger(event.runtimeId) && event.targetId !== undefined) {
      try {
        return await this._handleMobAttackIntent(event);
      } catch (error) {
        this.logger('downstream_error', { owner: OWNER.WS19, code: error?.code || 'ERROR', state: this.state.phase });
        return [];
      }
    }

    if (source === 'WS25' && event?.type === 'IN' && event?.reason === 'respawn' && Number.isInteger(event.runtimeId)) {
      this.combatDeathSignals.delete(event.runtimeId);
    }

    if (!this.domainEventAdapter || typeof this.domainEventAdapter.encode !== 'function') {
      this.logger('domain_event_unencoded', { source, state: this.state.phase });
      return [];
    }
    try {
      const outcome = await this.domainEventAdapter.encode({ source, event, actor: this.actorContext() });
      this._emitGameplayOutcome(source, outcome);
      return clientPacketsFrom(outcome);
    } catch (error) {
      this.logger('downstream_error', { owner: source, code: error?.code || 'ERROR', state: this.state.phase });
      return [];
    }
  }

  disconnect({ reason = 'TRANSPORT_LOST', useGrace = true } = {}) {
    if (this._disconnectPromise) return this._disconnectPromise;
    this._disconnectPromise = this._disconnectOnce({ reason, useGrace });
    return this._disconnectPromise;
  }
}

require('./session-auth').install(GameSession);
require('./session-gameplay').install(GameSession);
require('./session-lifecycle').install(GameSession);

module.exports = { AuthSession, GameSession, WORLD_OPCODES, MOVEMENT_OPCODES, NPC_OPCODES, COMBAT_OPCODES, DOMAIN_EVENT_SOURCES };
