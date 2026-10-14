import { ValidationError, withTransaction } from '../index.js';

export class PgOperationReceiptRepository {
  constructor(pool) { this.pool = pool; }
  async runOnce({ operationId, kind, actorAccountId = null, characterId = null, metadata = {} }, work) {
    if (typeof operationId !== 'string' || !operationId || operationId.length > 128) throw new ValidationError('operationId is invalid');
    if (typeof kind !== 'string' || !kind || kind.length > 64) throw new ValidationError('operation kind is invalid');
    if (typeof work !== 'function') throw new TypeError('work must be a function');
    return withTransaction(this.pool, async (db) => {
      const reserved = await db.query(
        `INSERT INTO oldko.persistence_operations(operation_id,kind,actor_account_id,character_id,metadata)
         VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT (operation_id) DO NOTHING RETURNING operation_id`,
        [operationId,kind,actorAccountId,characterId,JSON.stringify(metadata)],
      );
      if (reserved.rowCount === 0) {
        const existing = await db.query(
          `SELECT operation_id,kind,committed_at,metadata FROM oldko.persistence_operations WHERE operation_id=$1`, [operationId],
        );
        return { duplicate: true, receipt: existing.rows[0] ?? null };
      }
      const value = await work(db);
      const { rows } = await db.query(
        `UPDATE oldko.persistence_operations SET committed_at=now() WHERE operation_id=$1
         RETURNING operation_id,kind,committed_at,metadata`, [operationId],
      );
      return { duplicate: false, value, receipt: rows[0] };
    }, { isolationLevel: 'SERIALIZABLE', maxRetries: 3 });
  }
}
