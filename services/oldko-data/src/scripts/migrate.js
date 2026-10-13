import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool } from '../index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, '../../../../database/migrations');
const pool = createPool({ applicationName: 'oldko-migrator', max: 1 });
const client = await pool.connect();

try {
  await client.query(`CREATE TABLE IF NOT EXISTS public._oldko_migrations (
    name text PRIMARY KEY,
    checksum text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  await client.query(`SELECT pg_advisory_lock(hashtext('oldko:migrations'))`);

  const { createHash } = await import('node:crypto');
  const files = (await readdir(migrationsDir)).filter(name => /^\d+_.*\.sql$/.test(name)).sort();
  for (const name of files) {
    const sql = await readFile(path.join(migrationsDir, name), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const existing = await client.query(`SELECT checksum FROM public._oldko_migrations WHERE name = $1`, [name]);
    if (existing.rows[0]) {
      if (existing.rows[0].checksum !== checksum) throw new Error(`migration checksum changed after apply: ${name}`);
      continue;
    }
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query(`INSERT INTO public._oldko_migrations (name, checksum) VALUES ($1, $2)`, [name, checksum]);
      await client.query('COMMIT');
      console.log(`applied ${name}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
} finally {
  try { await client.query(`SELECT pg_advisory_unlock(hashtext('oldko:migrations'))`); } catch {}
  client.release();
  await pool.end();
}
