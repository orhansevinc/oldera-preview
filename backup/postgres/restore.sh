#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../lib/common.sh"

require_cmd pg_restore psql
require_env TARGET_DATABASE_URL
backup_file="${BACKUP_FILE:-${1:-}}"
[[ -n "$backup_file" ]] || die "BACKUP_FILE or first argument is required"
[[ "${ALLOW_DESTRUCTIVE_RESTORE:-}" == "YES" ]] || die "refusing destructive restore: set ALLOW_DESTRUCTIVE_RESTORE=YES"

target_environment="${TARGET_ENVIRONMENT:-local}"
target_marker="${RESTORE_TARGET_MARKER:-}"
case "$target_environment" in
  local|test|ci)
    [[ "$target_marker" == "disposable" ]] || die "local/test/ci restore requires RESTORE_TARGET_MARKER=disposable"
    ;;
  production)
    [[ "${ALLOW_PRODUCTION_RESTORE:-}" == "YES_I_HAVE_AN_APPROVED_INCIDENT" ]] || die "production restore requires explicit incident approval token"
    [[ "$target_marker" == "approved-production" ]] || die "production restore requires RESTORE_TARGET_MARKER=approved-production"
    ;;
  *) die "unsupported TARGET_ENVIRONMENT: $target_environment" ;;
esac

"$SCRIPT_DIR/verify_backup.sh" "$backup_file"

target_db_name="$(psql "$TARGET_DATABASE_URL" -X -v ON_ERROR_STOP=1 -Atqc 'SELECT current_database();')"
[[ -n "$target_db_name" ]] || die "could not resolve target database"
case "$target_db_name" in
  postgres|template0|template1) die "refusing restore into protected administrative database: $target_db_name" ;;
esac
[[ -n "${RESTORE_CONFIRM_DATABASE:-}" ]] || die "RESTORE_CONFIRM_DATABASE must name the exact target database"
[[ "$RESTORE_CONFIRM_DATABASE" == "$target_db_name" ]] || die "restore target confirmation mismatch: expected '$target_db_name'"

log "restoring verified archive into target database '$target_db_name' (environment=$target_environment)"
pg_restore \
  --dbname "$TARGET_DATABASE_URL" \
  --clean \
  --if-exists \
  --exit-on-error \
  --single-transaction \
  --no-owner \
  --no-privileges \
  "$backup_file"

if [[ "${RUN_POST_RESTORE_INTEGRITY:-1}" == "1" ]]; then
  expected_head="$(metadata_value "${backup_file}.meta" migration_head_name)"
  expected_ledger="$(metadata_value "${backup_file}.meta" migration_ledger_sha256)"
  expected_schema="$(metadata_value "${backup_file}.meta" schema_fingerprint_sha256)"
  DATABASE_URL="$TARGET_DATABASE_URL" \
  EXPECTED_MIGRATION_HEAD="$expected_head" \
  EXPECTED_MIGRATION_LEDGER_SHA256="$expected_ledger" \
  EXPECTED_SCHEMA_FINGERPRINT_SHA256="$expected_schema" \
    "$SCRIPT_DIR/assert_integrity.sh"
  DATABASE_URL="$TARGET_DATABASE_URL" "$SCRIPT_DIR/assert_metadata_counts.sh" "${backup_file}.meta"
fi

log "restore completed and verified"
