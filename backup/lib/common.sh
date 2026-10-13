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
