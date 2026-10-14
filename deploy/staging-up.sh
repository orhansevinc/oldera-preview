#!/usr/bin/env sh
set -eu

ENV_FILE=${1:-deploy/.env.staging}
COMPOSE_FILE=docker-compose.ws09-staging.yml
ARTIFACT_ROOT=deploy/artifacts/staging-play

if [ ! -f "$ENV_FILE" ]; then
  echo "missing $ENV_FILE; copy deploy/.env.staging.example and set staging host/image values" >&2
  exit 1
fi

for path in \
  "$ARTIFACT_ROOT/play-shell/index.html" \
  "$ARTIFACT_ROOT/play-shell/config.json" \
  "$ARTIFACT_ROOT/real1298/index.html" \
  "$ARTIFACT_ROOT/real1298/KnightOnLine.js" \
  "$ARTIFACT_ROOT/real1298/KnightOnLine.wasm" \
  "$ARTIFACT_ROOT/real1298/KnightOnLine.data"
do
  if [ ! -f "$path" ]; then
    echo "missing staging artifact: $path" >&2
    exit 1
  fi
done

# No secret values are expected in the staging env contract, but do not echo the file.
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config --quiet
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d

"$(dirname "$0")/staging-smoke.sh" "$ENV_FILE"
