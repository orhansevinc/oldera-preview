'use strict';

class SessionAuthority {
  constructor() {
    this.sessions = new Map();
  }

  register({ socketId, session, dispatcher, disconnectTransport = null }) {
    if (!Number.isInteger(socketId) || !session || !dispatcher) {
      throw new TypeError('socketId, session and dispatcher are required');
    }
    if (disconnectTransport != null && typeof disconnectTransport !== 'function') {
      throw new TypeError('disconnectTransport must be a function when supplied');
    }
    this.sessions.set(socketId, { session, dispatcher, disconnectTransport });
  }

  unregister(socketId) {
    this.sessions.delete(socketId);
  }

  listOnlinePlayers() {
    return [...this.sessions.entries()]
      .map(([socketId, entry]) => ({ socketId, ...entry.session.actorContext() }))
      .filter((row) => row.accountId && row.characterId)
      .sort((a, b) => a.socketId - b.socketId);
  }

  findOnlinePlayer({ socketId = null, characterId = null, accountId = null } = {}) {
    if (socketId != null) {
      const entry = this.sessions.get(Number(socketId));
      if (!entry) return null;
      const actor = entry.session.actorContext();
      return actor.accountId && actor.characterId ? { socketId: Number(socketId), ...actor } : null;
    }
    const characterNeedle = characterId == null ? null : String(characterId).toLowerCase();
    const accountNeedle = accountId == null ? null : String(accountId).toLowerCase();
    return this.listOnlinePlayers().find((row) => (
      (!characterNeedle || String(row.characterId || '').toLowerCase() === characterNeedle)
      && (!accountNeedle || String(row.accountId || '').toLowerCase() === accountNeedle)
    )) || null;
  }

  async disconnectPlayer(selector, { reason = 'ADMIN_COMMAND' } = {}) {
    const player = this.findOnlinePlayer(selector);
    if (!player) return { ok: false, code: 'PLAYER_NOT_ONLINE' };
    const entry = this.sessions.get(player.socketId);
    await entry.dispatcher.close({ reason, useGrace: false });
    entry.disconnectTransport?.();
    this.sessions.delete(player.socketId);
    return { ok: true, code: 'DISCONNECTED', player };
  }

  async executeCommand(command = {}) {
    const type = String(command.type || command.action || '').toUpperCase();
    if (!['KICK', 'DISCONNECT'].includes(type)) {
      return { ok: false, code: 'UNSUPPORTED_RUNTIME_COMMAND' };
    }
    return this.disconnectPlayer({
      socketId: command.socketId ?? null,
      characterId: command.character ?? command.characterId ?? null,
      accountId: command.account ?? command.accountId ?? null,
    }, { reason: command.reason || `ADMIN_${type}` });
  }
}

module.exports = { SessionAuthority };
