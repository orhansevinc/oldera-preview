'use strict';

const path = require('node:path');
const { pathToFileURL } = require('node:url');

const PINNED_WS07_SOURCE = 'eaac4700c3535c449f6a2b7d20c925bc61382c35';

function moduleUrl(relativePath) {
  return pathToFileURL(path.resolve(__dirname, relativePath)).href;
}

function normalizeUsers(env) {
  const raw = JSON.parse(env.ADMIN_USERS_JSON || '[]');
  if (!Array.isArray(raw) || !raw.length) throw new Error('ADMIN_USERS_JSON must contain at least one explicit admin identity');
  const rootOwnerId = String(env.ADMIN_ROOT_OWNER_ID || '');
  if (!rootOwnerId) throw new Error('ADMIN_ROOT_OWNER_ID is required');
  let rootMatches = 0;
  return raw.map((user) => {
    const id = String(user.id || '').trim();
    const username = String(user.username || '').trim();
    if (!id || !username || !user.passwordHash) throw new Error('Every admin identity requires id, username and passwordHash');
    const roles = new Set((user.roles || []).map((role) => String(role).toUpperCase()));
    roles.delete('OWNER');
    if (id === rootOwnerId) { roles.add('OWNER'); rootMatches += 1; }
    return { id, username, passwordHash: String(user.passwordHash), roles: [...roles], enabled: true };
  }).map((user, index, all) => {
    if (index === all.length - 1 && rootMatches !== 1) throw new Error('ADMIN_ROOT_OWNER_ID must match exactly one configured admin identity');
    return user;
  });
}

function conflict(message, code = 'VERSION_CONFLICT') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function upperStatus(status, lastError) {
  const value = String(status || '').toLowerCase();
  if (value === 'succeeded') return 'SUCCEEDED';
  if (value === 'failed' && String(lastError || '').startsWith('UNSUPPORTED:')) return 'UNSUPPORTED';
  if (value === 'failed') return 'FAILED';
  if (value === 'cancelled') return 'FAILED';
  return 'PENDING';
}

function lowerStatus(status) {
  const value = String(status || '').toUpperCase();
  if (value === 'SUCCEEDED') return 'succeeded';
  if (value === 'FAILED' || value === 'UNSUPPORTED') return 'failed';
  return 'pending';
}

function commandEnvelope(row) {
  if (!row) return null;
  const result = (() => {
    if (!row.last_error) return null;
    try { return JSON.parse(row.last_error); } catch { return { message: row.last_error }; }
  })();
  const status = upperStatus(row.status, row.last_error);
  return {
    id: row.id,
    status,
    command: row.command,
    target: row.target,
    arg: row.arg,
    requestedBy: row.requested_by,
    traceId: row.trace_id,
    source: row.source,
    attemptCount: Number(row.attempt_count || 0),
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
    result,
  };
}

class Ws08PgCompatibilityRepository {
  constructor(delegate) {
    this.delegate = delegate;
    this.db = delegate.db;
  }

  async transaction(work) {
    return this.delegate.transaction((tx) => work(new Ws08PgCompatibilityRepository(tx)));
  }

  overview(input) { return this.delegate.overview(input); }
  listPlayers(input) { return this.delegate.listPlayers(input); }
  async getCharacter(name) {
    const value = await this.delegate.getCharacter(name);
    if (!value) return null;
    return { ...value, version: Number(value.versions?.progression || value.versions?.world || 1) };
  }
  getInventory(name) { return this.delegate.getInventory(name); }
  getInn(name) { return this.delegate.getInn(name); }
  getTransactions(name) { return this.delegate.getTransactions(name); }
  getSanctions(name) { return this.delegate.getSanctions(name); }
  searchItems(query) { return this.delegate.searchItems(query); }
  itemHistory(serial) { return this.delegate.itemHistory(serial); }
  findDuplicateSerials() { return this.delegate.findDuplicateSerials(); }

  async assertVersion(name, expectedVersion, scope) {
    if (expectedVersion == null) return;
    const expected = Number(expectedVersion);
    const { rows } = await this.db.query(
      `SELECT c.world_version,c.item_version,s.progression_version
         FROM oldko.characters c
         JOIN oldko.character_stats s ON s.character_id=c.id
        WHERE c.name_key=lower($1) AND c.deleted_at IS NULL
        FOR UPDATE OF c,s`,
      [String(name)],
    );
    if (!rows[0]) return;
    const actual = scope === 'world' ? Number(rows[0].world_version)
      : scope === 'items' ? Number(rows[0].item_version)
      : Number(rows[0].progression_version);
    if (actual !== expected) throw conflict(`expectedVersion ${expected} does not match ${scope} version ${actual}`);
  }

  async updateCharacter(name, patch, options = {}) {
    const scope = Object.hasOwn(patch || {}, 'zone') && !['level', 'np', 'coin'].some((key) => Object.hasOwn(patch || {}, key)) ? 'world' : 'progression';
    await this.assertVersion(name, options.expectedVersion, scope);
    const value = await this.delegate.updateCharacter(name, patch);
    if (!value) return null;
    const version = scope === 'world' ? value.versions?.world : value.versions?.progression;
    return { ...value, version: Number(version || 1) };
  }

  async updateStats(name, patch, options = {}) {
    await this.assertVersion(name, options.expectedVersion, 'progression');
    const value = await this.delegate.updateStats(name, patch);
    return value ? { ...value, version: Number(value.versions?.progression || 1) } : null;
  }

  async updateSkills(name, patch, options = {}) {
    await this.assertVersion(name, options.expectedVersion, 'progression');
    const value = await this.delegate.updateSkills(name, patch);
    return value ? { ...value, version: Number(value.versions?.progression || 1) } : null;
  }

  itemAction(serial, action) { return this.delegate.itemAction(serial, action); }
  createSanction(input) { return this.delegate.createSanction(input); }
  removeSanction(input) { return this.delegate.removeSanction(input); }
  appendAudit(entry) {
    return this.delegate.appendAudit({
      ...entry,
      target: entry.target ?? entry.targetId ?? null,
      traceId: entry.traceId ?? entry.requestId ?? null,
      source: entry.source ?? entry.sourceIp ?? null,
    });
  }
  listAudit(limit) { return this.delegate.listAudit(limit); }

  async createAdminSession(input) {
    return this.delegate.createAdminSession({
      actorId: input.userId ?? input.actorId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      sourceIp: input.sourceIp ?? null,
      userAgent: input.userAgent ?? null,
    });
  }

  async getAdminSession(tokenHash) {
    const row = await this.delegate.getAdminSessionByTokenHash(tokenHash);
    if (!row) return null;
    return { ...row, userId: row.actorId };
  }

  revokeAdminSession(id) { return this.delegate.revokeAdminSession(id); }

  async runIdempotent({ key, actorId, kind, fingerprint = null }, work) {
    const request = { kind, fingerprint };
    let reserved;
    try {
      reserved = await this.delegate.reserveAdminOperation({ actorId, idempotencyKey: key, request });
    } catch (error) {
      if (error?.code === 'OLDKO_DATA_CONFLICT') throw conflict(error.message, 'IDEMPOTENCY_CONFLICT');
      throw error;
    }
    if (reserved.duplicate) {
      if (reserved.state === 'completed') return { replayed: true, value: reserved.response };
      if (reserved.state === 'reserved') throw conflict('idempotent operation is already in progress', 'IDEMPOTENCY_IN_PROGRESS');
      throw conflict('previous idempotent operation failed', 'IDEMPOTENCY_PREVIOUSLY_FAILED');
    }
    try {
      const value = await work();
      await this.delegate.completeAdminOperation({ actorId, idempotencyKey: key, response: value });
      return { replayed: false, value };
    } catch (error) {
      await this.delegate.completeAdminOperation({ actorId, idempotencyKey: key, response: { error: error?.code || 'FAILED' }, failed: true }).catch(() => {});
      throw error;
    }
  }

  async enqueueCommand(command) {
    const args = command.args || {};
    const target = command.target || args.playerId || args.accountId || '';
    const arg = command.arg || args.toPlayerId || args.message || (Object.keys(args).length ? JSON.stringify(args) : '');
    const row = await this.delegate.enqueueCommand({
      command: command.canonicalCommand || command.legacyCommand || command.command || 'UNKNOWN',
      target: String(target || ''),
      arg: String(arg || '').slice(0, 500),
      requestedBy: command.requestedBy || 'unknown',
      traceId: command.requestId || command.traceId,
      source: command.source || 'ws08-admin-v10',
    });
    if (String(command.status || '').toUpperCase() === 'UNSUPPORTED') {
      return this.updateCommand(row.id, { status: 'UNSUPPORTED', result: { code: command.errorCode || 'UNSUPPORTED_LEGACY_COMMAND' } });
    }
    return { ...row, status: 'PENDING' };
  }

  async updateCommand(id, patch = {}) {
    const status = lowerStatus(patch.status);
    const storedResult = patch.status === 'UNSUPPORTED'
      ? `UNSUPPORTED:${JSON.stringify(patch.result || {})}`
      : patch.result == null ? null : JSON.stringify(patch.result);
    const { rows } = await this.db.query(
      `UPDATE oldko.admin_command_outbox
          SET status=$2,
              completed_at=CASE WHEN $2 IN ('succeeded','failed','cancelled') THEN COALESCE(completed_at,now()) ELSE completed_at END,
              last_error=$3,
              updated_at=now()
        WHERE id=$1
        RETURNING *`,
      [id, status, storedResult],
    );
    return commandEnvelope(rows[0] || null);
  }

  async getCommand(id) {
    const { rows } = await this.db.query(`SELECT * FROM oldko.admin_command_outbox WHERE id=$1`, [id]);
    return commandEnvelope(rows[0] || null);
  }
}

async function createAdminRepository({ env = process.env } = {}) {
  const [{ createPool }, { PgWs08AdminRepository }] = await Promise.all([
    import(moduleUrl('../../oldko-data/src/index.js')),
    import(moduleUrl('../../oldko-data/src/adapters/ws08-admin.js')),
  ]);
  const pool = createPool({ connectionString: env.DATABASE_URL, applicationName: 'ws08-admin-api', max: Number(env.ADMIN_DB_POOL_MAX || 10) });
  const delegate = new PgWs08AdminRepository(pool);
  for (const user of normalizeUsers(env)) await delegate.upsertAdminActor(user);
  const repository = new Ws08PgCompatibilityRepository(delegate);
  repository.close = () => pool.end();
  repository.ws07SourceCommit = PINNED_WS07_SOURCE;
  return repository;
}

module.exports = { PINNED_WS07_SOURCE, Ws08PgCompatibilityRepository, createAdminRepository };
