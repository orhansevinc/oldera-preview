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

if [ "${MIME_ONLY:-0}" != "1" ]; then
  curl -fsS "$BASE/healthz" >/dev/null
  curl -fsS "$BASE/gateway-auth-healthz" >/dev/null
  curl -fsS "$BASE/gateway-game-healthz" >/dev/null
  curl -fsS "$BASE/play-shell/config.json" >/dev/null
fi

content_type() {
  curl -fsSI "$1" \
    | tr -d '\r' \
    | grep -i '^Content-Type:' \
    | head -n 1 \
    | sed 's/^[^:]*:[[:space:]]*//'
}

# WS12 strictContentType compares the complete response value to the WS38 manifest.
js_type=$(content_type "$BASE/real1298/KnightOnLine.js")
wasm_type=$(content_type "$BASE/real1298/KnightOnLine.wasm")
data_type=$(content_type "$BASE/real1298/KnightOnLine.data")

[ "$js_type" = "text/javascript; charset=utf-8" ] || {
  echo "unexpected js content-type: ${js_type:-missing}" >&2
  exit 1
}

[ "$wasm_type" = "application/wasm" ] || {
  echo "unexpected wasm content-type: ${wasm_type:-missing}" >&2
  exit 1
}

[ "$data_type" = "application/octet-stream" ] || {
  echo "unexpected data content-type: ${data_type:-missing}" >&2
  exit 1
}

# CI supplies a synthetic .mjs fixture so both extensions in the nginx mapping
# are exercised without requiring an .mjs file in the real client package.
if [ -n "${MJS_SMOKE_PATH:-}" ]; then
  mjs_type=$(content_type "$BASE/$MJS_SMOKE_PATH")
  [ "$mjs_type" = "text/javascript; charset=utf-8" ] || {
    echo "unexpected mjs content-type: ${mjs_type:-missing}" >&2
    exit 1
  }
fi

echo "staging smoke: ok ($BASE; js=$js_type wasm=$wasm_type data=$data_type)"
