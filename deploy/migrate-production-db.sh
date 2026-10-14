#!/usr/bin/env sh
set -eu

usage() {
  echo "usage: $0 --env-file <production-env> --backup <verified.sql.gz>" >&2
  exit 2
}

env_file=
backup=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --env-file) [ "$#" -ge 2 ] || usage; env_file=$2; shift 2 ;;
    --backup) [ "$#" -ge 2 ] || usage; backup=$2; shift 2 ;;
    *) usage ;;
  esac
done

[ -n "$env_file" ] && [ -f "$env_file" ] || usage
[ -n "$backup" ] && [ -s "$backup" ] || { echo "verified pre-migration backup is required" >&2; exit 1; }
gzip -t "$backup"

compose="docker compose --env-file $env_file -f docker-compose.ws09.yml"

# The database must already be up and healthy. Migrations are forward-only here;
# application rollback never destroys or reverses database state automatically.
$compose up -d db

# Apply the pinned WS07 migrations only through 0003_public_account_api.sql.
$compose run --rm --no-deps \
  -e OLDKO_MIGRATION_TARGET=0003_public_account_api.sql \
  account-api npm run migrate --prefix /opt/oldkoweb/ws07/services/oldko-data

# Apply WS13's shared PostgreSQL rate-limit schema after the account tables exist.
$compose run --rm --no-deps \
  account-api npm run migrate:rate-limit --prefix /opt/oldkoweb/ws13/services/account-api

echo "production migrations: PASS backup=$backup target=0003_public_account_api.sql rate_limit=applied"
