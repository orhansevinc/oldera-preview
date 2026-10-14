import crypto from 'node:crypto';
import pg from 'pg';

function bucketHash(key) {
  return crypto.createHash('sha256').update(String(key), 'utf8').digest('hex');
}

function resultShape(count, resetAt, limit, now) {
  const resetMs = new Date(resetAt).getTime();
  return {
    allowed: Number(count) < limit,
    remaining: Math.max(0, limit - Number(count)),
    retryAfterSeconds: Math.max(1, Math.ceil((resetMs - now) / 1000))
  };
}

export class PostgresRateLimitStore {
  constructor({ env = process.env, pool = null } = {}) {
    this.kind = 'postgres';
    this.ownsPool = !pool;
    if (pool) {
      this.pool = pool;
      return;
    }
    if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required for PostgreSQL rate limiting');
    this.pool = new pg.Pool({
      connectionString: env.DATABASE_URL,
      ssl: env.OLDKO_DB_SSL === 'require' ? { rejectUnauthorized: true } : undefined,
      max: env.NODE_ENV === 'production' ? 10 : 3,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      statement_timeout: 10_000,
      application_name: 'oldko-account-rate-limit'
    });
  }

  async check(key, limit, _windowMs, now = Date.now()) {
    const { rows } = await this.pool.query(
      `SELECT count, reset_at FROM oldko.account_rate_limits WHERE bucket_hash=$1`,
      [bucketHash(key)]
    );
    const row = rows[0];
    if (!row || new Date(row.reset_at).getTime() <= now) {
      return { allowed: true, remaining: limit, retryAfterSeconds: 1 };
    }
    return resultShape(row.count, row.reset_at, limit, now);
  }

  async consume(key, limit, windowMs, now = Date.now()) {
    const { rows } = await this.pool.query(`
      INSERT INTO oldko.account_rate_limits(bucket_hash,count,reset_at,updated_at)
      VALUES($1,1,$2,$3)
      ON CONFLICT (bucket_hash) DO UPDATE SET
        count=CASE
          WHEN oldko.account_rate_limits.reset_at <= EXCLUDED.updated_at THEN 1
          ELSE oldko.account_rate_limits.count + 1
        END,
        reset_at=CASE
          WHEN oldko.account_rate_limits.reset_at <= EXCLUDED.updated_at THEN EXCLUDED.reset_at
          ELSE oldko.account_rate_limits.reset_at
        END,
        updated_at=EXCLUDED.updated_at
      RETURNING count,reset_at`, [bucketHash(key), new Date(now + windowMs), new Date(now)]);
    const row = rows[0];
    const resetMs = new Date(row.reset_at).getTime();
    const count = Number(row.count);
    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      retryAfterSeconds: Math.max(1, Math.ceil((resetMs - now) / 1000))
    };
  }

  async reset(key) {
    await this.pool.query(`DELETE FROM oldko.account_rate_limits WHERE bucket_hash=$1`, [bucketHash(key)]);
  }

  async ready() {
    const { rows } = await this.pool.query(`SELECT to_regclass('oldko.account_rate_limits') IS NOT NULL AS present`);
    if (rows[0]?.present !== true) throw new Error('oldko.account_rate_limits migration is missing');
    await this.pool.query('SELECT 1');
    return true;
  }

  async close() {
    if (this.ownsPool) await this.pool.end();
  }
}
