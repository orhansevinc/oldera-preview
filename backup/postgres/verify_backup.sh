#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../lib/common.sh"

require_cmd pg_restore

backup_file="${1:-${BACKUP_FILE:-}}"
[[ -n "$backup_file" ]] || die "usage: verify_backup.sh /path/to/backup.dump"
[[ -f "$backup_file" ]] || die "backup file does not exist: $backup_file"
meta_file="${backup_file}.meta"
checksum_file="${backup_file}.sha256"
[[ -f "$meta_file" ]] || die "metadata file missing: $meta_file"
[[ -f "$checksum_file" ]] || die "checksum file missing: $checksum_file"

expected_meta_sha="$(metadata_value "$meta_file" dump_sha256)"
[[ "$expected_meta_sha" =~ ^[0-9a-fA-F]{64}$ ]] || die "metadata dump_sha256 is invalid"
actual_sha="$(sha256_file "$backup_file")"
[[ "${actual_sha,,}" == "${expected_meta_sha,,}" ]] || die "backup checksum mismatch against metadata"

checksum_dir="$(cd -- "$(dirname -- "$checksum_file")" && pwd)"
checksum_name="$(basename -- "$checksum_file")"
(
  cd "$checksum_dir"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum -c "$checksum_name" >/dev/null
  elif command -v shasum >/dev/null 2>&1; then
    recorded="$(awk '{print $1}' "$checksum_name")"
    [[ "${recorded,,}" == "${actual_sha,,}" ]]
  else
    die "sha256sum or shasum is required"
  fi
)

archive_list="$(pg_restore --list "$backup_file")"
[[ -n "$archive_list" ]] || die "pg_restore --list returned an empty archive inventory"

format="$(metadata_value "$meta_file" backup_format)"
metadata_version="$(metadata_value "$meta_file" metadata_version)"
[[ "$format" == "postgres_custom" ]] || die "unsupported backup_format: $format"
[[ "$metadata_version" == "2" ]] || die "unsupported metadata_version: $metadata_version"

schema_sha="$(metadata_value "$meta_file" schema_fingerprint_sha256)"
ledger_sha="$(metadata_value "$meta_file" migration_ledger_sha256)"
[[ "$schema_sha" =~ ^[0-9a-fA-F]{64}$ ]] || die "metadata schema_fingerprint_sha256 is invalid"
[[ "$ledger_sha" =~ ^[0-9a-fA-F]{64}$ ]] || die "metadata migration_ledger_sha256 is invalid"

log "backup integrity verified: $(basename -- "$backup_file")"
