#!/bin/sh
set -eu

dry_run=0
if [ "${1:-}" = "--dry-run" ]; then
  dry_run=1
  shift
fi

state_file=${1:-deploy/state/previous-release}
[ -f "$state_file" ] || {
  echo "no previous release recorded at $state_file" >&2
  exit 1
}
previous=$(cat "$state_file")
[ -n "$previous" ] || { echo "previous release path is empty" >&2; exit 1; }

if [ "$dry_run" -eq 1 ]; then
  deploy/release-switch.sh --dry-run "$previous"
  echo "rollback dry-run: PASS previous=$previous"
else
  deploy/release-switch.sh "$previous"
  echo "rollback: PASS previous=$previous"
fi
