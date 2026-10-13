import { createPool, hashPassword } from '../index.js';

const environment = process.env.OLDKO_ENV ?? process.env.NODE_ENV ?? 'development';
if (environment === 'production') throw new Error('development seed is disabled in production');
const password = process.env.OLDKO_DEV_SEED_PASSWORD;
if (!password) throw new Error('OLDKO_DEV_SEED_PASSWORD is required; no seed password is hardcoded');

const pool = createPool({ applicationName: 'oldko-dev-seed', max: 1 });
try {
  const passwordHash = await hashPassword(password);
  const { rows } = await pool.query(
    `INSERT INTO oldko.accounts (username, username_key, password_hash, status)
     VALUES ('osevinc', 'osevinc', $1, 'active')
     ON CONFLICT (username_key) DO UPDATE SET password_hash = EXCLUDED.password_hash, updated_at = now()
     RETURNING id, username`, [passwordHash]
  );
  console.log(`development seed ready: ${rows[0].username} (#${rows[0].id})`);
} finally {
  await pool.end();
}
