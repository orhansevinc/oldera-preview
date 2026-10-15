'use strict';

function clone(value) {
  return value == null ? value : structuredClone(value);
}

class AdminSessionAuthority {
  constructor({ service, clock = { now: () => Date.now() } } = {}) {
    if (!service || !service.store || typeof service.store.listAll !== 'function') {
      throw new TypeError('service with a lease store is required');
    }
    this.service = service;
    this.store = service.store;
    this.clock = clock;
  }

  async listLeaseSnapshot({ includeGrace = true } = {}) {
    const now = Number(this.clock.now());
    const leases = await this.store.listAll();
    return leases
      .filter((lease) => lease.leaseUntil > now)
      .filter((lease) => includeGrace || lease.state === 'active')
      .map(clone);
  }

  async listOnlineCharacters() {
    const leases = await this.listLeaseSnapshot({ includeGrace: false });
    return leases.filter((lease) => lease.scope === 'character');
  }

  async revokeSession(sessionId, { reason = 'ADMIN_SESSION_REVOKE' } = {}) {
    return this.service.revokeSession(sessionId, { reason });
  }

  async revokeAccount(accountId, { reason = 'ADMIN_ACCOUNT_REVOKE' } = {}) {
    return this.service.revokeAccount(accountId, { reason });
  }

  async kickCharacter(characterId, { reason = 'ADMIN_CHARACTER_KICK' } = {}) {
    const owner = await this.service.getCharacterOwner(characterId);
    if (!owner) return { ok: true, status: 'no-active-character', affected: 0 };
    const result = await this.service.revokeSession(owner.sessionId, { reason });
    return {
      ...result,
      characterId,
      sessionId: owner.sessionId,
      accountId: owner.accountId,
    };
  }
}

function createAdminSessionAuthority(options) {
  return new AdminSessionAuthority(options);
}

module.exports = { AdminSessionAuthority, createAdminSessionAuthority };
