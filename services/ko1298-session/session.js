'use strict';

const {
  LOGIN,
  GAME,
  Reader,
  Writer,
  parseCredentials,
  parseCharacterCreate,
  parseCharacterSelect,
  buildCharacterList,
} = require('./protocol');

const WORLD_OPCODES = new Set([
  GAME.GAMESTART,
  GAME.REQUEST_USER_IN,
  GAME.REQUEST_NPC_IN,
  GAME.ZONE_CHANGE,
]);

class AuthSession {
  constructor(repo, { gameHost = '127.0.0.1', gameName = 'OldKO', concurrent = 0 } = {}) {
    this.repo = repo;
    this.gameHost = gameHost;
    this.gameName = gameName;
    this.concurrent = concurrent;
  }

  handle(payload) {
    switch (payload[0]) {
      case LOGIN.SERVER_LIST:
        return [new Writer().u8(LOGIN.SERVER_LIST).u8(1).str16(this.gameHost).str16(this.gameName).i16(this.concurrent).done()];
      case LOGIN.LOGIN_REQ: {
        const { username, password } = parseCredentials(payload, LOGIN.LOGIN_REQ);
        return [new Writer().u8(LOGIN.LOGIN_REQ).u8(this.repo.authenticate(username, password) ? 1 : (this.repo.accounts?.has(username) ? 3 : 2)).done()];
      }
      case LOGIN.NEWS:
        return [new Writer().u8(LOGIN.NEWS).str16('Login Notice').str16('#\0\nOldKO development server\0\n#\0\n').done()];
      default:
        return [];
    }
  }
}

class GameSession {
  constructor(repo, {
    version = 1298,
    publicKey = 0n,
    worldSession = null,
    socketId = 0,
    onWorldBroadcast = () => {},
  } = {}) {
    this.repo = repo;
    this.version = version;
    this.publicKey = BigInt(publicKey);
    if (this.publicKey !== 0n) {
      throw new Error('non-zero JV publicKey is unsupported by WS03; use zero to keep the verified client plaintext');
    }
    this.worldSession = worldSession;
    this.socketId = socketId;
    this.onWorldBroadcast = onWorldBroadcast;
    this.account = null;
    this.selectedCharacterId = null;
    this.worldStarted = false;
  }

  async handle(payload) {
    if (!payload || payload.length === 0) return [];
    if (WORLD_OPCODES.has(payload[0])) return this.#handleWorldPacket(payload);

    switch (payload[0]) {
      case GAME.VERSION_CHECK:
        // WS11 verified that the actual browser client variant reads an 8-byte
        // JvCryption key after version. A zero key keeps its cryption flag off.
        return [new Writer().u8(GAME.VERSION_CHECK).i16(this.version).u64(this.publicKey).done()];

      case GAME.LOGIN: {
        const { username, password } = parseCredentials(payload, GAME.LOGIN);
        if (!this.repo.authenticate(username, password)) return [new Writer().u8(GAME.LOGIN).u8(0xff).done()];
        this.account = username;
        return [new Writer().u8(GAME.LOGIN).u8(this.repo.getNation(username)).done()];
      }

      case GAME.SEL_NATION: {
        if (!this.account) return [new Writer().u8(GAME.SEL_NATION).u8(0).done()];
        const r = new Reader(payload);
        r.u8();
        const nation = r.u8();
        r.assertEnd();
        const ok = (nation === 1 || nation === 2) && this.repo.setNation(this.account, nation);
        return [new Writer().u8(GAME.SEL_NATION).u8(ok ? nation : 0).done()];
      }

      case GAME.ALLCHAR_INFO_REQ:
        if (!this.account) return [Buffer.from([GAME.ALLCHAR_INFO_REQ, 0])];
        if (payload.length !== 1) throw Error('WIZ_ALLCHAR_INFO_REQ must be opcode-only');
        return [buildCharacterList(this.repo.listCharacters(this.account))];

      case GAME.NEW_CHAR:
        return this.#createCharacter(payload);

      case GAME.SEL_CHAR:
        return this.#selectCharacter(payload);

      default:
        return [];
    }
  }

  #createCharacter(payload) {
    if (!this.account) return [Buffer.from([GAME.NEW_CHAR, 1])];
    const request = parseCharacterCreate(payload);
    const result = this.repo.createCharacter(this.account, request);
    return [Buffer.from([GAME.NEW_CHAR, result.ok ? 0 : (result.code || 1)])];
  }

  async #selectCharacter(payload) {
    if (!this.account) return [Buffer.from([GAME.SEL_CHAR, 0])];
    const request = parseCharacterSelect(payload);
    if (request.accountId !== this.account || request.zoneInit !== 1) return [Buffer.from([GAME.SEL_CHAR, 0])];

    const character = this.repo.getCharacter(this.account, request.characterId);
    if (!character) return [Buffer.from([GAME.SEL_CHAR, 0])];
    if (!this.worldSession || typeof this.worldSession.beginSelectedCharacter !== 'function') {
      return [Buffer.from([GAME.SEL_CHAR, 0])];
    }

    const outcome = await this.worldSession.beginSelectedCharacter({
      accountId: this.account,
      characterId: character.characterId,
      socketId: this.socketId,
    });
    const packets = Array.isArray(outcome?.clientPackets) ? outcome.clientPackets.map(Buffer.from) : [];
    if (packets.length === 0 || packets[0][0] !== GAME.SEL_CHAR || packets[0][1] !== 1) {
      throw new Error('WS14 beginSelectedCharacter did not return WIZ_SEL_CHAR success first');
    }

    this.selectedCharacterId = character.characterId;
    this.worldStarted = true;
    this.#emitWorldBroadcast(outcome);
    return packets;
  }

  async #handleWorldPacket(payload) {
    if (!this.worldStarted || !this.worldSession || typeof this.worldSession.handleClientPacket !== 'function') return [];
    const outcome = await this.worldSession.handleClientPacket(this.socketId, Buffer.from(payload));
    this.#emitWorldBroadcast(outcome);
    return Array.isArray(outcome?.clientPackets) ? outcome.clientPackets.map(Buffer.from) : [];
  }

  #emitWorldBroadcast(outcome) {
    for (const packet of outcome?.broadcastPackets || []) {
      this.onWorldBroadcast({ packet: Buffer.from(packet), snapshot: outcome.snapshot || null });
    }
  }
}

module.exports = { AuthSession, GameSession, WORLD_OPCODES };
