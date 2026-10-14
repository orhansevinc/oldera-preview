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

assert_required_secure() {
  key=$1
  value=$(getv "$key")
  [ -n "$value" ] || { echo "$key is required" >&2; exit 1; }
  case "$value" in
    REQUIRED_*|CHANGEME*|changeme*)
      echo "$key still contains a deployment placeholder" >&2
      exit 1
      ;;
  esac
}

assert_eq OFFICIAL_HOST oldkoweb.com
assert_eq PLAY_HOST play.oldkoweb.com
assert_eq ADMIN_HOST admin.oldkoweb.com
assert_eq PLAY_PUBLIC_ORIGIN https://play.oldkoweb.com
assert_eq PLAY_ALLOWED_HOST play.oldkoweb.com
assert_eq OLDKO_ACCOUNT_REPOSITORY_MODULE /opt/oldkoweb/ws07/services/oldko-data/src/adapters/ws13-account-api.js

for key in NGINX_IMAGE POSTGRES_IMAGE ACCOUNT_API_IMAGE ADMIN_API_IMAGE GATEWAY_IMAGE KO_SESSION_WORLD_IMAGE; do
  assert_digest "$key"
done

for key in \
  ACCOUNT_DATABASE_URL OLDKO_ACCOUNT_DELIVERY_WEBHOOK_URL OLDKO_ACCOUNT_DELIVERY_WEBHOOK_SECRET \
  ADMIN_DATABASE_URL ADMIN_USERS_JSON ADMIN_ROOT_OWNER_ID ADMIN_SESSION_SECRET \
  ADMIN_REPOSITORY_MODULE ADMIN_RUNTIME_AUTHORITY_MODULE ADMIN_COMMAND_BUS_MODULE
do
  assert_required_secure "$key"
done

case "$(getv ACCOUNT_DATABASE_URL)" in
  postgres://*|postgresql://*) ;;
  *) echo 'ACCOUNT_DATABASE_URL must be a PostgreSQL URL supplied by the secure production configuration channel' >&2; exit 1 ;;
esac
case "$(getv ADMIN_DATABASE_URL)" in
  postgres://*|postgresql://*) ;;
  *) echo 'ADMIN_DATABASE_URL must be a PostgreSQL URL supplied by the secure production configuration channel' >&2; exit 1 ;;
esac
case "$(getv OLDKO_ACCOUNT_DELIVERY_WEBHOOK_URL)" in
  https://*) ;;
  *) echo 'OLDKO_ACCOUNT_DELIVERY_WEBHOOK_URL must use HTTPS' >&2; exit 1 ;;
esac

secret_file=$(getv POSTGRES_PASSWORD_FILE)
[ -n "$secret_file" ] || { echo 'POSTGRES_PASSWORD_FILE is required' >&2; exit 1; }
[ -f "$secret_file" ] || { echo "secret file not found: $secret_file" >&2; exit 1; }

for required in \
  WS10_RUN_ID WS10_HEAD_SHA WS10_CLIENT_ARTIFACT WS50_HANDOFF_REF CONTENT_VERSION BUILD_ID \
  OFFICIAL_SITE_HANDOFF_COMMIT OFFICIAL_SITE_SOURCE_COMMIT WS13_ACCOUNT_HEAD WS13_ACCOUNT_RUN_ID WS07_ACCOUNT_COMMIT \
  WS08_ADMIN_DOMAIN_SOURCE WS08_ADMIN_DOMAIN_HANDOFF_COMMIT WS08_ADMIN_RUN_ID \
  WS50_DOMAIN_LIVE_MANIFEST_COMMIT WS10_DOMAIN_LIVE_HEAD WS10_DOMAIN_LIVE_RUN_ID
do
  [ -n "$(getv "$required")" ] || { echo "missing release identity: $required" >&2; exit 1; }
done

docker compose --env-file "$env_file" -f docker-compose.ws09.yml config --quiet

echo "production env validation: PASS hosts=official/play/admin images=immutable account=fail-closed admin=fail-closed release=$(getv CONTENT_VERSION)"
