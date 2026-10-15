import { createPool, hashPassword } from '../../services/oldko-data/src/index.js';

if (process.env.OLDKOWEB_QA_ALLOW_SEED !== '1') throw new Error('OLDKOWEB_QA_ALLOW_SEED=1 is required');
const username = String(process.env.OLDKOWEB_QA_USER || 'p2e2e').trim();
const password = String(process.env.OLDKOWEB_QA_PASSWORD || 'p2e2epass');
if (!/^[A-Za-z][A-Za-z0-9_]{3,19}$/.test(username)) throw new Error('QA username violates game identity contract');
const pool = createPool({ applicationName: 'p2-00-controlled-qa-seed' });
try {
  const passwordHash = await hashPassword(password);
  await pool.query('BEGIN');
  const existing = await pool.query('SELECT id FROM oldko.accounts WHERE username_key=lower($1) FOR UPDATE', [username]);
  if (existing.rowCount) throw new Error(`controlled QA account already exists: ${username}; refusing to touch existing data`);
  await pool.query(
    `INSERT INTO oldko.accounts(username,username_key,password_hash,email,status,nation,verified_at)
     VALUES($1,lower($1),$2,$3,'active',0,now())`,
    [username, passwordHash, `${username}@example.invalid`],
  );
  await pool.query('COMMIT');
  console.log(JSON.stringify({ event: 'controlled-qa-account-created', username, existing_player_data_touched: false }));
} catch (error) {
  try { await pool.query('ROLLBACK'); } catch {}
  throw error;
} finally {
  await pool.end();
}
