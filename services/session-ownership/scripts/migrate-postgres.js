'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { Pool } = require('pg');

async function main() {
  if (!process.env.DATABASE_URL && !process.env.PGHOST) {
    throw new Error('DATABASE_URL or standard PG* environment is required');
  }

  const sqlPath = path.resolve(__dirname, '../sql/0001_postgres_lease_store.sql');
  const sql = await fs.readFile(sqlPath, 'utf8');
  const pool = new Pool(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {});
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    process.stdout.write('WS45 PostgreSQL lease-store migration applied.\n');
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve original error; never log connection configuration.
    }
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  process.stderr.write(`WS45 migration failed: ${error.message}\n`);
  process.exitCode = 1;
});
