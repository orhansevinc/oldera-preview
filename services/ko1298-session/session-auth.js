'use strict';

const { GAME, Reader, Writer, parseCredentials, parseCharacterCreate, parseCharacterSelect } = require('./protocol');
const { SESSION_STATES, OWNER } = require('./contracts');
const { SessionError, ERROR_CATEGORY } = require('./errors');
const { malformedPacket, clientPacketsFrom } = require('./session-helpers');
function install(GameSession) {
  GameSession.prototype._gameLogin = async function(packet) {
    let credentials;
    try {
      credentials = parseCredentials(packet, GAME.LOGIN);
    } catch (error) {
      throw malformedPacket(error, GAME.LOGIN, packet.length, 'game');
    }
    if (!this.repo.authenticate(credentials.username, credentials.password)) {
      return [new Writer().u8(GAME.LOGIN).u8(0xff).done()];
    }

    if (this.ownership && typeof this.ownership.acquireAccount === 'function') {
      let claim;
      try {
        claim = await this.ownership.acquireAccount({
          accountId: credentials.username,
          sessionId: this.sessionId,
          serverId: this.serverId,
        });
      } catch (error) {
        throw new SessionError('OWNERSHIP_ACCOUNT_ACQUIRE_FAILED', 'account ownership provider failed', {
          category: ERROR_CATEGORY.OWNERSHIP,
          fatal: true,
          details: { accountId: credentials.username },
          cause: error,
        });
      }
      if (!claim?.ok) {
        this.logger('ownership_rejected', { scope: 'account', code: claim?.code || 'REJECTED', socketId: this.socketId });
        return [new Writer().u8(GAME.LOGIN).u8(0xff).done()];
      }
    }

    this.state.accountId = credentials.username;
    this._transition(SESSION_STATES.AUTHENTICATED, 'credentials accepted');
    return [new Writer().u8(GAME.LOGIN).u8(this.repo.getNation(credentials.username)).done()];
  };

  GameSession.prototype._selectNation = function(packet) {
    const r = new Reader(packet);
    r.u8();
    const nation = r.u8();
    r.assertEnd();
    const ok = (nation === 1 || nation === 2) && this.repo.setNation(this.state.accountId, nation);
    return [new Writer().u8(GAME.SEL_NATION).u8(ok ? nation : 0).done()];
  };

  GameSession.prototype._createCharacter = function(packet) {
    const request = parseCharacterCreate(packet);
    const result = this.repo.createCharacter(this.state.accountId, request);
    return [Buffer.from([GAME.NEW_CHAR, result.ok ? 0 : (result.code || 1)])];
  };

  GameSession.prototype._selectCharacter = async function(packet) {
    const request = parseCharacterSelect(packet);
    if (request.accountId !== this.state.accountId || request.zoneInit !== 1) return [Buffer.from([GAME.SEL_CHAR, 0])];

    const character = this.repo.getCharacter(this.state.accountId, request.characterId);
    if (!character) return [Buffer.from([GAME.SEL_CHAR, 0])];
    if (!this.worldSession || typeof this.worldSession.beginSelectedCharacter !== 'function') {
      return [Buffer.from([GAME.SEL_CHAR, 0])];
    }

    this.state.characterId = character.characterId;
    this.state.headingRaw = Number.isInteger(character.direction) ? character.direction : 0;
    this._transition(SESSION_STATES.CHARACTER_SELECTED, 'character ownership validated');

    if (this.ownership && typeof this.ownership.acquireCharacter === 'function') {
      let claim;
      try {
        claim = await this.ownership.acquireCharacter({
          accountId: this.state.accountId,
          characterId: this.state.characterId,
          sessionId: this.sessionId,
          serverId: this.serverId,
        });
      } catch (error) {
        await this.disconnect({ reason: 'OWNERSHIP_CHARACTER_ACQUIRE_FAILED', useGrace: false });
        throw new SessionError('OWNERSHIP_CHARACTER_ACQUIRE_FAILED', 'character ownership provider failed', {
          category: ERROR_CATEGORY.OWNERSHIP,
          fatal: true,
          cause: error,
        });
      }
      if (!claim?.ok) {
        this.state.characterId = null;
        this._transition(SESSION_STATES.AUTHENTICATED, 'character lease rejected');
        this.logger('ownership_rejected', { scope: 'character', code: claim?.code || 'REJECTED', socketId: this.socketId });
        return [Buffer.from([GAME.SEL_CHAR, 0])];
      }
    }

    this._transition(SESSION_STATES.WORLD_LOADING, 'WS14 beginSelectedCharacter');
    let outcome;
    try {
      outcome = await this.worldSession.beginSelectedCharacter({
        accountId: this.state.accountId,
        characterId: character.characterId,
        socketId: this.socketId,
      });
    } catch (error) {
      await this.disconnect({ reason: 'WORLD_BEGIN_FAILED', useGrace: false });
      throw new SessionError('WORLD_BEGIN_FAILED', 'WS14 beginSelectedCharacter failed', {
        category: ERROR_CATEGORY.DOWNSTREAM,
        fatal: true,
        details: { owner: OWNER.WS14 },
        cause: error,
      });
    }

    const packets = clientPacketsFrom(outcome);
    if (packets.length === 0 || packets[0][0] !== GAME.SEL_CHAR || packets[0][1] !== 1) {
      await this.disconnect({ reason: 'WORLD_SELECT_CONTRACT_FAILED', useGrace: false });
      throw new SessionError('WORLD_SELECT_CONTRACT_FAILED', 'WS14 beginSelectedCharacter did not return WIZ_SEL_CHAR success first', {
        category: ERROR_CATEGORY.DOWNSTREAM,
        fatal: true,
        details: { owner: OWNER.WS14 },
      });
    }

    await this._applyWorldOutcome(outcome);
    this._emitWorldBroadcast(outcome);
    return packets;
  };

}

module.exports = { install };
