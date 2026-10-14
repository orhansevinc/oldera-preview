#!/bin/sh
set -eu

env_file=${1:-deploy/.env.production}
[ -f "$env_file" ] || {
  echo "missing production env: $env_file" >&2
  exit 2
}

getv() {
  key=$1
  sed -n "s/^${key}=//p" "$env_file" | tail -n1
}

assert_eq() {
  key=$1 expected=$2
  value=$(getv "$key")
  [ "$value" = "$expected" ] || {
    echo "$key must equal $expected, got ${value:-<missing>}" >&2
    exit 1
  }
}

assert_digest() {
  key=$1
  value=$(getv "$key")
  printf '%s\n' "$value" | grep -Eq '^.+@sha256:[0-9a-f]{64}$' || {
    echo "$key must be an immutable image@sha256:<64hex> identity" >&2
    exit 1
  }
}

assert_eq OFFICIAL_HOST oldkoweb.com
assert_eq PLAY_HOST play.oldkoweb.com
assert_eq ADMIN_HOST admin.oldkoweb.com
assert_eq PLAY_PUBLIC_ORIGIN https://play.oldkoweb.com
assert_eq PLAY_ALLOWED_HOST play.oldkoweb.com

for key in NGINX_IMAGE POSTGRES_IMAGE ADMIN_API_IMAGE GATEWAY_IMAGE KO_SESSION_WORLD_IMAGE; do
  assert_digest "$key"
done

secret_file=$(getv POSTGRES_PASSWORD_FILE)
[ -n "$secret_file" ] || { echo 'POSTGRES_PASSWORD_FILE is required' >&2; exit 1; }
[ -f "$secret_file" ] || { echo "secret file not found: $secret_file" >&2; exit 1; }

for required in WS10_RUN_ID WS10_HEAD_SHA WS10_CLIENT_ARTIFACT WS50_HANDOFF_REF CONTENT_VERSION BUILD_ID; do
  [ -n "$(getv "$required")" ] || { echo "missing release identity: $required" >&2; exit 1; }
done

docker compose --env-file "$env_file" -f docker-compose.ws09.yml config --quiet

echo "production env validation: PASS hosts=official/play/admin images=immutable release=$(getv CONTENT_VERSION)"
