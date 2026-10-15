import { ValidationError } from '../index.js';

export class PgWs45LeaseStore {
  constructor(pool) { this.pool = pool; }

  async get(scope, key) {
    const { rows } = await this.pool.query(`SELECT * FROM oldko.session_leases WHERE scope=$1 AND lease_key=$2`, [scope,String(key)]);
    return rows[0] ? fromRow(rows[0]) : null;
  }

  async compareAndSet(scope, key, expectedVersion, nextRecord) {
    validateScope(scope);
    const leaseKey = String(key);
    if (nextRecord == null) {
      if (expectedVersion == null) return { ok: true, record: null };
      const deleted = await this.pool.query(
        `DELETE FROM oldko.session_leases WHERE scope=$1 AND lease_key=$2 AND version=$3 RETURNING version`,
        [scope,leaseKey,Number(expectedVersion)],
      );
      if (deleted.rowCount === 1) return { ok: true, record: null };
      return { ok: false, record: await this.get(scope, leaseKey) };
    }
    validateRecord(nextRecord);
    if (expectedVersion == null) {
      const inserted = await this.pool.query(
        `INSERT INTO oldko.session_leases
          (scope,lease_key,session_id,server_id,state,account_id,character_id,generation,acquired_at,heartbeat_at,lease_until,grace_until,replaced_session_id,version,payload)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,1,$14::jsonb)
         ON CONFLICT (scope,lease_key) DO NOTHING RETURNING *`,
        values(scope,leaseKey,nextRecord,JSON.stringify(nextRecord)),
      );
      if (inserted.rows[0]) return { ok: true, record: fromRow(inserted.rows[0]) };
      return { ok: false, record: await this.get(scope, leaseKey) };
    }
    const version = Number(expectedVersion);
    const updated = await this.pool.query(
      `UPDATE oldko.session_leases SET session_id=$3,server_id=$4,state=$5,account_id=$6,character_id=$7,generation=$8,
         acquired_at=$9,heartbeat_at=$10,lease_until=$11,grace_until=$12,replaced_session_id=$13,version=version+1,
         payload=$14::jsonb,updated_at=now()
       WHERE scope=$1 AND lease_key=$2 AND version=$15 RETURNING *`,
      [...values(scope,leaseKey,nextRecord,JSON.stringify(nextRecord)),version],
    );
    if (updated.rows[0]) return { ok: true, record: fromRow(updated.rows[0]) };
    return { ok: false, record: await this.get(scope, leaseKey) };
  }

  async listBySession(sessionId) {
    const { rows } = await this.pool.query(`SELECT * FROM oldko.session_leases WHERE session_id=$1 ORDER BY scope,lease_key`, [String(sessionId)]);
    return rows.map(fromRow);
  }

  async listAll() {
    const { rows } = await this.pool.query(`SELECT * FROM oldko.session_leases ORDER BY scope,lease_key`);
    return rows.map(fromRow);
  }
}

function values(scope,key,r,payload) {
  return [scope,key,r.sessionId,r.serverId,r.state,r.accountId,r.characterId??null,r.generation,r.acquiredAt,r.heartbeatAt,r.leaseUntil,r.graceUntil??null,r.replacedSessionId??null,payload];
}
function fromRow(row) {
  return {
    ...(row.payload ?? {}), scope: row.scope, key: row.lease_key, sessionId: row.session_id, serverId: row.server_id, state: row.state,
    accountId: row.account_id, characterId: row.character_id, generation: Number(row.generation), acquiredAt: Number(row.acquired_at),
    heartbeatAt: Number(row.heartbeat_at), leaseUntil: Number(row.lease_until), graceUntil: row.grace_until == null ? null : Number(row.grace_until),
    replacedSessionId: row.replaced_session_id, version: Number(row.version),
  };
}
function validateScope(scope) { if (scope !== 'account' && scope !== 'character') throw new ValidationError('invalid lease scope'); }
function validateRecord(r) {
  for (const k of ['sessionId','serverId','state','accountId']) if (typeof r[k] !== 'string' || !r[k]) throw new ValidationError(`lease ${k} is required`);
  if (!['active','grace'].includes(r.state)) throw new ValidationError('invalid lease state');
  for (const k of ['generation','acquiredAt','heartbeatAt','leaseUntil']) if (!Number.isFinite(Number(r[k]))) throw new ValidationError(`lease ${k} is invalid`);
}
