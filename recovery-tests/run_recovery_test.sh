#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT/backup/lib/common.sh"
require_cmd psql mktemp
require_env PG_TEST_ADMIN_URL

src_db="${WS30_SOURCE_DB:-oldko_ws30_src}"
dst_db="${WS30_RESTORE_DB:-oldko_ws30_dst}"
work_dir="$(mktemp -d)"
backup_dir="$work_dir/backups"
mkdir -p "$backup_dir"

admin_psql() {
  psql "$PG_TEST_ADMIN_URL" -X -v ON_ERROR_STOP=1 "$@"
}

cleanup() {
  admin_psql -Atqc "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN ('$src_db','$dst_db') AND pid <> pg_backend_pid();" >/dev/null 2>&1 || true
  admin_psql -c "DROP DATABASE IF EXISTS \"$src_db\";" >/dev/null 2>&1 || true
  admin_psql -c "DROP DATABASE IF EXISTS \"$dst_db\";" >/dev/null 2>&1 || true
  rm -rf "$work_dir"
}
trap cleanup EXIT

admin_psql -c "DROP DATABASE IF EXISTS \"$src_db\";"
admin_psql -c "DROP DATABASE IF EXISTS \"$dst_db\";"
admin_psql -c "CREATE DATABASE \"$src_db\";"
admin_psql -c "CREATE DATABASE \"$dst_db\";"

base_url="${PG_TEST_ADMIN_URL%/*}"
src_url="$base_url/$src_db"
dst_url="$base_url/$dst_db"

psql "$src_url" -X -v ON_ERROR_STOP=1 -f "$ROOT/recovery-tests/sql/ws07_contract_fixture.sql"

backup_file="$(DATABASE_URL="$src_url" BACKUP_DIR="$backup_dir" MIN_FREE_BYTES=0 BACKUP_APP_VERSION=ws30-ci "$ROOT/backup/postgres/full_backup.sh")"
"$ROOT/backup/postgres/verify_backup.sh" "$backup_file"

BACKUP_FILE="$backup_file" \
TARGET_DATABASE_URL="$dst_url" \
TARGET_ENVIRONMENT=ci \
RESTORE_TARGET_MARKER=disposable \
ALLOW_DESTRUCTIVE_RESTORE=YES \
"$ROOT/backup/postgres/restore.sh"

DATABASE_URL="$dst_url" "$ROOT/backup/postgres/assert_integrity.sh"
DATABASE_URL="$dst_url" "$ROOT/backup/postgres/assert_metadata_counts.sh" "${backup_file}.meta"

if psql "$dst_url" -X -v ON_ERROR_STOP=1 -c "INSERT INTO oldko.item_instances(serial,item_template_id) VALUES (900000000001,999999999);" >/dev/null 2>&1; then
  die "restored database accepted a duplicate item serial"
fi

corrupt="$backup_dir/corrupt.dump"
cp "$backup_file" "$corrupt"
cp "${backup_file}.meta" "${corrupt}.meta"
cp "${backup_file}.sha256" "${corrupt}.sha256"
printf 'corruption' >> "$corrupt"
if "$ROOT/backup/postgres/verify_backup.sh" "$corrupt" >/dev/null 2>&1; then
  die "corrupted backup unexpectedly passed verification"
fi

space_fail_dir="$work_dir/space-fail"
mkdir -p "$space_fail_dir"
if DATABASE_URL="$src_url" BACKUP_DIR="$space_fail_dir" MIN_FREE_BYTES=999999999999999999 "$ROOT/backup/postgres/full_backup.sh" >/dev/null 2>&1; then
  die "backup unexpectedly succeeded with impossible MIN_FREE_BYTES"
fi
if find "$space_fail_dir" -maxdepth 1 -name '*.dump' -print -quit | grep -q .; then
  die "failed backup published a final .dump artifact"
fi

connection_fail_dir="$work_dir/connection-fail"
mkdir -p "$connection_fail_dir"
if DATABASE_URL='postgres://invalid:invalid@127.0.0.1:1/invalid?connect_timeout=1' BACKUP_DIR="$connection_fail_dir" MIN_FREE_BYTES=0 "$ROOT/backup/postgres/full_backup.sh" >/dev/null 2>&1; then
  die "backup unexpectedly succeeded against an invalid database endpoint"
fi
if find "$connection_fail_dir" -maxdepth 1 -name '*.dump' -print -quit | grep -q .; then
  die "connection failure published a final .dump artifact"
fi

if BACKUP_FILE="$backup_file" TARGET_DATABASE_URL="$dst_url" TARGET_ENVIRONMENT=ci "$ROOT/backup/postgres/restore.sh" >/dev/null 2>&1; then
  die "restore safety gate unexpectedly allowed an unapproved destructive restore"
fi

log "disposable backup/restore disaster-recovery test passed"
