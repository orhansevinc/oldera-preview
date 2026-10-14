import { createPool } from '../index.js';

const requiredTables = [
  'accounts','account_sessions','account_action_tokens','characters','character_stats','character_skills','clans','clan_members','item_instances','character_items','inventory','inn_storage',
  'bans','ip_bans','audit_log','server_state','economy_trades','economy_trade_participants','session_leases','persistence_operations',
  'admin_actors','admin_sessions','admin_item_flags','item_serial_events','admin_command_outbox','admin_operation_receipts',
];
const requiredIndexes = [
  'characters_account_slot_live_uq','characters_name_live_uq','item_instances_serial_key','inn_storage_account_flat_slot_uq',
  'economy_trade_one_active_per_character_uq','session_leases_session_idx','bans_active_account_idx','ip_bans_network_spgist_idx',
  'accounts_email_live_uq','account_action_tokens_account_idx','admin_sessions_active_idx','audit_log_admin_actor_idx',
  'bans_admin_request_uq','ip_bans_admin_request_uq','item_serial_events_serial_idx','admin_command_outbox_pending_idx',
];
const pool = createPool({ applicationName: 'oldko-schema-verify', max: 1 });
try {
  const tables = await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='oldko'`);
  const names = new Set(tables.rows.map(row => row.table_name));
  for (const table of requiredTables) if (!names.has(table)) throw new Error(`missing table: ${table}`);
  const indexes = await pool.query(`SELECT indexname FROM pg_indexes WHERE schemaname='oldko'`);
  const indexNames = new Set(indexes.rows.map(row => row.indexname));
  for (const index of requiredIndexes) if (!indexNames.has(index)) throw new Error(`missing index: ${index}`);
  const migrations = await pool.query(`SELECT name,checksum FROM public._oldko_migrations ORDER BY name`);
  if (migrations.rows.length < 4 || migrations.rows.at(-1).name !== '0004_admin_persistence.sql') throw new Error('migration set is incomplete');
  console.log(`schema verified: ${requiredTables.length} tables, ${requiredIndexes.length} critical indexes, ${migrations.rows.length} migrations`);
  console.log(`migration ledger: ${JSON.stringify(migrations.rows)}`);
} finally { await pool.end(); }
