#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../lib/common.sh"

require_cmd pg_dump pg_restore psql df awk date mktemp
require_env DATABASE_URL

BACKUP_DIR="${BACKUP_DIR:-$PWD/backups}"
BACKUP_PREFIX="${BACKUP_PREFIX:-oldko-full}"
MIN_FREE_BYTES="${MIN_FREE_BYTES:-1073741824}"
APP_VERSION="${BACKUP_APP_VERSION:-unknown}"

[[ "$MIN_FREE_BYTES" =~ ^[0-9]+$ ]] || die "MIN_FREE_BYTES must be an integer"
assert_safe_metadata_value "$APP_VERSION" BACKUP_APP_VERSION
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

schema_contract_count="$(psql "$DATABASE_URL" -X -Atqc "SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname='oldko' AND tablename IN ('accounts','characters','item_instances');")"
[[ "$schema_contract_count" == "3" ]] || die "WS07 schema contract not found (expected oldko.accounts, oldko.characters, oldko.item_instances)"

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
migration_count="$(psql "$DATABASE_URL" -X -Atqc "SELECT count(*) FROM public._oldko_migrations;")"
migration_head_name="$(psql "$DATABASE_URL" -X -Atqc "SELECT COALESCE((SELECT name FROM public._oldko_migrations ORDER BY applied_at DESC, name DESC LIMIT 1),'none');")"
migration_head_checksum="$(psql "$DATABASE_URL" -X -Atqc "SELECT COALESCE((SELECT checksum FROM public._oldko_migrations ORDER BY applied_at DESC, name DESC LIMIT 1),'none');")"
account_count="$(psql "$DATABASE_URL" -X -Atqc "SELECT count(*) FROM oldko.accounts;")"
character_count="$(psql "$DATABASE_URL" -X -Atqc "SELECT count(*) FROM oldko.characters;")"
item_instance_count="$(psql "$DATABASE_URL" -X -Atqc "SELECT count(*) FROM oldko.item_instances;")"

for pair in \
  "server_version_num:$server_version_num" \
  "migration_count:$migration_count" \
  "migration_head_name:$migration_head_name" \
  "migration_head_checksum:$migration_head_checksum" \
  "account_count:$account_count" \
  "character_count:$character_count" \
  "item_instance_count:$item_instance_count"; do
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
metadata_version=1
backup_id=$backup_id
backup_format=postgres_custom
created_at_utc=$created_at
postgres_server_version_num=$server_version_num
app_version=$APP_VERSION
migration_count=$migration_count
migration_head_name=$migration_head_name
migration_head_checksum=$migration_head_checksum
source_database_bytes=$source_db_bytes
backup_bytes=$dump_bytes
accounts=$account_count
characters=$character_count
item_instances=$item_instance_count
dump_sha256=$dump_sha256
encryption=none
META

printf '%s  %s\n' "$dump_sha256" "$(basename "$final_dump")" > "$tmp_checksum"

mv "$tmp_dump" "$final_dump"
mv "$tmp_meta" "$final_meta"
mv "$tmp_checksum" "$final_checksum"

log "backup complete: $final_dump"
printf '%s\n' "$final_dump"
