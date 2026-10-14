import { createPool } from '../index.js';

const checks = [
  ['active sessions','account_sessions_active_idx',`SELECT id FROM oldko.account_sessions WHERE account_id=$1 AND revoked_at IS NULL AND expires_at>now()`,[1]],
  ['account bans','bans_active_account_idx',`SELECT id FROM oldko.bans WHERE account_id=$1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now())`,[1]],
  ['live characters','characters_account_live_idx',`SELECT id FROM oldko.characters WHERE account_id=$1 AND deleted_at IS NULL`,[1]],
  ['session ownership','session_leases_session_idx',`SELECT scope,lease_key FROM oldko.session_leases WHERE session_id=$1`,['session']],
  ['active trade','economy_trade_one_active_per_character_uq',`SELECT trade_id FROM oldko.economy_trade_participants WHERE character_id=$1 AND active=true`,[1]],
];
const pool = createPool({ applicationName: 'oldko-explain', max: 1 });
const client = await pool.connect();
try {
  await client.query(`SET enable_seqscan=off`);
  for (const [label,index,sql,params] of checks) {
    const { rows } = await client.query(`EXPLAIN (FORMAT JSON) ${sql}`, params);
    const plan = rows[0]['QUERY PLAN'][0].Plan;
    const names = collectIndexes(plan);
    console.log(`${label}: ${names.join(', ') || '(no index reported)'}`);
    if (!names.includes(index)) throw new Error(`${label} did not plan through ${index}`);
  }
} finally { client.release(); await pool.end(); }

function collectIndexes(plan, out = []) {
  if (plan['Index Name']) out.push(plan['Index Name']);
  for (const child of plan.Plans ?? []) collectIndexes(child,out);
  return out;
}
