#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-all}"
CODE_SHA='99c6571be82644436b83b7ccca299d384126f0ee'
OPENKO_SHA='97eb0ea20207afc0c360bfed6915113572711be3'
KO_ASSETS_SHA='2055ee6ed77f1b5cfef23832dd5bc31909e14a66'
WS05_SHA='0537c481383a69c534799b43810f35e7279c5578'
WS10_SHA='163f2ebf81e750bf746fdaa277695329a0682e22'
EMSCRIPTEN_VERSION='3.1.50'
WORKFLOW_BLOB='51b7e83c8761f37362d41b85c61377e2afd9fb95'
RELEASE_ID='oldkoweb-phase2-20261015-local'
ARTIFACTS='artifacts/phase2-qa'
mkdir -p "$ARTIFACTS" .local-gate .local-cache

workflow_blob="$(git rev-parse HEAD:.github/workflows/p2-00-final-release.yml)"
if [[ "$workflow_blob" != "$WORKFLOW_BLOB" ]]; then
  echo "workflow parity refused: expected $WORKFLOW_BLOB got $workflow_blob" >&2
  exit 2
fi
for p in tools/p2-00/build-client.sh qa/phase2/selftest.mjs qa/phase2/p2-00-browser-e2e.cjs hosting/p2-12/Host-Readiness.ps1 hosting/p2-00/Apply-Release.ps1 deploy/domain-live/docker-compose.yml; do
  [[ -f "$p" ]] || { echo "missing canonical mechanism: $p" >&2; exit 2; }
done
[[ "$(git -C ko-assets rev-parse HEAD)" == "$KO_ASSETS_SHA" ]] || { echo 'KO assets pin mismatch' >&2; exit 2; }
[[ "$(git -C .providers/ws05 rev-parse HEAD)" == "$WS05_SHA" ]] || { echo 'WS05 pin mismatch' >&2; exit 2; }
[[ "$(git -C .providers/ws10 rev-parse HEAD)" == "$WS10_SHA" ]] || { echo 'WS10 pin mismatch' >&2; exit 2; }

prepare_openko() {
  if [[ -d openko/.git ]]; then
    local head dirty stamp archived
    head="$(git -C openko rev-parse HEAD)"
    dirty="$(git -C openko status --porcelain)"
    if [[ "$head" == "$OPENKO_SHA" && -z "$dirty" ]]; then return; fi
    stamp="$(date -u +%Y%m%dT%H%M%SZ)-$$"
    archived=".local-cache/openko-$stamp"
    mv openko "$archived"
    git clone --no-checkout "$archived" openko
    git -C openko remote set-url origin https://github.com/luisfelipe18/old-school-openko.git
    git -C openko checkout --detach "$OPENKO_SHA"
  else
    echo 'openko source missing; rerun coordination/local-first/Transfer-LocalFirst.ps1' >&2
    exit 2
  fi
  [[ "$(git -C openko rev-parse HEAD)" == "$OPENKO_SHA" ]]
  [[ -z "$(git -C openko status --porcelain)" ]]
}

build_client() {
  command -v emcc >/dev/null || { echo 'emcc missing; install/activate Emscripten 3.1.50 per README-LOCAL.md' >&2; exit 2; }
  emcc --version | grep -F "$EMSCRIPTEN_VERSION" >/dev/null || { echo 'wrong Emscripten version' >&2; exit 2; }
  prepare_openko
  if [[ -d build-web ]]; then mv build-web ".local-cache/build-web-$(date -u +%Y%m%dT%H%M%SZ)-$$"; fi
  OPENKO_SHA="$OPENKO_SHA" KO_ASSETS_SHA="$KO_ASSETS_SHA" WS05_ROOT=.providers/ws05 WS10_ROOT=.providers/ws10 bash tools/p2-00/build-client.sh
  P2_SOURCE_SHA="$CODE_SHA" RELEASE_ID="$RELEASE_ID" python3 - <<'PY'
import hashlib,json,os,pathlib
root=pathlib.Path('real1298')
roles={'js':'KnightOnLine.js','wasm':'KnightOnLine.wasm','data':'KnightOnLine.data'}
files=[]; material=[]
mime={'js':'text/javascript','wasm':'application/wasm','data':'application/octet-stream'}
for role,name in roles.items():
    p=root/name; b=p.read_bytes(); h=hashlib.sha256(b).hexdigest(); material.append(f'{role}:{h}:{len(b)}')
    files.append({'role':role,'name':name,'url':f'/real1298/{name}','bytes':len(b),'sha256':h,'mime':mime[role],'startup':True})
digest=hashlib.sha256('\n'.join(material).encode()).hexdigest()
doc={'schema':'oldkoweb/runtime-manifest/v1','release_id':os.environ['RELEASE_ID'],'content_version':digest[:20],
     'source':{'source_commit':os.environ['P2_SOURCE_SHA'],'artifact_id':'local-first','artifact_digest':'sha256:'+digest},
     'files':files,'cache_policy':{'runtime':'immutable-by-sha256-query','manifest':'no-store','auth_game_api':'bypass'}}
(root/'runtime-manifest.json').write_text(json.dumps(doc,indent=2)+'\n')
PY
  python3 tools/p2-02/Verify-LoadingContracts.py
  mkdir -p runtime
  curl --fail --location --silent --show-error 'https://raw.githubusercontent.com/Open-KO/KnightOnline/7d6cf81093e142c928c2ac9510512b2b182178b5/assets/Server/MAP/moradon_0826.smd' -o runtime/moradon_0826.smd
  python3 - <<'PY'
import hashlib,pathlib
p=pathlib.Path('runtime/moradon_0826.smd'); b=p.read_bytes()
assert len(b)==786000,len(b)
blob=hashlib.sha1(f'blob {len(b)}\0'.encode()+b).hexdigest()
assert blob=='cf47772b8e42a8bad71032419f47978c8bbd6142',blob
PY
}

contracts() {
  npm --prefix services/oldko-data install --omit=dev --ignore-scripts
  npm --prefix services/account-api install --omit=dev --ignore-scripts
  npm --prefix services/ko-gateway install --omit=dev --ignore-scripts
  node --test tests/ko-gateway/*.test.js
  node --test tests/ko1298-session/*.test.js
  if compgen -G 'tests/ko1298-combat/*.test.js' >/dev/null; then node --test tests/ko1298-combat/*.test.js; fi
  if compgen -G 'tests/ko1298-progression/*.test.js' >/dev/null; then node --test tests/ko1298-progression/*.test.js; fi
  if compgen -G 'tests/ko1298-social/*.test.js' >/dev/null; then node --test tests/ko1298-social/*.test.js; fi
  if compgen -G 'tests/ko1298-items*/*.test.*' >/dev/null; then node --test tests/ko1298-items*/*.test.*; fi
  python3 -m unittest tests/client/test_p2_10_contracts.py
  python3 qa/phase2/selftest.mjs 2>/dev/null || node qa/phase2/selftest.mjs
}

images() {
  [[ -s real1298/KnightOnLine.wasm && -s real1298/runtime-manifest.json ]] || { echo 'client output missing; run build first' >&2; exit 2; }
  local short runtime_tag edge_tag
  short="${CODE_SHA:0:12}"
  runtime_tag="oldkoweb/runtime:p2-${short}-local"
  edge_tag="oldkoweb/edge:p2-${short}-local"
  docker build -t "$runtime_tag" -f deploy/domain-live/runtime.Dockerfile .
  docker build -t "$edge_tag" -f deploy/domain-live/edge.Dockerfile .
  printf 'RUNTIME_TAG=%q\nEDGE_TAG=%q\n' "$runtime_tag" "$edge_tag" > .local-gate/image-tags.env
  docker image inspect "$runtime_tag" --format '{{.Id}}' > "$ARTIFACTS/runtime-image-id.txt"
  docker image inspect "$edge_tag" --format '{{.Id}}' > "$ARTIFACTS/edge-image-id.txt"
}

smoke() {
  [[ -f .local-gate/image-tags.env ]] || { echo 'local image tags missing; run images first' >&2; exit 2; }
  # shellcheck disable=SC1091
  source .local-gate/image-tags.env
  docker image inspect "$RUNTIME_TAG" >/dev/null
  docker image inspect "$EDGE_TAG" >/dev/null
  local tmp secret_dir env_file project
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/oldkoweb-p2-local.XXXXXX")"
  secret_dir="$tmp/secrets"; mkdir -p "$secret_dir"
  env_file="$tmp/p2.env"
  project="oldkoweb-p2-local-$(date -u +%Y%m%d%H%M%S)-$$"
  printf '[{"id":"local-owner","username":"owner","passwordHash":"ci-not-used","roles":["OWNER"]}]\n' > "$secret_dir/admin-users.json"
  printf '0123456789abcdef0123456789abcdef0123456789abcdef\n' > "$secret_dir/admin-session-secret.txt"
  cat > "$env_file" <<EOF
POSTGRES_IMAGE=postgres:16-alpine
POSTGRES_PASSWORD=p2-ci-postgres
DATABASE_URL=postgres://oldkoweb:p2-ci-postgres@db:5432/oldkoweb
RUNTIME_IMAGE=$RUNTIME_TAG
EDGE_IMAGE=$EDGE_TAG
ADMIN_USERS_JSON_FILE=$secret_dir/admin-users.json
ADMIN_SESSION_SECRET_FILE=$secret_dir/admin-session-secret.txt
ADMIN_ALLOWED_ORIGINS=http://admin.oldkoweb.com:18088
ACCOUNT_ALLOWED_ORIGINS=http://oldkoweb.com:18088
PLAY_ALLOWED_ORIGINS=http://play.oldkoweb.com:18088
PLAY_ALLOWED_HOSTS=play.oldkoweb.com
EDGE_PORT=18088
EOF
  dc(){ docker compose --project-name "$project" --env-file "$env_file" -f deploy/domain-live/docker-compose.yml "$@"; }
  trap 'dc logs --no-color > artifacts/phase2-qa/compose.log 2>&1 || true; dc down --remove-orphans >/dev/null 2>&1 || true' EXIT
  dc up -d db
  for _ in {1..60}; do dc exec -T db pg_isready -U oldkoweb -d oldkoweb >/dev/null 2>&1 && break; sleep 1; done
  dc run --rm --no-deps runtime node services/oldko-data/src/scripts/migrate.js
  dc run --rm --no-deps account-api node services/account-api/src/scripts/apply-rate-limit-schema.js
  local hash
  hash="$(node --input-type=module - <<'NODE'
import {hashPassword} from './services/oldko-data/src/index.js';
process.stdout.write(await hashPassword('p2e2epass'));
NODE
)"
  printf "INSERT INTO oldko.accounts(username,username_key,password_hash,email,status,nation,verified_at) VALUES('p2e2e','p2e2e','%s','p2e2e@example.invalid','active',0,now());\n" "$hash" | dc exec -T db psql -v ON_ERROR_STOP=1 -U oldkoweb -d oldkoweb
  dc up -d
  for _ in {1..90}; do if curl -fsS -H 'Host: play.oldkoweb.com' http://127.0.0.1:18088/ >/dev/null; then break; fi; sleep 2; done
  dc ps | tee "$ARTIFACTS/compose-ps.txt"
  curl -fsSI -H 'Host: play.oldkoweb.com' http://127.0.0.1:18088/ | tee "$ARTIFACTS/play-headers.txt"
  grep -qi 'cross-origin-opener-policy: same-origin' "$ARTIFACTS/play-headers.txt"
  grep -qi 'cross-origin-embedder-policy: require-corp' "$ARTIFACTS/play-headers.txt"
  NODE_PATH="$PWD/.local-deps/node_modules" P2_PLAY_URL='http://play.oldkoweb.com:18088/' P2_QA_OUT="$ARTIFACTS/local-browser" P2_QA_USER=p2e2e P2_QA_PASSWORD=p2e2epass P2_QA_CHAR=P2Hero node qa/phase2/p2-00-browser-e2e.cjs
  dc restart runtime
  sleep 4
  dc exec -T db psql -U oldkoweb -d oldkoweb -Atc "SELECT count(*) FROM oldko.characters WHERE name='P2Hero' AND deleted_at IS NULL" | grep -qx '1'
  echo 'LOCAL_RESTART_PERSISTENCE PASS' | tee "$ARTIFACTS/restart-persistence.txt"
}

case "$MODE" in
  build) build_client ;;
  contracts) contracts ;;
  images) images ;;
  smoke) smoke ;;
  all) build_client; contracts; images; smoke ;;
  *) echo 'usage: local-release-gate.sh {build|contracts|images|smoke|all}' >&2; exit 2 ;;
esac
