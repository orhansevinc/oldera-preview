#!/bin/sh
set -eu

dry_run=0
if [ "${1:-}" = "--dry-run" ]; then
  dry_run=1
  shift
fi

release_root=${1:-}
[ -n "$release_root" ] || {
  echo "usage: $0 [--dry-run] /absolute/path/to/release-root" >&2
  exit 2
}

case "$release_root" in
  /*) ;;
  *) echo "release root must be an absolute path" >&2; exit 2 ;;
esac

for part in site play admin; do
  [ -d "$release_root/$part" ] || {
    echo "release is missing $release_root/$part" >&2
    exit 1
  }
done

artifacts_dir=$(CDPATH= cd -- "$(dirname -- "$0")/artifacts" && pwd)
state_dir=$(dirname "$artifacts_dir")/state

if [ "$dry_run" -eq 1 ]; then
  echo "release switch dry-run: PASS root=$release_root targets=site,play,admin"
  exit 0
fi

mkdir -p "$state_dir"
current=''
if [ -L "$artifacts_dir/play" ]; then
  current=$(readlink "$artifacts_dir/play" | sed 's#/play$##')
fi
[ -z "$current" ] || printf '%s\n' "$current" > "$state_dir/previous-release"
printf '%s\n' "$release_root" > "$state_dir/current-release"

for part in site play admin; do
  tmp="$artifacts_dir/.${part}.next.$$"
  ln -s "$release_root/$part" "$tmp"
  mv -Tf "$tmp" "$artifacts_dir/$part"
done

echo "release switch: PASS root=$release_root"
