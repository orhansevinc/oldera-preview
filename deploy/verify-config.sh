#!/usr/bin/env sh
set -eu

python3 - <<'PY'
from pathlib import Path
import yaml
p=Path('docker-compose.ws09.yml')
data=yaml.safe_load(p.read_text())
required={'reverse-proxy','admin-api','ko-session','gateway','db'}
missing=required-set(data.get('services',{}))
if missing:
    raise SystemExit(f'missing services: {sorted(missing)}')
print('compose-yaml: ok')
PY

for f in deploy/backup-db.sh deploy/restore-db.sh; do
  sh -n "$f"
done

grep -Eq 'application/wasm[[:space:]]+wasm;' infra/nginx/mime.types
grep -Eq 'application/octet-stream[[:space:]]+data' infra/nginx/mime.types
grep -q 'proxy_set_header Upgrade \$http_upgrade' infra/nginx/templates/production.conf.template
grep -q 'proxy_set_header Connection \$connection_upgrade' infra/nginx/templates/production.conf.template
grep -q 'max-age=31536000, immutable' infra/nginx/templates/production.conf.template

echo 'static checks: ok'
