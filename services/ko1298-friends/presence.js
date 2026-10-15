'use strict';

function normalizeId(value, label) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new TypeError(`${label} is required`);
  return normalized;
}

class PresenceRegistry {
  constructor(options = {}) {
    this.sessionsByUser = new Map();
    this.onChange = options.onChange ?? (() => {});
  }

  async login({ userId, sessionId, meta = null }) {
    const user = normalizeId(userId, 'userId');
    const session = normalizeId(sessionId, 'sessionId');
    let sessions = this.sessionsByUser.get(user);
    const wasOnline = Boolean(sessions?.size);
    if (!sessions) {
      sessions = new Map();
      this.sessionsByUser.set(user, sessions);
    }
    sessions.set(session, meta);
    if (!wasOnline) this.onChange({ userId: user, online: true });
    return this.getPresence(user);
  }

  async logout({ userId, sessionId }) {
    const user = normalizeId(userId, 'userId');
    const session = normalizeId(sessionId, 'sessionId');
    const sessions = this.sessionsByUser.get(user);
    if (!sessions) return { userId: user, online: false, sessionCount: 0 };
    sessions.delete(session);
    if (sessions.size === 0) {
      this.sessionsByUser.delete(user);
      this.onChange({ userId: user, online: false });
    }
    return this.getPresence(user);
  }

  async disconnectUser(userId) {
    const user = normalizeId(userId, 'userId');
    const wasOnline = this.sessionsByUser.delete(user);
    if (wasOnline) this.onChange({ userId: user, online: false });
    return { userId: user, online: false, sessionCount: 0 };
  }

  async getPresence(userId) {
    const user = normalizeId(userId, 'userId');
    const count = this.sessionsByUser.get(user)?.size ?? 0;
    return { userId: user, online: count > 0, sessionCount: count };
  }

  async getPresenceMany(userIds) {
    const result = new Map();
    for (const userId of userIds ?? []) {
      const presence = await this.getPresence(userId);
      result.set(presence.userId, presence);
    }
    return result;
  }
}

module.exports = { PresenceRegistry };
