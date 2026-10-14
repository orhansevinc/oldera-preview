import { createPool } from '../index.js';

const requiredTables = [
  'accounts','account_sessions','characters','character_stats','clans','clan_members','item_instances','character_items','inventory','inn_storage',
  'bans','ip_bans','audit_log','server_state','economy_trades','economy_trade_participants','session_leases','persistence_operations',
];
const requiredIndexes = [
  'characters_account_slot_live_uq','characters_name_live_uq','item_instances_serial_key','inn_storage_account_flat_slot_uq',
  'economy_trade_one_active_per_character_uq','session_leases_session_idx','bans_active_account_idx','ip_bans_network_spgist_idx',
];
const pool = createPool({ applicationName: 'oldko-schema-verify', max: 1 });
try {
  const tables = await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='oldko'`);
  const names = new Set(tables.rows.map(row => row.table_name));
  for (const table of requiredTables) if (!names.has(table)) throw new Error(`missing table: ${table}`);
  const indexes = await pool.query(`SELECT indexname FROM pg_indexes WHERE schemaname='oldko'`);
  const indexNames = new Set(indexes.rows.map(row => row.indexname));
  for (const index of requiredIndexes) if (!indexNames.has(index)) throw new Error(`missing index: ${index}`);
  const migrations = await pool.query(`SELECT name FROM public._oldko_migrations ORDER BY name`);
  if (migrations.rows.length < 2 || migrations.rows.at(-1).name !== '0002_persistence_hardening.sql') throw new Error('migration set is incomplete');
  console.log(`schema verified: ${requiredTables.length} tables, ${requiredIndexes.length} critical indexes, ${migrations.rows.length} migrations`);
} finally { await pool.end(); }
