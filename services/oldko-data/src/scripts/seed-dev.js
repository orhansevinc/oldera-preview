import { createPool, hashPassword, withTransaction } from '../index.js';

const environment = process.env.OLDKO_ENV ?? process.env.NODE_ENV ?? 'development';
if (environment === 'production') throw new Error('development seed is disabled in production');
const password = process.env.OLDKO_DEV_SEED_PASSWORD;
if (!password) throw new Error('OLDKO_DEV_SEED_PASSWORD is required; no seed password is hardcoded');

const pool = createPool({ applicationName: 'oldko-dev-seed', max: 1 });
try {
  const passwordHash = await hashPassword(password);
  const result = await withTransaction(pool, async (db) => {
    const accountResult = await db.query(
      `INSERT INTO oldko.accounts(username,username_key,password_hash,status,nation)
       VALUES('ws07test','ws07test',$1,'active',1)
       ON CONFLICT (username_key) DO UPDATE SET password_hash=EXCLUDED.password_hash,status='active',nation=1,updated_at=now()
       RETURNING id,username`, [passwordHash],
    );
    const account = accountResult.rows[0];
    let character = (await db.query(
      `SELECT id,name FROM oldko.characters WHERE account_id=$1 AND slot=0 AND deleted_at IS NULL`, [account.id],
    )).rows[0];
    if (!character) {
      character = (await db.query(
        `INSERT INTO oldko.characters(account_id,slot,name,name_key,nation,race,class_id,zone_id,pos_x,pos_y,pos_z,world_state)
         VALUES($1,0,'WS07Hero','ws07hero',1,1,101,21,312,0,402,$2::jsonb)
         RETURNING id,name`,
        [account.id,JSON.stringify({ fixture: 'ws07-v2', skills: Array(9).fill(0), protocolItems: [], visibleEquipment: [] })],
      )).rows[0];
      await db.query(`INSERT INTO oldko.character_stats(character_id) VALUES($1)`, [character.id]);
    }
    return { account, character };
  });
  console.log(`development fixture ready: ${result.account.username} / ${result.character.name}`);
} finally {
  await pool.end();
}
