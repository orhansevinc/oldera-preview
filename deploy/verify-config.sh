#!/usr/bin/env sh
set -eu

python3 - <<'PY'
from pathlib import Path
import yaml

checks = {
    'docker-compose.ws09.yml': {'reverse-proxy','account-api','admin-api','session-world','gateway-auth','gateway-game','db'},
    'docker-compose.ws09-staging.yml': {'reverse-proxy','session-world','gateway-auth','gateway-game'},
}

for filename, required in checks.items():
    data = yaml.safe_load(Path(filename).read_text())
    missing = required - set(data.get('services', {}))
    if missing:
        raise SystemExit(f'{filename}: missing services: {sorted(missing)}')
    print(f'{filename}: compose-yaml ok')
PY

for f in \
  deploy/backup-db.sh \
  deploy/restore-db.sh \
  deploy/staging-up.sh \
  deploy/staging-smoke.sh \
  deploy/production-smoke.sh \
  deploy/release-switch.sh \
  deploy/rollback-static.sh \
  deploy/validate-production-env.sh \
  deploy/migrate-production-db.sh
do
  sh -n "$f"
done
node --check deploy/ko-auth-roundtrip-smoke.mjs

# WS38 manifest + WS12 strictContentType publication contract.
grep -Eq 'text/javascript[[:space:]]+js mjs;' infra/nginx/mime.types
if grep -Eq 'application/javascript[[:space:]]+js([[:space:]]|;)|application/javascript[[:space:]]+mjs([[:space:]]|;)' infra/nginx/mime.types; then
  echo 'legacy application/javascript mapping for js/mjs is forbidden by WS38/WS12 strict MIME contract' >&2
  exit 1
fi
grep -Eq 'charset[[:space:]]+utf-8;' infra/nginx/nginx.conf
grep -Eq 'charset_types[^;]*text/javascript' infra/nginx/nginx.conf

grep -Eq 'application/wasm[[:space:]]+wasm;' infra/nginx/mime.types
grep -Eq 'application/octet-stream[[:space:]]+data' infra/nginx/mime.types

# Production edge: official/play/admin only; same-origin account/auth/game/admin; immutable content.
grep -q 'proxy_set_header Upgrade \$http_upgrade' infra/nginx/templates/production.conf.template
grep -q 'proxy_set_header Connection \$connection_upgrade' infra/nginx/templates/production.conf.template
grep -q 'proxy_pass http://account-api:${ACCOUNT_API_PORT}/;' infra/nginx/templates/production.conf.template
grep -q 'location /api/account/' infra/nginx/templates/production.conf.template
grep -q 'proxy_pass http://gateway-auth:${GATEWAY_INTERNAL_PORT}' infra/nginx/templates/production.conf.template
grep -q 'proxy_pass http://gateway-game:${GATEWAY_INTERNAL_PORT}' infra/nginx/templates/production.conf.template
grep -q 'location = /auth' infra/nginx/templates/production.conf.template
grep -q 'location = /game' infra/nginx/templates/production.conf.template
grep -q 'location /api/admin/' infra/nginx/templates/production.conf.template
grep -q 'proxy_pass http://admin-api:${ADMIN_API_PORT};' infra/nginx/templates/production.conf.template
grep -q 'max-age=31536000, immutable' infra/nginx/templates/production.conf.template
grep -q 'no-store, max-age=0' infra/nginx/templates/production.conf.template
! grep -q '\${API_HOST}' infra/nginx/templates/production.conf.template
! grep -q '\${GATEWAY_HOST}' infra/nginx/templates/production.conf.template
! grep -q 'Strict-Transport-Security' infra/nginx/templates/production.conf.template

grep -q '^  account-api:' docker-compose.ws09.yml
grep -q 'OLDKO_ACCOUNT_ALLOWED_ORIGINS: https://oldkoweb.com' docker-compose.ws09.yml
grep -q 'OLDKO_TRUST_PROXY: "1"' docker-compose.ws09.yml
grep -q 'OLDKO_ACCOUNT_REPOSITORY_MODULE:' docker-compose.ws09.yml
grep -q 'OLDKO_ACCOUNT_DELIVERY_WEBHOOK_URL:' docker-compose.ws09.yml
grep -q '^  admin-api:' docker-compose.ws09.yml
grep -q 'ADMIN_ALLOWED_ORIGINS: https://admin.oldkoweb.com' docker-compose.ws09.yml
grep -q 'ADMIN_REPOSITORY_MODULE:' docker-compose.ws09.yml
grep -q 'ADMIN_RUNTIME_AUTHORITY_MODULE:' docker-compose.ws09.yml
grep -q 'ADMIN_COMMAND_BUS_MODULE:' docker-compose.ws09.yml
grep -q '/api/admin/health' docker-compose.ws09.yml
grep -q 'GATEWAY_MODE: auth' docker-compose.ws09.yml
grep -q 'GATEWAY_MODE: game' docker-compose.ws09.yml
grep -q 'WS_PATH: /auth' docker-compose.ws09.yml
grep -q 'WS_PATH: /game' docker-compose.ws09.yml
grep -q 'ALLOWED_ORIGINS:' docker-compose.ws09.yml
grep -q 'ALLOWED_HOSTS:' docker-compose.ws09.yml
grep -q 'internal: true' docker-compose.ws09.yml

# Ephemeral/staging contract remains unchanged and usable as fallback/dev.
grep -q 'proxy_pass http://gateway-auth:${GATEWAY_INTERNAL_PORT}' infra/nginx/templates/staging.conf.template
grep -q 'proxy_pass http://gateway-game:${GATEWAY_INTERNAL_PORT}' infra/nginx/templates/staging.conf.template
grep -q 'X-Forwarded-Host \$host' infra/nginx/templates/staging.conf.template
grep -q 'max-age=31536000, immutable' infra/nginx/templates/staging.conf.template
grep -q 'no-store, max-age=0' infra/nginx/templates/staging.conf.template

grep -q 'GATEWAY_MODE: auth' docker-compose.ws09-staging.yml
grep -q 'GATEWAY_MODE: game' docker-compose.ws09-staging.yml
grep -q 'WS_PATH: /auth' docker-compose.ws09-staging.yml
grep -q 'WS_PATH: /game' docker-compose.ws09-staging.yml
grep -q 'ALLOWED_ORIGINS:' docker-compose.ws09-staging.yml
grep -q 'ALLOWED_HOSTS:' docker-compose.ws09-staging.yml
grep -q 'AUTH_PORT:' docker-compose.ws09-staging.yml
grep -q 'GAME_PORT:' docker-compose.ws09-staging.yml

echo 'static checks: ok'
