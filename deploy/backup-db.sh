#!/usr/bin/env sh
set -eu

COMPOSE_FILE=${COMPOSE_FILE:-docker-compose.ws09.yml}
BACKUP_DIR=${BACKUP_DIR:-deploy/backups}
POSTGRES_DB=${POSTGRES_DB:-oldkoweb}
POSTGRES_USER=${POSTGRES_USER:-oldkoweb}
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT="$BACKUP_DIR/${POSTGRES_DB}_${STAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"
docker compose -f "$COMPOSE_FILE" exec -T db \
  pg_dump --clean --if-exists --no-owner --no-privileges -U "$POSTGRES_USER" "$POSTGRES_DB" \
  | gzip -9 > "$OUT"

gzip -t "$OUT"
echo "$OUT"
