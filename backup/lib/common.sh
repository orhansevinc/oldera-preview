#!/usr/bin/env bash
set -Eeuo pipefail

log() {
  printf '[ws30] %s\n' "$*" >&2
}

die() {
  log "ERROR: $*"
  exit 1
}

require_cmd() {
  local cmd
  for cmd in "$@"; do
    command -v "$cmd" >/dev/null 2>&1 || die "required command not found: $cmd"
  done
}

require_env() {
  local name="$1"
  [[ -n "${!name:-}" ]] || die "required environment variable is empty: $name"
}

sha256_file() {
  local file="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file" | awk '{print $1}'
  else
    die "sha256sum or shasum is required"
  fi
}

sha256_stdin() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 | awk '{print $1}'
  else
    die "sha256sum or shasum is required"
  fi
}

free_bytes_for_path() {
  local path="$1"
  local blocks
  blocks="$(df -Pk "$path" | awk 'NR==2 {print $4}')"
  [[ "$blocks" =~ ^[0-9]+$ ]] || die "could not determine free disk space for $path"
  printf '%s\n' "$((blocks * 1024))"
}

metadata_value() {
  local file="$1" key="$2"
  awk -F= -v wanted="$key" '$1 == wanted {sub(/^[^=]*=/, ""); print; exit}' "$file"
}

assert_safe_metadata_value() {
  local value="$1" field="$2"
  [[ "$value" != *$'\n'* && "$value" != *$'\r'* ]] || die "unsafe newline in metadata field: $field"
}

schema_inventory() {
  local database_url="$1"
  psql "$database_url" -X -v ON_ERROR_STOP=1 -Atqc "
    SELECT line FROM (
      SELECT 'TABLE|' || n.nspname || '|' || c.relname AS line
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE c.relkind='r' AND (n.nspname='oldko' OR (n.nspname='public' AND c.relname='_oldko_migrations'))
      UNION ALL
      SELECT 'CONSTRAINT|' || n.nspname || '|' || c.relname || '|' || con.conname || '|' || con.contype::text || '|' || replace(pg_get_constraintdef(con.oid,true), E'\\n', ' ')
      FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='oldko' OR (n.nspname='public' AND c.relname='_oldko_migrations')
      UNION ALL
      SELECT 'INDEX|' || schemaname || '|' || tablename || '|' || indexname || '|' || replace(indexdef, E'\\n', ' ')
      FROM pg_indexes
      WHERE schemaname='oldko' OR (schemaname='public' AND tablename='_oldko_migrations')
    ) inventory
    ORDER BY line;"
}

schema_fingerprint() {
  local database_url="$1"
  schema_inventory "$database_url" | sha256_stdin
}

migration_ledger_text() {
  local database_url="$1"
  psql "$database_url" -X -v ON_ERROR_STOP=1 -Atqc "SELECT name || '|' || checksum FROM public._oldko_migrations ORDER BY name;"
}

migration_ledger_fingerprint() {
  local database_url="$1"
  migration_ledger_text "$database_url" | sha256_stdin
}
