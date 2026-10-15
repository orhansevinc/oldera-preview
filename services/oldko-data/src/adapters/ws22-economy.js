import { DataConflictError, NotFoundError, ValidationError, withTransaction } from '../index.js';
import { assertPositiveDbId, dbFor, inSerializableTransaction, jsonWithBigInt, parseJsonBigIntTrade } from './shared.js';

const ACTIVE_TRADE = new Set(['pending','open']);

export class PgEconomyTransactionManager {
  constructor(pool) { this.pool = pool; }
  async run(lockKeys, callback) {
    if (!Array.isArray(lockKeys) || typeof callback !== 'function') throw new TypeError('lockKeys and callback are required');
    const keys = [...new Set(lockKeys.map(key => String(key)))].sort();
    return withTransaction(this.pool, async (db) => {
      for (const key of keys) await db.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [key]);
      return callback(db);
    }, { isolationLevel: 'SERIALIZABLE', maxRetries: 3 });
  }
}

export class PgCoinRepository {
  constructor(pool) { this.pool = pool; }
  async getBalance(playerId, { tx } = {}) {
    const id = assertPositiveDbId(playerId, 'playerId');
    const suffix = tx ? ' FOR UPDATE' : '';
    const { rows } = await dbFor(this.pool, tx).query(
      `SELECT gold FROM oldko.character_stats s JOIN oldko.characters c ON c.id=s.character_id
       WHERE s.character_id=$1 AND c.deleted_at IS NULL${suffix}`, [id],
    );
    if (!rows[0]) throw new NotFoundError('coin owner not found');
    return BigInt(rows[0].gold);
  }
  async setBalance(playerId, balance, { tx } = {}) {
    const id = assertPositiveDbId(playerId, 'playerId');
    let amount;
    try { amount = BigInt(balance); } catch { throw new ValidationError('balance must be an integer'); }
    if (amount < 0n || amount > 2_100_000_000n) throw new ValidationError('balance is outside persistence bounds');
    const result = await dbFor(this.pool, tx).query(
      `UPDATE oldko.character_stats SET gold=$2,updated_at=now() WHERE character_id=$1`, [id, amount.toString()],
    );
    if (result.rowCount !== 1) throw new NotFoundError('coin owner not found');
  }
}

export class PgTradeRepository {
  constructor(pool) { this.pool = pool; }

  async create(trade, { tx } = {}) {
    return inSerializableTransaction(this.pool, tx, async (db) => {
      const inviter = assertPositiveDbId(trade.inviterId, 'inviterId');
      const invitee = assertPositiveDbId(trade.inviteeId, 'inviteeId');
      const active = ACTIVE_TRADE.has(trade.status);
      try {
        await db.query(
          `INSERT INTO oldko.economy_trades(id,inviter_character_id,invitee_character_id,status,payload,created_at,updated_at,completed_at)
           VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8)`,
          [trade.id,inviter,invitee,trade.status,jsonWithBigInt(trade),trade.createdAt,trade.updatedAt,trade.completedAt],
        );
        await db.query(
          `INSERT INTO oldko.economy_trade_participants(trade_id,character_id,role,active)
           VALUES($1,$2,'inviter',$4),($1,$3,'invitee',$4)`, [trade.id,inviter,invitee,active],
        );
      } catch (error) {
        if (error?.code === '23505') throw new DataConflictError('trade id or participant already has an active trade', { cause: error });
        throw error;
      }
    });
  }

  async get(tradeId, { tx } = {}) {
    const suffix = tx ? ' FOR UPDATE' : '';
    const { rows } = await dbFor(this.pool, tx).query(
      `SELECT payload FROM oldko.economy_trades WHERE id=$1${suffix}`, [String(tradeId)],
    );
    return rows[0] ? parseJsonBigIntTrade(rows[0].payload) : null;
  }

  async save(trade, { tx } = {}) {
    return inSerializableTransaction(this.pool, tx, async (db) => {
      const active = ACTIVE_TRADE.has(trade.status);
      const result = await db.query(
        `UPDATE oldko.economy_trades SET status=$2,payload=$3::jsonb,updated_at=$4,completed_at=$5,version=version+1
         WHERE id=$1`, [trade.id,trade.status,jsonWithBigInt(trade),trade.updatedAt,trade.completedAt],
      );
      if (result.rowCount !== 1) throw new NotFoundError('trade not found');
      await db.query(`UPDATE oldko.economy_trade_participants SET active=$2 WHERE trade_id=$1`, [trade.id,active]);
    });
  }

  async findActiveByPlayer(playerId, { tx } = {}) {
    const id = assertPositiveDbId(playerId, 'playerId');
    const suffix = tx ? ' FOR UPDATE OF t' : '';
    const { rows } = await dbFor(this.pool, tx).query(
      `SELECT t.payload FROM oldko.economy_trade_participants p
       JOIN oldko.economy_trades t ON t.id=p.trade_id
       WHERE p.character_id=$1 AND p.active=true
       ORDER BY t.created_at DESC LIMIT 1${suffix}`, [id],
    );
    return rows[0] ? parseJsonBigIntTrade(rows[0].payload) : null;
  }
}
