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

assert_count accounts oldko.accounts
assert_count characters oldko.characters
assert_count item_instances oldko.item_instances

expected_migration_count="$(metadata_value "$metadata_file" migration_count)"
actual_migration_count="$(psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -Atqc "SELECT count(*) FROM public._oldko_migrations;")"
[[ "$actual_migration_count" == "$expected_migration_count" ]] || die "migration-count mismatch: expected=$expected_migration_count actual=$actual_migration_count"

expected_head="$(metadata_value "$metadata_file" migration_head_name)"
actual_head="$(psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -Atqc "SELECT COALESCE((SELECT name FROM public._oldko_migrations ORDER BY applied_at DESC, name DESC LIMIT 1),'none');")"
[[ "$actual_head" == "$expected_head" ]] || die "migration-head mismatch: expected=$expected_head actual=$actual_head"

log "metadata row-count and migration checks passed"
