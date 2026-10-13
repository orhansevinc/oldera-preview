'use strict';

const DUPLICATE_LOGIN_POLICY = Object.freeze({
  REJECT_NEW: 'reject-new',
  REPLACE_OLD: 'replace-old',
});

const LEASE_SCOPE = Object.freeze({
  ACCOUNT: 'account',
  CHARACTER: 'character',
});

const RESULT = Object.freeze({
  ACCOUNT_IN_USE: 'ACCOUNT_IN_USE',
  CHARACTER_IN_USE: 'CHARACTER_IN_USE',
  ACCOUNT_NOT_OWNED: 'ACCOUNT_NOT_OWNED',
  NOT_FOUND: 'NOT_FOUND',
  NOT_RESUMABLE: 'NOT_RESUMABLE',
  CAS_RETRY_EXHAUSTED: 'CAS_RETRY_EXHAUSTED',
});

function assertNonEmpty(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${name} must be a non-empty string`);
  }
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

class SessionOwnershipService {
  constructor({
    store,
    clock = { now: () => Date.now() },
    duplicateLoginPolicy = DUPLICATE_LOGIN_POLICY.REJECT_NEW,
    leaseMs = 30_000,
    reconnectGraceMs = 10_000,
    maxCasRetries = 16,
    disconnectArbiter = { requestDisconnect: async () => {} },
  }) {
    if (!store || typeof store.get !== 'function' || typeof store.compareAndSet !== 'function') {
      throw new TypeError('store must implement the lease-store interface');
    }
    if (!Object.values(DUPLICATE_LOGIN_POLICY).includes(duplicateLoginPolicy)) {
      throw new TypeError(`unsupported duplicateLoginPolicy: ${duplicateLoginPolicy}`);
    }
    if (!Number.isFinite(leaseMs) || leaseMs <= 0) throw new TypeError('leaseMs must be > 0');
    if (!Number.isFinite(reconnectGraceMs) || reconnectGraceMs < 0) {
      throw new TypeError('reconnectGraceMs must be >= 0');
    }

    this.store = store;
    this.clock = clock;
    this.duplicateLoginPolicy = duplicateLoginPolicy;
    this.leaseMs = leaseMs;
    this.reconnectGraceMs = reconnectGraceMs;
    this.maxCasRetries = maxCasRetries;
    this.disconnectArbiter = disconnectArbiter;
  }

  _now() {
    return Number(this.clock.now());
  }

  _isExpired(lease, now = this._now()) {
    return !lease || lease.leaseUntil <= now;
  }

  _newLease({ scope, key, accountId, characterId = null, sessionId, serverId, generation = 1, now }) {
    return {
      scope,
      key,
      accountId,
      characterId,
      sessionId,
      serverId,
      state: 'active',
      generation,
      acquiredAt: now,
      heartbeatAt: now,
      leaseUntil: now + this.leaseMs,
      graceUntil: null,
      replacedSessionId: null,
    };
  }

  async _cas(scope, key, expectedVersion, nextRecord) {
    return this.store.compareAndSet(scope, key, expectedVersion, nextRecord);
  }

  async _deleteIfCurrent(lease) {
    if (!lease) return false;
    const result = await this._cas(lease.scope, lease.key, lease.version, null);
    return result.ok;
  }

  async _acquire({ scope, key, accountId, characterId = null, sessionId, serverId, allowReplace }) {
    assertNonEmpty(key, 'key');
    assertNonEmpty(accountId, 'accountId');
    assertNonEmpty(sessionId, 'sessionId');
    assertNonEmpty(serverId, 'serverId');

    for (let attempt = 0; attempt < this.maxCasRetries; attempt += 1) {
      const now = this._now();
      const current = await this.store.get(scope, key);

      if (!current || this._isExpired(current, now)) {
        const next = this._newLease({
          scope,
          key,
          accountId,
          characterId,
          sessionId,
          serverId,
          generation: current ? current.generation + 1 : 1,
          now,
        });
        const swapped = await this._cas(scope, key, current ? current.version : null, next);
        if (swapped.ok) {
          return { ok: true, status: current ? 'reclaimed-stale' : 'acquired', lease: clone(swapped.record) };
        }
        continue;
      }

      if (current.sessionId === sessionId) {
        const renewed = {
          ...current,
          serverId,
          state: 'active',
          heartbeatAt: now,
          leaseUntil: now + this.leaseMs,
          graceUntil: null,
        };
        delete renewed.version;
        const swapped = await this._cas(scope, key, current.version, renewed);
        if (swapped.ok) return { ok: true, status: 'renewed', lease: clone(swapped.record) };
        continue;
      }

      if (allowReplace) {
        const next = this._newLease({
          scope,
          key,
          accountId,
          characterId,
          sessionId,
          serverId,
          generation: current.generation + 1,
          now,
        });
        next.replacedSessionId = current.sessionId;
        const swapped = await this._cas(scope, key, current.version, next);
        if (!swapped.ok) continue;

        // Character leases owned by the displaced account session must not survive takeover.
        await this._releaseSessionLeases(current.sessionId, 'DUPLICATE_LOGIN_REPLACED', {
          skipScope: scope,
          skipKey: key,
          notify: true,
        });
        return {
          ok: true,
          status: 'replaced',
          lease: clone(swapped.record),
          displacedSessionId: current.sessionId,
        };
      }

      return {
        ok: false,
        code: scope === LEASE_SCOPE.ACCOUNT ? RESULT.ACCOUNT_IN_USE : RESULT.CHARACTER_IN_USE,
        ownerSessionId: current.sessionId,
        retryAt: current.leaseUntil,
        state: current.state,
      };
    }

    return { ok: false, code: RESULT.CAS_RETRY_EXHAUSTED };
  }

  async acquireAccount({ accountId, sessionId, serverId }) {
    return this._acquire({
      scope: LEASE_SCOPE.ACCOUNT,
      key: accountId,
      accountId,
      sessionId,
      serverId,
      allowReplace: this.duplicateLoginPolicy === DUPLICATE_LOGIN_POLICY.REPLACE_OLD,
    });
  }

  async acquireCharacter({ accountId, characterId, sessionId, serverId }) {
    assertNonEmpty(characterId, 'characterId');
    const account = await this.store.get(LEASE_SCOPE.ACCOUNT, accountId);
    const now = this._now();
    if (!account || this._isExpired(account, now) || account.sessionId !== sessionId || account.state !== 'active') {
      return { ok: false, code: RESULT.ACCOUNT_NOT_OWNED };
    }

    // Character ownership never silently replaces another live session. Account takeover must
    // displace/clean the old session first, then the new session may claim the character.
    return this._acquire({
      scope: LEASE_SCOPE.CHARACTER,
      key: characterId,
      accountId,
      characterId,
      sessionId,
      serverId,
      allowReplace: false,
    });
  }

  async heartbeat(sessionId) {
    assertNonEmpty(sessionId, 'sessionId');
    const leases = await this.store.listBySession(sessionId);
    const now = this._now();
    let renewed = 0;

    for (const lease of leases) {
      if (lease.state !== 'active' || this._isExpired(lease, now)) continue;
      const next = {
        ...lease,
        heartbeatAt: now,
        leaseUntil: now + this.leaseMs,
      };
      delete next.version;
      const swapped = await this._cas(lease.scope, lease.key, lease.version, next);
      if (swapped.ok) renewed += 1;
    }
    return { ok: true, renewed };
  }

  async disconnect(sessionId, { useGrace = true, reason = 'CLIENT_DISCONNECT' } = {}) {
    assertNonEmpty(sessionId, 'sessionId');
    const leases = await this.store.listBySession(sessionId);
    if (leases.length === 0) return { ok: true, status: 'already-disconnected', affected: 0 };

    const now = this._now();
    let affected = 0;
    for (const lease of leases) {
      if (useGrace && lease.state === 'grace' && !this._isExpired(lease, now)) {
        // Idempotency: a repeated disconnect must not extend the reconnect window.
        continue;
      }
      if (useGrace && this.reconnectGraceMs > 0 && !this._isExpired(lease, now)) {
        const grace = {
          ...lease,
          state: 'grace',
          graceUntil: now + this.reconnectGraceMs,
          leaseUntil: now + this.reconnectGraceMs,
          disconnectReason: reason,
        };
        delete grace.version;
        const swapped = await this._cas(lease.scope, lease.key, lease.version, grace);
        if (swapped.ok) affected += 1;
      } else if (await this._deleteIfCurrent(lease)) {
        affected += 1;
      }
    }
    if (affected === 0) return { ok: true, status: 'already-disconnected', affected: 0 };
    return { ok: true, status: useGrace ? 'grace' : 'released', affected };
  }

  async resumeGrace({ scope, key, previousSessionId, newSessionId, serverId }) {
    if (!Object.values(LEASE_SCOPE).includes(scope)) throw new TypeError('invalid scope');
    assertNonEmpty(key, 'key');
    assertNonEmpty(previousSessionId, 'previousSessionId');
    assertNonEmpty(newSessionId, 'newSessionId');
    assertNonEmpty(serverId, 'serverId');

    for (let attempt = 0; attempt < this.maxCasRetries; attempt += 1) {
      const current = await this.store.get(scope, key);
      const now = this._now();
      if (!current) return { ok: false, code: RESULT.NOT_FOUND };
      if (
        current.state !== 'grace' ||
        current.sessionId !== previousSessionId ||
        current.graceUntil == null ||
        current.graceUntil <= now
      ) {
        return { ok: false, code: RESULT.NOT_RESUMABLE };
      }

      const resumed = {
        ...current,
        sessionId: newSessionId,
        serverId,
        state: 'active',
        heartbeatAt: now,
        leaseUntil: now + this.leaseMs,
        graceUntil: null,
        disconnectReason: null,
      };
      delete resumed.version;
      const swapped = await this._cas(scope, key, current.version, resumed);
      if (swapped.ok) return { ok: true, status: 'resumed', lease: clone(swapped.record) };
    }
    return { ok: false, code: RESULT.CAS_RETRY_EXHAUSTED };
  }

  async _releaseSessionLeases(sessionId, reason, { skipScope = null, skipKey = null, notify = true } = {}) {
    const leases = await this.store.listBySession(sessionId);
    let affected = 0;
    for (const lease of leases) {
      if (lease.scope === skipScope && lease.key === skipKey) continue;
      if (await this._deleteIfCurrent(lease)) affected += 1;
    }
    if (notify && affected > 0) {
      await this.disconnectArbiter.requestDisconnect({ sessionId, reason });
    }
    return affected;
  }

  async revokeSession(sessionId, { reason = 'GM_KICK' } = {}) {
    assertNonEmpty(sessionId, 'sessionId');
    const affected = await this._releaseSessionLeases(sessionId, reason, { notify: false });
    if (affected > 0) {
      await this.disconnectArbiter.requestDisconnect({ sessionId, reason });
      return { ok: true, status: 'revoked', affected };
    }
    return { ok: true, status: 'already-revoked', affected: 0 };
  }

  async revokeAccount(accountId, { reason = 'ACCOUNT_BANNED' } = {}) {
    assertNonEmpty(accountId, 'accountId');
    const account = await this.store.get(LEASE_SCOPE.ACCOUNT, accountId);
    if (!account || this._isExpired(account)) return { ok: true, status: 'no-active-session', affected: 0 };
    const sessionId = account.sessionId;
    const affected = await this._releaseSessionLeases(sessionId, reason, { notify: false });
    if (affected > 0) {
      await this.disconnectArbiter.requestDisconnect({ sessionId, reason, accountId });
    }
    return { ok: true, status: affected > 0 ? 'revoked' : 'already-revoked', affected, sessionId };
  }

  async sweepExpired() {
    const all = await this.store.listAll();
    const now = this._now();
    let removed = 0;
    for (const lease of all) {
      if (this._isExpired(lease, now) && (await this._deleteIfCurrent(lease))) removed += 1;
    }
    return { ok: true, removed };
  }

  async getAccountOwner(accountId) {
    const lease = await this.store.get(LEASE_SCOPE.ACCOUNT, accountId);
    if (!lease || this._isExpired(lease)) return null;
    return clone(lease);
  }

  async getCharacterOwner(characterId) {
    const lease = await this.store.get(LEASE_SCOPE.CHARACTER, characterId);
    if (!lease || this._isExpired(lease)) return null;
    return clone(lease);
  }
}

module.exports = {
  SessionOwnershipService,
  DUPLICATE_LOGIN_POLICY,
  LEASE_SCOPE,
  RESULT,
};
