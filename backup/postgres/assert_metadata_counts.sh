#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../lib/common.sh"

require_cmd psql
require_env DATABASE_URL
metadata_file="${1:-${BACKUP_METADATA_FILE:-}}"
[[ -n "$metadata_file" && -f "$metadata_file" ]] || die "backup metadata file is required"

assert_count() {
  local key="$1" table="$2"
  local expected actual
  expected="$(metadata_value "$metadata_file" "$key")"
  [[ "$expected" =~ ^[0-9]+$ ]] || die "invalid expected count for $key: $expected"
  actual="$(psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -Atqc "SELECT count(*) FROM $table;")"
  [[ "$actual" == "$expected" ]] || die "row-count mismatch for $table: expected=$expected actual=$actual"
}

for table in \
  accounts account_sessions account_action_tokens account_rate_limits characters character_stats character_skills \
  item_instances character_items inventory inn_storage server_state session_leases persistence_operations \
  admin_actors admin_sessions admin_command_outbox admin_operation_receipts audit_log item_serial_events; do
  assert_count "$table" "oldko.$table"
done

expected_migration_count="$(metadata_value "$metadata_file" migration_count)"
actual_migration_count="$(psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -Atqc "SELECT count(*) FROM public._oldko_migrations;")"
[[ "$actual_migration_count" == "$expected_migration_count" ]] || die "migration-count mismatch: expected=$expected_migration_count actual=$actual_migration_count"

expected_names="$(metadata_value "$metadata_file" migration_names)"
actual_names="$(psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -Atqc "SELECT COALESCE(string_agg(name,',' ORDER BY name),'') FROM public._oldko_migrations;")"
[[ "$actual_names" == "$expected_names" ]] || die "migration-name ledger mismatch: expected=$expected_names actual=$actual_names"

expected_head="$(metadata_value "$metadata_file" migration_head_name)"
actual_head="$(psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -Atqc "SELECT COALESCE((SELECT name FROM public._oldko_migrations ORDER BY applied_at DESC, name DESC LIMIT 1),'none');")"
[[ "$actual_head" == "$expected_head" ]] || die "migration-head mismatch: expected=$expected_head actual=$actual_head"

expected_ledger_sha="$(metadata_value "$metadata_file" migration_ledger_sha256)"
actual_ledger_sha="$(migration_ledger_fingerprint "$DATABASE_URL")"
[[ "$actual_ledger_sha" == "$expected_ledger_sha" ]] || die "migration-ledger fingerprint mismatch: expected=$expected_ledger_sha actual=$actual_ledger_sha"

expected_schema_sha="$(metadata_value "$metadata_file" schema_fingerprint_sha256)"
actual_schema_sha="$(schema_fingerprint "$DATABASE_URL")"
[[ "$actual_schema_sha" == "$expected_schema_sha" ]] || die "schema fingerprint mismatch: expected=$expected_schema_sha actual=$actual_schema_sha"

expected_tables="$(metadata_value "$metadata_file" schema_table_count)"
actual_tables="$(psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -Atqc "SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname='oldko';")"
[[ "$actual_tables" == "$expected_tables" ]] || die "schema table-count mismatch: expected=$expected_tables actual=$actual_tables"

expected_constraints="$(metadata_value "$metadata_file" schema_constraint_count)"
actual_constraints="$(psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -Atqc "SELECT count(*) FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='oldko';")"
[[ "$actual_constraints" == "$expected_constraints" ]] || die "schema constraint-count mismatch: expected=$expected_constraints actual=$actual_constraints"

expected_indexes="$(metadata_value "$metadata_file" schema_index_count)"
actual_indexes="$(psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -Atqc "SELECT count(*) FROM pg_indexes WHERE schemaname='oldko';")"
[[ "$actual_indexes" == "$expected_indexes" ]] || die "schema index-count mismatch: expected=$expected_indexes actual=$actual_indexes"

log "metadata row-count, schema fingerprint and migration-ledger checks passed"
