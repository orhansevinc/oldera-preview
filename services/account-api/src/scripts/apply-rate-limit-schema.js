import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const here = path.dirname(fileURLToPath(import.meta.url));
const sqlPath = path.resolve(here, '../../sql/0001_postgres_rate_limit.sql');
const sql = await fs.readFile(sqlPath, 'utf8');
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.OLDKO_DB_SSL === 'require' ? { rejectUnauthorized: true } : undefined,
  max: 1,
  application_name: 'oldko-account-rate-limit-migrate'
});
try {
  await pool.query(sql);
  console.log('WS13 PostgreSQL rate-limit schema applied');
} finally {
  await pool.end();
}
