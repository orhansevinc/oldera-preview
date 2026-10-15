import { createPool } from '../index.js';

const requiredTables = [
  'accounts','account_sessions','account_action_tokens','characters','character_stats','character_skills','clans','clan_members','item_instances','character_items','inventory','inn_storage',
  'bans','ip_bans','audit_log','server_state','economy_trades','economy_trade_participants','session_leases','persistence_operations',
  'admin_actors','admin_sessions','admin_item_flags','item_serial_events','admin_command_outbox','admin_operation_receipts',
  'account_rate_limits','character_quests','boss_runtime_state','runtime_config','runtime_config_apply_receipts','server_runtime_heartbeats','runtime_content_observations','admin_runtime_command_confirmations',
];
const requiredIndexes = [
  'characters_account_slot_live_uq','characters_name_live_uq','item_instances_serial_key','inn_storage_account_flat_slot_uq',
  'economy_trade_one_active_per_character_uq','session_leases_session_idx','bans_active_account_idx','ip_bans_network_spgist_idx',
  'accounts_email_live_uq','account_action_tokens_account_idx','admin_sessions_active_idx','audit_log_admin_actor_idx',
  'bans_admin_request_uq','ip_bans_admin_request_uq','item_serial_events_serial_idx','admin_command_outbox_pending_idx',
  'account_rate_limits_reset_at_idx','character_quests_updated_idx','boss_runtime_state_transition_idx','server_runtime_heartbeats_realm_idx','runtime_content_observations_kind_idx','admin_runtime_command_confirmations_confirmed_idx',
];
const expectedMigrations = ['0001_init.sql','0002_persistence_hardening.sql','0003_public_account_api.sql','0004_admin_persistence.sql','0005_phase2_data_admin.sql'];
const pool = createPool({ applicationName: 'oldko-schema-verify', max: 1 });
try {
  const tables = await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='oldko'`);
  const names = new Set(tables.rows.map(row => row.table_name));
  for (const table of requiredTables) if (!names.has(table)) throw new Error(`missing table: ${table}`);
  const indexes = await pool.query(`SELECT indexname FROM pg_indexes WHERE schemaname='oldko'`);
  const indexNames = new Set(indexes.rows.map(row => row.indexname));
  for (const index of requiredIndexes) if (!indexNames.has(index)) throw new Error(`missing index: ${index}`);
  const migrations = await pool.query(`SELECT name,checksum FROM public._oldko_migrations ORDER BY name`);
  const actual = migrations.rows.map(row => row.name);
  if (JSON.stringify(actual) !== JSON.stringify(expectedMigrations)) throw new Error(`unexpected migration order: ${actual.join(',')}`);
  console.log(`schema verified: ${requiredTables.length} tables, ${requiredIndexes.length} critical indexes, ${migrations.rows.length} canonical migrations`);
  console.log(`migration ledger: ${JSON.stringify(migrations.rows)}`);
} finally { await pool.end(); }
