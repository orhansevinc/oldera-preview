import pg from 'pg';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.OLDKO_DB_SSL === 'require' ? { rejectUnauthorized: true } : undefined,
  max: 1,
  application_name: 'oldko-account-rate-limit-schema-check'
});

try {
  const migration = await pool.query(
    `SELECT name FROM public._oldko_migrations WHERE name='0005_phase2_data_admin.sql'`,
  );
  if (!migration.rows[0]) {
    throw new Error('P2-11 canonical migration 0005_phase2_data_admin.sql is required; independent WS13 schema mutation is disabled');
  }
  const table = await pool.query(`SELECT to_regclass('oldko.account_rate_limits') AS name`);
  if (!table.rows[0]?.name) throw new Error('canonical migration ledger is present but oldko.account_rate_limits is missing');
  console.log('WS13 rate-limit schema verified from the canonical P2-11 migration ledger; no mutation performed');
} finally {
  await pool.end();
}
