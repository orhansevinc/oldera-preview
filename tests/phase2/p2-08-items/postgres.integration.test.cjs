'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PgP208TransactionManager, PgCoinStore } = require('../../../services/ko1298-items-p2/postgres.cjs');

const enabled = process.env.P2_08_REAL_POSTGRES === '1' && process.env.DATABASE_URL;

test('real PostgreSQL: rollback + restart replay does not double-spend', { skip: !enabled }, async (t) => {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
  t.after(async () => { await pool.end(); });

  const suffix = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const username = `p208_${suffix}`.slice(0, 31);
  let accountId;
  let characterId;
  try {
    const account = await pool.query(
      `INSERT INTO oldko.accounts(username,username_key,password_hash) VALUES($1,lower($1),'p2-08-test-only') RETURNING id`, [username]
    );
    accountId = account.rows[0].id;
    const character = await pool.query(
      `INSERT INTO oldko.characters(account_id,slot,name,name_key,nation,race,class_id,zone_id,pos_x,pos_y,pos_z)
       VALUES($1,0,$2,lower($2),1,1,101,21,0,0,0) RETURNING id`, [accountId, `T${suffix}`.slice(0, 20)]
    );
    characterId = character.rows[0].id;
    await pool.query(`INSERT INTO oldko.character_stats(character_id,gold) VALUES($1,1000)`, [characterId]);

    const manager1 = new PgP208TransactionManager(pool);
    const coins = new PgCoinStore();

    await assert.rejects(() => manager1.runOnce({ operationId: `rollback-${suffix}`, kind: 'test.rollback', lockKeys: [`character:${characterId}`] }, async client => {
      await coins.debit(client, characterId, 100n);
      throw new Error('forced rollback');
    }));
    let state = await pool.query('SELECT gold FROM oldko.character_stats WHERE character_id=$1', [characterId]);
    assert.equal(String(state.rows[0].gold), '1000');

    const operationId = `commit-${suffix}`;
    const first = await manager1.runOnce({ operationId, kind: 'test.debit', lockKeys: [`character:${characterId}`] }, async client => {
      const balance = await coins.debit(client, characterId, 125n);
      return { balance: String(balance) };
    });
    assert.equal(first.replayed, false);

    const manager2 = new PgP208TransactionManager(pool);
    const second = await manager2.runOnce({ operationId, kind: 'test.debit', lockKeys: [`character:${characterId}`] }, async client => {
      await coins.debit(client, characterId, 125n);
      return { impossible: true };
    });
    assert.equal(second.replayed, true);
    state = await pool.query('SELECT gold FROM oldko.character_stats WHERE character_id=$1', [characterId]);
    assert.equal(String(state.rows[0].gold), '875');
  } finally {
    if (accountId) await pool.query('DELETE FROM oldko.accounts WHERE id=$1', [accountId]);
    await pool.query(`DELETE FROM oldko.server_state WHERE key LIKE 'p208:op:%' AND value->>'operationId' LIKE $1`, [`%${suffix}%`]);
  }
});
