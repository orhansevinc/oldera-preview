import { conflict } from './errors.js';

/**
 * Repository contract expected by AccountService.
 * Production adapters (WS07 integration) must implement the same methods and atomic uniqueness/consume semantics.
 */
export class AccountRepository {
  async createAccount(_account) { throw new Error('Not implemented'); }
  async findByUsernameCanonical(_canonical) { throw new Error('Not implemented'); }
  async findByEmail(_email) { throw new Error('Not implemented'); }
  async findById(_id) { throw new Error('Not implemented'); }
  async updateAccount(_id, _patch) { throw new Error('Not implemented'); }
  async createActionToken(_record) { throw new Error('Not implemented'); }
  async consumeActionToken(_kind, _digest, _now) { throw new Error('Not implemented'); }
  async createSession(_record) { throw new Error('Not implemented'); }
  async findSessionByDigest(_digest, _now) { throw new Error('Not implemented'); }
  async revokeSessionByDigest(_digest, _now) { throw new Error('Not implemented'); }
  async touchSession(_digest, _now) { throw new Error('Not implemented'); }
  async listCharactersByAccount(_accountId) { return []; }
}

export class InMemoryAccountRepository extends AccountRepository {
  constructor() {
    super();
    this.accounts = new Map();
    this.byUsername = new Map();
    this.byEmail = new Map();
    this.actionTokens = new Map();
    this.sessions = new Map();
    this.characters = new Map();
  }

  async createAccount(account) {
    if (this.byUsername.has(account.usernameCanonical)) throw conflict('USERNAME_TAKEN', 'Username is already in use');
    if (this.byEmail.has(account.email)) throw conflict('EMAIL_TAKEN', 'Email is already in use');
    this.accounts.set(account.id, structuredClone(account));
    this.byUsername.set(account.usernameCanonical, account.id);
    this.byEmail.set(account.email, account.id);
    return structuredClone(account);
  }

  async findByUsernameCanonical(canonical) {
    const id = this.byUsername.get(canonical);
    return id ? structuredClone(this.accounts.get(id)) : null;
  }

  async findByEmail(email) {
    const id = this.byEmail.get(email);
    return id ? structuredClone(this.accounts.get(id)) : null;
  }

  async findById(id) {
    const account = this.accounts.get(id);
    return account ? structuredClone(account) : null;
  }

  async updateAccount(id, patch) {
    const current = this.accounts.get(id);
    if (!current) return null;
    const next = { ...current, ...structuredClone(patch) };
    this.accounts.set(id, next);
    return structuredClone(next);
  }

  async createActionToken(record) {
    this.actionTokens.set(`${record.kind}:${record.digest}`, structuredClone(record));
  }

  async consumeActionToken(kind, digest, now) {
    const key = `${kind}:${digest}`;
    const record = this.actionTokens.get(key);
    if (!record || record.consumedAt || record.expiresAt <= now) return null;
    record.consumedAt = now;
    this.actionTokens.set(key, record);
    return structuredClone(record);
  }

  async createSession(record) {
    this.sessions.set(record.digest, structuredClone(record));
    return structuredClone(record);
  }

  async findSessionByDigest(digest, now) {
    const session = this.sessions.get(digest);
    if (!session || session.revokedAt || session.expiresAt <= now) return null;
    return structuredClone(session);
  }

  async revokeSessionByDigest(digest, now) {
    const session = this.sessions.get(digest);
    if (!session || session.revokedAt) return false;
    session.revokedAt = now;
    this.sessions.set(digest, session);
    return true;
  }

  async touchSession(digest, now) {
    const session = this.sessions.get(digest);
    if (!session || session.revokedAt || session.expiresAt <= now) return false;
    session.lastSeenAt = now;
    this.sessions.set(digest, session);
    return true;
  }

  async listCharactersByAccount(accountId) {
    return structuredClone(this.characters.get(accountId) || []);
  }
}
