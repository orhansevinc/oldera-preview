'use strict';

const DEFAULT_SCHEMA = 'oldko';
const DEFAULT_TABLE = 'session_leases';

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function assertIdentifier(value, name) {
  if (typeof value !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new TypeError(`${name} must be a simple PostgreSQL identifier`);
  }
}

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

function toNumber(value) {
  return value == null ? null : Number(value);
}

function rowToLease(row) {
  if (!row) return null;
  const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
  const lease = {
    scope: row.scope,
    key: row.lease_key,
    accountId: row.account_id,
    characterId: row.character_id,
    sessionId: row.session_id,
    serverId: row.server_id,
    state: row.state,
    generation: toNumber(row.generation),
    acquiredAt: toNumber(row.acquired_at),
    heartbeatAt: toNumber(row.heartbeat_at),
    leaseUntil: toNumber(row.lease_until),
    graceUntil: toNumber(row.grace_until),
    replacedSessionId: row.replaced_session_id,
    version: toNumber(row.version),
  };
  if (Object.hasOwn(payload, 'disconnectReason')) {
    lease.disconnectReason = payload.disconnectReason;
  }
  return lease;
}

function recordPayload(record) {
  if (record && record.disconnectReason != null) {
    return { disconnectReason: String(record.disconnectReason) };
  }
  return {};
}

function assertLeaseRecord(scope, key, record) {
  if (!record || typeof record !== 'object') throw new TypeError('nextRecord must be an object');
  if (record.scope !== scope || record.key !== key) {
    throw new TypeError('nextRecord scope/key must match compare-and-set target');
  }
  for (const [name, value] of [
    ['accountId', record.accountId],
    ['sessionId', record.sessionId],
    ['serverId', record.serverId],
    ['state', record.state],
  ]) {
    if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${name} must be a non-empty string`);
  }
  for (const [name, value] of [
    ['generation', record.generation],
    ['acquiredAt', record.acquiredAt],
    ['heartbeatAt', record.heartbeatAt],
    ['leaseUntil', record.leaseUntil],
  ]) {
    if (!Number.isFinite(value)) throw new TypeError(`${name} must be a finite number`);
  }
}

class PostgresLeaseStore {
  constructor({ pool, ownsPool = false, schema = DEFAULT_SCHEMA, table = DEFAULT_TABLE } = {}) {
    if (!pool || typeof pool.query !== 'function' || typeof pool.connect !== 'function') {
      throw new TypeError('pool must implement query() and connect()');
    }
    assertIdentifier(schema, 'schema');
    assertIdentifier(table, 'table');
    this.pool = pool;
    this.ownsPool = ownsPool;
    this.schema = schema;
    this.table = table;
    this.tableSql = `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
  }

  async _transaction(fn) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Preserve the original failure. No connection string or secret is logged here.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  _values(record) {
    return [
      record.sessionId,
      record.serverId,
      record.state,
      record.accountId,
      record.characterId ?? null,
      record.generation,
      record.acquiredAt,
      record.heartbeatAt,
      record.leaseUntil,
      record.graceUntil ?? null,
      record.replacedSessionId ?? null,
      JSON.stringify(recordPayload(record)),
    ];
  }

  async get(scope, key) {
    const { rows } = await this.pool.query(
      `SELECT * FROM ${this.tableSql} WHERE scope = $1 AND lease_key = $2`,
      [scope, key],
    );
    return clone(rowToLease(rows[0] || null));
  }

  async read(scope, key) {
    return this.get(scope, key);
  }

  async _current(client, scope, key) {
    const { rows } = await client.query(
      `SELECT * FROM ${this.tableSql} WHERE scope = $1 AND lease_key = $2`,
      [scope, key],
    );
    return rowToLease(rows[0] || null);
  }

  async compareAndSet(scope, key, expectedVersion, nextRecord) {
    if (expectedVersion === null) {
      if (nextRecord == null) {
        return this._transaction(async (client) => {
          const current = await this._current(client, scope, key);
          return current ? { ok: false, record: clone(current) } : { ok: true, record: null };
        });
      }

      assertLeaseRecord(scope, key, nextRecord);
      const values = this._values(nextRecord);
      return this._transaction(async (client) => {
        const { rows } = await client.query(
          `INSERT INTO ${this.tableSql} (
             scope, lease_key, session_id, server_id, state, account_id, character_id,
             generation, acquired_at, heartbeat_at, lease_until, grace_until,
             replaced_session_id, payload, version, updated_at
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7,
             $8, $9, $10, $11, $12, $13, $14::jsonb, 1, now()
           )
           ON CONFLICT (scope, lease_key) DO NOTHING
           RETURNING *`,
          [scope, key, ...values],
        );
        if (rows.length === 1) return { ok: true, record: clone(rowToLease(rows[0])) };
        return { ok: false, record: clone(await this._current(client, scope, key)) };
      });
    }

    if (!Number.isInteger(expectedVersion) || expectedVersion <= 0) {
      throw new TypeError('expectedVersion must be null or a positive integer');
    }

    if (nextRecord == null) {
      return this._transaction(async (client) => {
        const { rows } = await client.query(
          `DELETE FROM ${this.tableSql}
           WHERE scope = $1 AND lease_key = $2 AND version = $3
           RETURNING *`,
          [scope, key, expectedVersion],
        );
        if (rows.length === 1) return { ok: true, record: null };
        return { ok: false, record: clone(await this._current(client, scope, key)) };
      });
    }

    assertLeaseRecord(scope, key, nextRecord);
    const values = this._values(nextRecord);
    return this._transaction(async (client) => {
      const { rows } = await client.query(
        `WITH previous AS (
           SELECT session_id, generation
           FROM ${this.tableSql}
           WHERE scope = $1 AND lease_key = $2 AND version = $3
           FOR UPDATE
         )
         UPDATE ${this.tableSql} AS leases
         SET session_id = $4,
             server_id = $5,
             state = $6,
             account_id = $7,
             character_id = $8,
             generation = $9,
             acquired_at = $10,
             heartbeat_at = $11,
             lease_until = $12,
             grace_until = $13,
             replaced_session_id = $14,
             payload = $15::jsonb,
             version = leases.version + 1,
             updated_at = now()
         FROM previous
         WHERE leases.scope = $1 AND leases.lease_key = $2 AND leases.version = $3
         RETURNING leases.*, previous.session_id AS _previous_session_id,
                   previous.generation AS _previous_generation`,
        [scope, key, expectedVersion, ...values],
      );
      if (rows.length !== 1) {
        return { ok: false, record: clone(await this._current(client, scope, key)) };
      }

      const row = rows[0];
      const previousSessionId = row._previous_session_id;
      const previousGeneration = Number(row._previous_generation);
      const accountOwnerChanged =
        scope === 'account' &&
        previousSessionId !== nextRecord.sessionId &&
        (nextRecord.replacedSessionId === previousSessionId || nextRecord.generation > previousGeneration);

      if (accountOwnerChanged) {
        await client.query(
          `DELETE FROM ${this.tableSql}
           WHERE scope = 'character' AND session_id = $1`,
          [previousSessionId],
        );
      }

      return { ok: true, record: clone(rowToLease(row)) };
    });
  }

  async acquire(scope, key, nextRecord) {
    return this.compareAndSet(scope, key, null, nextRecord);
  }

  async renew(scope, key, expectedVersion, nextRecord) {
    return this.compareAndSet(scope, key, expectedVersion, nextRecord);
  }

  async release(scope, key, expectedVersion) {
    return this.compareAndSet(scope, key, expectedVersion, null);
  }

  async replace(scope, key, expectedVersion, nextRecord) {
    return this.compareAndSet(scope, key, expectedVersion, nextRecord);
  }

  async reclaimExpired(scope, key, expectedVersion, nextRecord, nowMs = Date.now()) {
    assertLeaseRecord(scope, key, nextRecord);
    if (!Number.isInteger(expectedVersion) || expectedVersion <= 0) {
      throw new TypeError('expectedVersion must be a positive integer');
    }
    if (!Number.isFinite(nowMs)) throw new TypeError('nowMs must be finite');

    const values = this._values(nextRecord);
    return this._transaction(async (client) => {
      const { rows } = await client.query(
        `WITH previous AS (
           SELECT session_id, generation
           FROM ${this.tableSql}
           WHERE scope = $1 AND lease_key = $2 AND version = $3 AND lease_until <= $16
           FOR UPDATE
         )
         UPDATE ${this.tableSql} AS leases
         SET session_id = $4,
             server_id = $5,
             state = $6,
             account_id = $7,
             character_id = $8,
             generation = $9,
             acquired_at = $10,
             heartbeat_at = $11,
             lease_until = $12,
             grace_until = $13,
             replaced_session_id = $14,
             payload = $15::jsonb,
             version = leases.version + 1,
             updated_at = now()
         FROM previous
         WHERE leases.scope = $1 AND leases.lease_key = $2 AND leases.version = $3
         RETURNING leases.*, previous.session_id AS _previous_session_id`,
        [scope, key, expectedVersion, ...values, nowMs],
      );
      if (rows.length !== 1) {
        return { ok: false, record: clone(await this._current(client, scope, key)) };
      }

      if (scope === 'account' && rows[0]._previous_session_id !== nextRecord.sessionId) {
        await client.query(
          `DELETE FROM ${this.tableSql}
           WHERE scope = 'character' AND session_id = $1`,
          [rows[0]._previous_session_id],
        );
      }
      return { ok: true, record: clone(rowToLease(rows[0])) };
    });
  }

  async listBySession(sessionId) {
    const { rows } = await this.pool.query(
      `SELECT * FROM ${this.tableSql} WHERE session_id = $1 ORDER BY scope, lease_key`,
      [sessionId],
    );
    return rows.map((row) => clone(rowToLease(row)));
  }

  async listAll() {
    const { rows } = await this.pool.query(
      `SELECT * FROM ${this.tableSql} ORDER BY scope, lease_key`,
    );
    return rows.map((row) => clone(rowToLease(row)));
  }

  async close() {
    if (this.ownsPool && this.pool && typeof this.pool.end === 'function') {
      await this.pool.end();
    }
  }
}

function createPostgresLeaseStore({
  pool = null,
  connectionString = process.env.DATABASE_URL,
  schema = DEFAULT_SCHEMA,
  table = DEFAULT_TABLE,
  poolOptions = {},
} = {}) {
  if (pool) return new PostgresLeaseStore({ pool, ownsPool: false, schema, table });

  // Lazy load keeps the in-memory adapter/tests usable without installing pg.
  // Production/real-Postgres CI installs the service dependency explicitly.
  const { Pool } = require('pg');
  const config = connectionString ? { connectionString, ...poolOptions } : { ...poolOptions };
  const ownedPool = new Pool(config);
  return new PostgresLeaseStore({ pool: ownedPool, ownsPool: true, schema, table });
}

module.exports = {
  PostgresLeaseStore,
  createPostgresLeaseStore,
  DEFAULT_SCHEMA,
  DEFAULT_TABLE,
};
