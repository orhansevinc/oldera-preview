#!/usr/bin/env sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "usage: $0 deploy/backups/<file>.sql.gz" >&2
  exit 2
fi

COMPOSE_FILE=${COMPOSE_FILE:-docker-compose.ws09.yml}
POSTGRES_DB=${POSTGRES_DB:-oldkoweb}
POSTGRES_USER=${POSTGRES_USER:-oldkoweb}
FILE=$1

test -f "$FILE"
gzip -t "$FILE"
printf 'Restore %s into database %s? Type RESTORE: ' "$FILE" "$POSTGRES_DB" >&2
read answer
[ "$answer" = RESTORE ] || { echo "aborted" >&2; exit 1; }

gzip -dc "$FILE" | docker compose -f "$COMPOSE_FILE" exec -T db \
  psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" "$POSTGRES_DB"
