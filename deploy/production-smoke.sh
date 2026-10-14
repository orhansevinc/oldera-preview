#!/bin/sh
set -eu

SITE_ORIGIN=${SITE_ORIGIN:-https://oldkoweb.com}
PLAY_ORIGIN=${PLAY_ORIGIN:-https://play.oldkoweb.com}
ADMIN_ORIGIN=${ADMIN_ORIGIN:-https://admin.oldkoweb.com}

tmp_headers=$(mktemp)
tmp_body=$(mktemp)
trap 'rm -f "$tmp_headers" "$tmp_body"' EXIT HUP INT TERM

curl -fsS "$SITE_ORIGIN/healthz" >/dev/null
curl -fsS "$PLAY_ORIGIN/healthz" >/dev/null
curl -fsS "$ADMIN_ORIGIN/healthz" >/dev/null
curl -fsS "$PLAY_ORIGIN/play-shell/" >/dev/null

latest_headers=$(mktemp)
latest_body=$(mktemp)
trap 'rm -f "$tmp_headers" "$tmp_body" "$latest_headers" "$latest_body"' EXIT HUP INT TERM
curl -fsS -D "$latest_headers" -o "$latest_body" "$PLAY_ORIGIN/latest.json"
grep -Eiq '^cache-control:.*(no-store|no-cache)' "$latest_headers" || {
  echo 'latest.json must be non-cacheable' >&2
  exit 1
}

manifest_path=$(node -e "const f=require('fs');const j=JSON.parse(f.readFileSync(process.argv[1]));if(!j.manifestPath)process.exit(2);process.stdout.write(j.manifestPath)" "$latest_body")
manifest=$(curl -fsS "$PLAY_ORIGIN/$manifest_path")
data_path=$(printf '%s' "$manifest" | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  const m=JSON.parse(s);
  const f=(m.files||[]).find(x=>x.required && x.path.endsWith(".data"));
  if(!f || !m.immutableBasePath) process.exit(2);
  process.stdout.write(m.immutableBasePath.replace(/\/$/,"")+"/"+f.path.replace(/^\//,""));
});')

curl -fsS -D "$tmp_headers" -o "$tmp_body" -H 'Range: bytes=0-15' "$PLAY_ORIGIN$data_path"
grep -Eq '^HTTP/[0-9.]+ 206 ' "$tmp_headers" || {
  echo 'KnightOnLine.data range request did not return 206' >&2
  cat "$tmp_headers" >&2
  exit 1
}
grep -Eiq '^content-range: bytes 0-15/' "$tmp_headers" || {
  echo 'KnightOnLine.data range response missing expected Content-Range' >&2
  exit 1
}
[ "$(wc -c < "$tmp_body" | tr -d ' ')" = "16" ] || {
  echo 'KnightOnLine.data range response body was not 16 bytes' >&2
  exit 1
}

node deploy/ko-auth-roundtrip-smoke.mjs "$PLAY_ORIGIN"

echo "production smoke: PASS site=$SITE_ORIGIN play=$PLAY_ORIGIN admin=$ADMIN_ORIGIN range=data[0-15] auth=binary game=upgrade"
