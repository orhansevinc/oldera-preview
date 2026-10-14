#!/usr/bin/env sh
set -eu

ENV_FILE=${1:-deploy/.env.staging}

if [ ! -f "$ENV_FILE" ]; then
  echo "missing $ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

BIND=${STAGING_HTTP_BIND:-8080}
BASE="http://127.0.0.1:${BIND}"

curl -fsS "$BASE/healthz" >/dev/null
curl -fsS "$BASE/gateway-auth-healthz" >/dev/null
curl -fsS "$BASE/gateway-game-healthz" >/dev/null
curl -fsS "$BASE/play-shell/config.json" >/dev/null

wasm_type=$(curl -fsSI "$BASE/real1298/KnightOnLine.wasm" | tr -d '\r' | awk 'BEGIN{IGNORECASE=1} /^Content-Type:/ {print $2; exit}')
data_type=$(curl -fsSI "$BASE/real1298/KnightOnLine.data" | tr -d '\r' | awk 'BEGIN{IGNORECASE=1} /^Content-Type:/ {print $2; exit}')

[ "$wasm_type" = "application/wasm" ] || {
  echo "unexpected wasm content-type: ${wasm_type:-missing}" >&2
  exit 1
}

[ "$data_type" = "application/octet-stream" ] || {
  echo "unexpected data content-type: ${data_type:-missing}" >&2
  exit 1
}

echo "staging smoke: ok ($BASE)"
