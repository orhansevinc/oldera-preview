#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../lib/common.sh"

require_cmd psql
require_env DATABASE_URL

query_scalar() {
  psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -Atqc "$1"
}

critical_tables=(
  accounts account_sessions account_action_tokens account_rate_limits characters character_stats character_skills
  item_instances character_items inventory inn_storage bans ip_bans audit_log server_state session_leases
  persistence_operations admin_actors admin_sessions admin_item_flags item_serial_events admin_command_outbox
  admin_operation_receipts
)
critical_sql="$(printf "'%s'," "${critical_tables[@]}")"
critical_sql="${critical_sql%,}"
schema_contract_count="$(query_scalar "SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname='oldko' AND tablename IN ($critical_sql);")"
[[ "$schema_contract_count" == "${#critical_tables[@]}" ]] || die "post-restore domain-live schema contract incomplete: expected ${#critical_tables[@]} critical tables, found $schema_contract_count"

migration_table="$(query_scalar "SELECT CASE WHEN to_regclass('public._oldko_migrations') IS NULL THEN 'missing' ELSE 'present' END;")"
[[ "$migration_table" == "present" ]] || die "public._oldko_migrations is missing"
migration_count="$(query_scalar "SELECT count(*) FROM public._oldko_migrations;")"
[[ "$migration_count" =~ ^[0-9]+$ && "$migration_count" -gt 0 ]] || die "migration table count is invalid: $migration_count"

unvalidated="$(query_scalar "SELECT count(*) FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='oldko' AND NOT con.convalidated;")"
[[ "$unvalidated" == "0" ]] || die "unvalidated oldko constraints detected: $unvalidated"

missing_primary_keys="$(query_scalar "SELECT count(*) FROM (VALUES $(printf "('%s')," "${critical_tables[@]}" | sed 's/,$//')) AS wanted(name) WHERE NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='oldko' AND c.relname=wanted.name AND con.contype='p');")"
[[ "$missing_primary_keys" == "0" ]] || die "critical tables missing primary keys: $missing_primary_keys"

account_dupes="$(query_scalar "SELECT count(*) FROM (SELECT username_key FROM oldko.accounts GROUP BY username_key HAVING count(*) > 1) d;")"
character_name_dupes="$(query_scalar "SELECT count(*) FROM (SELECT name_key FROM oldko.characters WHERE deleted_at IS NULL GROUP BY name_key HAVING count(*) > 1) d;")"
character_slot_dupes="$(query_scalar "SELECT count(*) FROM (SELECT account_id,slot FROM oldko.characters WHERE deleted_at IS NULL GROUP BY account_id,slot HAVING count(*) > 1) d;")"
serial_dupes="$(query_scalar "SELECT count(*) FROM (SELECT serial FROM oldko.item_instances GROUP BY serial HAVING count(*) > 1) d;")"
action_token_dupes="$(query_scalar "SELECT count(*) FROM (SELECT kind,token_hash FROM oldko.account_action_tokens GROUP BY kind,token_hash HAVING count(*) > 1) d;")"
admin_username_dupes="$(query_scalar "SELECT count(*) FROM (SELECT username_key FROM oldko.admin_actors GROUP BY username_key HAVING count(*) > 1) d;")"
command_trace_dupes="$(query_scalar "SELECT count(*) FROM (SELECT trace_id FROM oldko.admin_command_outbox GROUP BY trace_id HAVING count(*) > 1) d;")"
rate_bucket_dupes="$(query_scalar "SELECT count(*) FROM (SELECT bucket_hash FROM oldko.account_rate_limits GROUP BY bucket_hash HAVING count(*) > 1) d;")"
placement_dupes="$(query_scalar "WITH placements AS (SELECT item_instance_id FROM oldko.character_items UNION ALL SELECT item_instance_id FROM oldko.inventory UNION ALL SELECT item_instance_id FROM oldko.inn_storage) SELECT count(*) FROM (SELECT item_instance_id FROM placements GROUP BY item_instance_id HAVING count(*) > 1) d;")"

[[ "$account_dupes" == "0" ]] || die "duplicate account username_key values detected: $account_dupes"
[[ "$character_name_dupes" == "0" ]] || die "duplicate live character names detected: $character_name_dupes"
[[ "$character_slot_dupes" == "0" ]] || die "duplicate live character slots detected: $character_slot_dupes"
[[ "$serial_dupes" == "0" ]] || die "duplicate item serials detected: $serial_dupes"
[[ "$action_token_dupes" == "0" ]] || die "duplicate account action-token digests detected: $action_token_dupes"
[[ "$admin_username_dupes" == "0" ]] || die "duplicate admin username_key values detected: $admin_username_dupes"
[[ "$command_trace_dupes" == "0" ]] || die "duplicate admin command trace IDs detected: $command_trace_dupes"
[[ "$rate_bucket_dupes" == "0" ]] || die "duplicate rate-limit buckets detected: $rate_bucket_dupes"
[[ "$placement_dupes" == "0" ]] || die "item instance appears in multiple placement tables: $placement_dupes"

orphan_count="$(query_scalar "
WITH problems AS (
  SELECT c.id::text AS id FROM oldko.characters c LEFT JOIN oldko.accounts a ON a.id=c.account_id WHERE a.id IS NULL
  UNION ALL SELECT s.character_id::text FROM oldko.character_stats s LEFT JOIN oldko.characters c ON c.id=s.character_id WHERE c.id IS NULL
  UNION ALL SELECT s.character_id::text FROM oldko.character_skills s LEFT JOIN oldko.characters c ON c.id=s.character_id WHERE c.id IS NULL
  UNION ALL SELECT s.id::text FROM oldko.account_sessions s LEFT JOIN oldko.accounts a ON a.id=s.account_id WHERE a.id IS NULL
  UNION ALL SELECT t.id::text FROM oldko.account_action_tokens t LEFT JOIN oldko.accounts a ON a.id=t.account_id WHERE a.id IS NULL
  UNION ALL SELECT ci.id::text FROM oldko.character_items ci LEFT JOIN oldko.characters c ON c.id=ci.character_id LEFT JOIN oldko.item_instances i ON i.id=ci.item_instance_id WHERE c.id IS NULL OR i.id IS NULL
  UNION ALL SELECT iv.id::text FROM oldko.inventory iv LEFT JOIN oldko.characters c ON c.id=iv.character_id LEFT JOIN oldko.item_instances i ON i.id=iv.item_instance_id WHERE c.id IS NULL OR i.id IS NULL
  UNION ALL SELECT ins.id::text FROM oldko.inn_storage ins LEFT JOIN oldko.accounts a ON a.id=ins.account_id LEFT JOIN oldko.item_instances i ON i.id=ins.item_instance_id WHERE a.id IS NULL OR i.id IS NULL
  UNION ALL SELECT s.id::text FROM oldko.admin_sessions s LEFT JOIN oldko.admin_actors a ON a.id=s.actor_id WHERE a.id IS NULL
  UNION ALL SELECT f.item_instance_id::text FROM oldko.admin_item_flags f LEFT JOIN oldko.item_instances i ON i.id=f.item_instance_id WHERE i.id IS NULL
  UNION ALL SELECT o.id::text FROM oldko.admin_command_outbox o LEFT JOIN oldko.admin_actors a ON a.id=o.requested_by_admin_id LEFT JOIN oldko.characters c ON c.id=o.expected_character_id WHERE (o.requested_by_admin_id IS NOT NULL AND a.id IS NULL) OR (o.expected_character_id IS NOT NULL AND c.id IS NULL)
  UNION ALL SELECT r.actor_id FROM oldko.admin_operation_receipts r LEFT JOIN oldko.admin_actors a ON a.id=r.actor_id WHERE a.id IS NULL
)
SELECT count(*) FROM problems;")"
[[ "$orphan_count" == "0" ]] || die "foreign-key/domain relationship orphan rows detected: $orphan_count"

sequence_regressions="$(query_scalar "SELECT
  ((SELECT last_value FROM oldko.accounts_id_seq) < (SELECT COALESCE(max(id),0) FROM oldko.accounts))::int +
  ((SELECT last_value FROM oldko.account_sessions_id_seq) < (SELECT COALESCE(max(id),0) FROM oldko.account_sessions))::int +
  ((SELECT last_value FROM oldko.characters_id_seq) < (SELECT COALESCE(max(id),0) FROM oldko.characters))::int +
  ((SELECT last_value FROM oldko.item_instances_id_seq) < (SELECT COALESCE(max(id),0) FROM oldko.item_instances))::int +
  ((SELECT last_value FROM oldko.character_items_id_seq) < (SELECT COALESCE(max(id),0) FROM oldko.character_items))::int +
  ((SELECT last_value FROM oldko.inventory_id_seq) < (SELECT COALESCE(max(id),0) FROM oldko.inventory))::int +
  ((SELECT last_value FROM oldko.inn_storage_id_seq) < (SELECT COALESCE(max(id),0) FROM oldko.inn_storage))::int +
  ((SELECT last_value FROM oldko.bans_id_seq) < (SELECT COALESCE(max(id),0) FROM oldko.bans))::int +
  ((SELECT last_value FROM oldko.audit_log_id_seq) < (SELECT COALESCE(max(id),0) FROM oldko.audit_log))::int +
  ((SELECT last_value FROM oldko.item_serial_events_id_seq) < (SELECT COALESCE(max(id),0) FROM oldko.item_serial_events))::int;")"
[[ "$sequence_regressions" == "0" ]] || die "serial sequence state regressed behind restored row IDs: $sequence_regressions"

if [[ -n "${EXPECTED_MIGRATION_HEAD:-}" ]]; then
  actual_head="$(query_scalar "SELECT COALESCE((SELECT name FROM public._oldko_migrations ORDER BY applied_at DESC, name DESC LIMIT 1),'none');")"
  [[ "$actual_head" == "$EXPECTED_MIGRATION_HEAD" ]] || die "migration head mismatch: expected=$EXPECTED_MIGRATION_HEAD actual=$actual_head"
fi

if [[ -n "${EXPECTED_MIGRATION_LEDGER_SHA256:-}" ]]; then
  actual_ledger_sha="$(migration_ledger_fingerprint "$DATABASE_URL")"
  [[ "$actual_ledger_sha" == "$EXPECTED_MIGRATION_LEDGER_SHA256" ]] || die "migration ledger fingerprint mismatch"
fi

if [[ -n "${EXPECTED_SCHEMA_FINGERPRINT_SHA256:-}" ]]; then
  actual_schema_sha="$(schema_fingerprint "$DATABASE_URL")"
  [[ "$actual_schema_sha" == "$EXPECTED_SCHEMA_FINGERPRINT_SHA256" ]] || die "schema fingerprint mismatch"
fi

log "post-restore integrity checks passed (migrations=$migration_count; pk/fk/unique/sequence state valid)"
