#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../lib/common.sh"

require_cmd psql
require_env DATABASE_URL
[[ "${WS30_MIGRATION_SAFETY_TOKEN:-}" == "BACKUP_VERIFIED_BEFORE_MIGRATION" ]] || die "migration gate requires WS30_MIGRATION_SAFETY_TOKEN=BACKUP_VERIFIED_BEFORE_MIGRATION"

if [[ "${1:-}" == "--" ]]; then shift; fi
[[ "$#" -gt 0 ]] || die "usage: backup_before_migrate.sh -- <migration command> [args...]"

log "gate 1/6 preflight: connectivity, PostgreSQL major and current integrity"
server_version_num="$(psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -Atqc 'SHOW server_version_num;')"
[[ "$server_version_num" =~ ^[0-9]+$ ]] || die "could not read PostgreSQL server version"
[[ "$((server_version_num / 10000))" == "16" ]] || die "migration gate requires PostgreSQL 16"
DATABASE_URL="$DATABASE_URL" "$SCRIPT_DIR/assert_integrity.sh"

log "gate 2/6 disk preflight + full custom-format backup"
backup_file="$(DATABASE_URL="$DATABASE_URL" "$SCRIPT_DIR/full_backup.sh")"
[[ -f "$backup_file" ]] || die "backup writer did not publish an archive"

log "gate 3/6 archive integrity: SHA-256 + pg_restore --list"
"$SCRIPT_DIR/verify_backup.sh" "$backup_file"

if [[ -n "${BACKUP_VERIFY_DATABASE_URL:-}" ]]; then
  require_env BACKUP_VERIFY_DATABASE_NAME
  log "gate 4/6 disposable restore integrity"
  BACKUP_FILE="$backup_file" \
  TARGET_DATABASE_URL="$BACKUP_VERIFY_DATABASE_URL" \
  TARGET_ENVIRONMENT=ci \
  RESTORE_TARGET_MARKER=disposable \
  RESTORE_CONFIRM_DATABASE="$BACKUP_VERIFY_DATABASE_NAME" \
  ALLOW_DESTRUCTIVE_RESTORE=YES \
    "$SCRIPT_DIR/restore.sh"
else
  log "gate 4/6 disposable restore integrity skipped (BACKUP_VERIFY_DATABASE_URL not supplied); archive verification remains mandatory"
fi

log "gate 5/6 migration: backup is verified; executing explicitly supplied command"
"$@"

log "gate 6/6 postcheck: migration must leave domain-live integrity valid"
DATABASE_URL="$DATABASE_URL" "$SCRIPT_DIR/assert_integrity.sh"

log "migration gate passed; rollback anchor is verified backup '$backup_file' plus the previous application release"
printf '%s\n' "$backup_file"
