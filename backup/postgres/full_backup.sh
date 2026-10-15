#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../lib/common.sh"

require_cmd pg_dump pg_restore psql df awk date mktemp wc tr
require_env DATABASE_URL

BACKUP_DIR="${BACKUP_DIR:-$PWD/backups}"
BACKUP_PREFIX="${BACKUP_PREFIX:-oldko-full}"
MIN_FREE_BYTES="${MIN_FREE_BYTES:-1073741824}"
APP_VERSION="${BACKUP_APP_VERSION:-unknown}"
WS07_PIN="${WS30_SOURCE_PIN_WS07:-unknown}"
WS13_PIN="${WS30_SOURCE_PIN_WS13:-unknown}"
MIGRATION_0001_SHA="${WS30_MIGRATION_0001_SHA256:-unknown}"
MIGRATION_0002_SHA="${WS30_MIGRATION_0002_SHA256:-unknown}"
MIGRATION_0003_SHA="${WS30_MIGRATION_0003_SHA256:-unknown}"
MIGRATION_0004_SHA="${WS30_MIGRATION_0004_SHA256:-unknown}"
RATE_LIMIT_SHA="${WS30_RATE_LIMIT_MIGRATION_SHA256:-unknown}"

[[ "$MIN_FREE_BYTES" =~ ^[0-9]+$ ]] || die "MIN_FREE_BYTES must be an integer"
for pair in \
  "BACKUP_APP_VERSION:$APP_VERSION" \
  "WS30_SOURCE_PIN_WS07:$WS07_PIN" \
  "WS30_SOURCE_PIN_WS13:$WS13_PIN" \
  "WS30_MIGRATION_0001_SHA256:$MIGRATION_0001_SHA" \
  "WS30_MIGRATION_0002_SHA256:$MIGRATION_0002_SHA" \
  "WS30_MIGRATION_0003_SHA256:$MIGRATION_0003_SHA" \
  "WS30_MIGRATION_0004_SHA256:$MIGRATION_0004_SHA" \
  "WS30_RATE_LIMIT_MIGRATION_SHA256:$RATE_LIMIT_SHA"; do
  assert_safe_metadata_value "${pair#*:}" "${pair%%:*}"
done
mkdir -p "$BACKUP_DIR"

created_at="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
stamp="$(date -u +'%Y%m%dT%H%M%SZ')"
backup_id="${BACKUP_PREFIX}_${stamp}"
final_dump="$BACKUP_DIR/${backup_id}.dump"
final_meta="$final_dump.meta"
final_checksum="$final_dump.sha256"
tmp_dump="$(mktemp "$BACKUP_DIR/.${backup_id}.dump.tmp.XXXXXX")"
tmp_meta="$(mktemp "$BACKUP_DIR/.${backup_id}.meta.tmp.XXXXXX")"
tmp_checksum="$(mktemp "$BACKUP_DIR/.${backup_id}.sha256.tmp.XXXXXX")"

on_exit() {
  local status=$?
  rm -f "$tmp_dump" "$tmp_meta" "$tmp_checksum"
  if (( status != 0 )); then
    log "backup failed; partial temporary artifacts removed"
  fi
}
trap on_exit EXIT

required_tables=(
  accounts account_sessions account_action_tokens account_rate_limits characters character_stats character_skills
  item_instances character_items inventory inn_storage server_state session_leases persistence_operations
  admin_actors admin_sessions admin_command_outbox admin_operation_receipts audit_log item_serial_events
)
required_sql="$(printf "'%s'," "${required_tables[@]}")"
required_sql="${required_sql%,}"
schema_contract_count="$(psql "$DATABASE_URL" -X -Atqc "SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname='oldko' AND tablename IN ($required_sql);")"
[[ "$schema_contract_count" == "${#required_tables[@]}" ]] || die "domain-live schema contract incomplete: expected ${#required_tables[@]} critical oldko tables, found $schema_contract_count"

migration_table="$(psql "$DATABASE_URL" -X -Atqc "SELECT CASE WHEN to_regclass('public._oldko_migrations') IS NULL THEN 'missing' ELSE 'present' END;")"
[[ "$migration_table" == "present" ]] || die "public._oldko_migrations is required for a recoverable OldKO backup"

source_db_bytes="$(psql "$DATABASE_URL" -X -Atqc "SELECT pg_database_size(current_database());")"
[[ "$source_db_bytes" =~ ^[0-9]+$ ]] || die "could not determine source database size"
free_bytes="$(free_bytes_for_path "$BACKUP_DIR")"
required_bytes="$MIN_FREE_BYTES"
if (( source_db_bytes > required_bytes )); then required_bytes="$source_db_bytes"; fi
if (( free_bytes < required_bytes )); then
  die "insufficient backup disk space: free=${free_bytes}B required>=${required_bytes}B"
fi

server_version_num="$(psql "$DATABASE_URL" -X -Atqc "SHOW server_version_num;")"
server_version="$(psql "$DATABASE_URL" -X -Atqc "SHOW server_version;")"
[[ "$server_version_num" =~ ^[0-9]+$ ]] || die "invalid PostgreSQL server_version_num"
server_major="$((server_version_num / 10000))"
[[ "$server_major" == "16" ]] || die "domain-live recovery contract requires PostgreSQL 16; got server major $server_major"

migration_count="$(psql "$DATABASE_URL" -X -Atqc "SELECT count(*) FROM public._oldko_migrations;")"
migration_head_name="$(psql "$DATABASE_URL" -X -Atqc "SELECT COALESCE((SELECT name FROM public._oldko_migrations ORDER BY applied_at DESC, name DESC LIMIT 1),'none');")"
migration_head_checksum="$(psql "$DATABASE_URL" -X -Atqc "SELECT COALESCE((SELECT checksum FROM public._oldko_migrations ORDER BY applied_at DESC, name DESC LIMIT 1),'none');")"
migration_names="$(psql "$DATABASE_URL" -X -Atqc "SELECT COALESCE(string_agg(name,',' ORDER BY name),'') FROM public._oldko_migrations;")"
ledger_sha256="$(migration_ledger_fingerprint "$DATABASE_URL")"
schema_sha256="$(schema_fingerprint "$DATABASE_URL")"
table_count="$(psql "$DATABASE_URL" -X -Atqc "SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname='oldko';")"
constraint_count="$(psql "$DATABASE_URL" -X -Atqc "SELECT count(*) FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='oldko';")"
index_count="$(psql "$DATABASE_URL" -X -Atqc "SELECT count(*) FROM pg_indexes WHERE schemaname='oldko';")"

row_count() {
  local table="$1"
  psql "$DATABASE_URL" -X -Atqc "SELECT count(*) FROM oldko.${table};"
}

accounts="$(row_count accounts)"
account_sessions="$(row_count account_sessions)"
account_action_tokens="$(row_count account_action_tokens)"
account_rate_limits="$(row_count account_rate_limits)"
characters="$(row_count characters)"
character_stats="$(row_count character_stats)"
character_skills="$(row_count character_skills)"
item_instances="$(row_count item_instances)"
character_items="$(row_count character_items)"
inventory="$(row_count inventory)"
inn_storage="$(row_count inn_storage)"
server_state="$(row_count server_state)"
session_leases="$(row_count session_leases)"
persistence_operations="$(row_count persistence_operations)"
admin_actors="$(row_count admin_actors)"
admin_sessions="$(row_count admin_sessions)"
admin_command_outbox="$(row_count admin_command_outbox)"
admin_operation_receipts="$(row_count admin_operation_receipts)"
audit_log="$(row_count audit_log)"
item_serial_events="$(row_count item_serial_events)"

for pair in \
  "postgres_server_version_num:$server_version_num" \
  "postgres_server_version:$server_version" \
  "migration_count:$migration_count" \
  "migration_head_name:$migration_head_name" \
  "migration_head_checksum:$migration_head_checksum" \
  "migration_names:$migration_names" \
  "migration_ledger_sha256:$ledger_sha256" \
  "schema_fingerprint_sha256:$schema_sha256" \
  "schema_table_count:$table_count" \
  "schema_constraint_count:$constraint_count" \
  "schema_index_count:$index_count" \
  "accounts:$accounts" \
  "account_sessions:$account_sessions" \
  "account_action_tokens:$account_action_tokens" \
  "account_rate_limits:$account_rate_limits" \
  "characters:$characters" \
  "character_stats:$character_stats" \
  "character_skills:$character_skills" \
  "item_instances:$item_instances" \
  "character_items:$character_items" \
  "inventory:$inventory" \
  "inn_storage:$inn_storage" \
  "server_state:$server_state" \
  "session_leases:$session_leases" \
  "persistence_operations:$persistence_operations" \
  "admin_actors:$admin_actors" \
  "admin_sessions:$admin_sessions" \
  "admin_command_outbox:$admin_command_outbox" \
  "admin_operation_receipts:$admin_operation_receipts" \
  "audit_log:$audit_log" \
  "item_serial_events:$item_serial_events"; do
  assert_safe_metadata_value "${pair#*:}" "${pair%%:*}"
done

log "creating PostgreSQL custom-format backup: $backup_id"
pg_dump \
  --format=custom \
  --compress=6 \
  --no-owner \
  --no-privileges \
  --file "$tmp_dump" \
  "$DATABASE_URL"

pg_restore --list "$tmp_dump" >/dev/null

dump_sha256="$(sha256_file "$tmp_dump")"
dump_bytes="$(wc -c < "$tmp_dump" | tr -d '[:space:]')"

cat > "$tmp_meta" <<META
metadata_version=2
backup_id=$backup_id
backup_format=postgres_custom
created_at_utc=$created_at
postgres_server_version_num=$server_version_num
postgres_server_version=$server_version
app_version=$APP_VERSION
source_pin_ws07=$WS07_PIN
source_pin_ws13=$WS13_PIN
migration_0001_sha256=$MIGRATION_0001_SHA
migration_0002_sha256=$MIGRATION_0002_SHA
migration_0003_sha256=$MIGRATION_0003_SHA
migration_0004_sha256=$MIGRATION_0004_SHA
rate_limit_migration_sha256=$RATE_LIMIT_SHA
migration_count=$migration_count
migration_names=$migration_names
migration_head_name=$migration_head_name
migration_head_checksum=$migration_head_checksum
migration_ledger_sha256=$ledger_sha256
service_rate_limit_ledger=service-owned-not-in-public._oldko_migrations
schema_fingerprint_sha256=$schema_sha256
schema_table_count=$table_count
schema_constraint_count=$constraint_count
schema_index_count=$index_count
source_database_bytes=$source_db_bytes
backup_bytes=$dump_bytes
accounts=$accounts
account_sessions=$account_sessions
account_action_tokens=$account_action_tokens
account_rate_limits=$account_rate_limits
characters=$characters
character_stats=$character_stats
character_skills=$character_skills
item_instances=$item_instances
character_items=$character_items
inventory=$inventory
inn_storage=$inn_storage
server_state=$server_state
session_leases=$session_leases
persistence_operations=$persistence_operations
admin_actors=$admin_actors
admin_sessions=$admin_sessions
admin_command_outbox=$admin_command_outbox
admin_operation_receipts=$admin_operation_receipts
audit_log=$audit_log
item_serial_events=$item_serial_events
dump_sha256=$dump_sha256
encryption=none
encryption_contract=managed-kms-required-for-production-storage
META

printf '%s  %s\n' "$dump_sha256" "$(basename "$final_dump")" > "$tmp_checksum"

mv "$tmp_dump" "$final_dump"
mv "$tmp_meta" "$final_meta"
mv "$tmp_checksum" "$final_checksum"

log "backup complete: $final_dump"
printf '%s\n' "$final_dump"
