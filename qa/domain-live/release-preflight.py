#!/usr/bin/env python3
import json, os, pathlib, subprocess, sys
from datetime import datetime, timezone

REPO = pathlib.Path(__file__).resolve().parents[2]
OUT = pathlib.Path(os.environ.get('OLDKO_PREFLIGHT_RESULT', 'artifacts/domain-live/release-preflight.json'))
RELEASE_ID = os.environ.get('OLDKO_RELEASE_ID', 'oldkoweb-domain-live-20261015')

branches = {
    'WS50': 'ws50-integration-rehearsal',
    'WS09': 'ws09-production-infra',
    'WS10': 'ws10-qa-integration',
    'WS03': 'ws03-ko1298-session',
    'WS07': 'ws07-database',
    'WS08': 'ws08-admin-api',
    'WS13': 'ws13-account-api',
    'OFFICIAL_SITE': 'official-site-domain-release',
}

def run(*args, check=True):
    p = subprocess.run(args, cwd=REPO, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if check and p.returncode:
        raise RuntimeError(f"{' '.join(args)} failed: {p.stderr.strip()}")
    return p

def fetch_branch(branch):
    p = run('git', 'fetch', '--no-tags', 'origin', f'{branch}:refs/remotes/origin/{branch}', check=False)
    return p.returncode == 0, p.stderr.strip()

def sha(branch):
    p = run('git', 'rev-parse', f'refs/remotes/origin/{branch}', check=False)
    return p.stdout.strip() if p.returncode == 0 else None

def exists(commit, path):
    return run('git', 'cat-file', '-e', f'{commit}:{path}', check=False).returncode == 0

def grep_files(commit, needle):
    p = run('git', 'grep', '-l', '-F', needle, commit, '--', check=False)
    files=[]
    if p.returncode in (0,1):
        for line in p.stdout.splitlines():
            if ':' in line:
                _, path = line.split(':', 1)
                files.append(path)
    return sorted(set(files))

def read_json(commit, path):
    p = run('git', 'show', f'{commit}:{path}', check=False)
    if p.returncode:
        return None
    try:
        return json.loads(p.stdout)
    except Exception:
        return None

result = {
    'schema_version': 'ws10-domain-live-preflight/v1',
    'release_id': RELEASE_ID,
    'generated_at': datetime.now(timezone.utc).isoformat(),
    'gate': 'A_EXACT_RELEASE_COMPOSITION_PREFLIGHT',
    'resolved_refs': {},
    'checks': [],
    'blockers': [],
    'status': 'BLOCKED'
}

def check(cid, status, evidence=None):
    result['checks'].append({'id': cid, 'status': status, 'evidence': evidence or {}})

for owner, branch in branches.items():
    ok, err = fetch_branch(branch)
    s = sha(branch) if ok else None
    result['resolved_refs'][owner] = {'branch': branch, 'sha': s, 'fetch_error': None if ok else err}
    check(f'ref:{owner}', 'PASS' if s else 'BLOCKED', {'branch': branch, 'sha': s, 'error': None if ok else err})

ws50 = result['resolved_refs']['WS50']['sha']
ws09 = result['resolved_refs']['WS09']['sha']
ws03 = result['resolved_refs']['WS03']['sha']
ws13 = result['resolved_refs']['WS13']['sha']

ws50_candidates = grep_files(ws50, RELEASE_ID) if ws50 else []
result['ws50_release_files'] = ws50_candidates
manifest_like = [p for p in ws50_candidates if any(x in p.lower() for x in ('manifest','release','handoff','domain-live'))]
if manifest_like:
    check('ws50:exact-release-manifest', 'PASS', {'files': manifest_like, 'ws50_sha': ws50})
else:
    check('ws50:exact-release-manifest', 'BLOCKED', {'searched_release_id': RELEASE_ID, 'ws50_sha': ws50, 'matches': ws50_candidates})
    result['blockers'].append({'owner': 'WS50', 'code': 'EXACT_RELEASE_MANIFEST_MISSING', 'detail': f'No manifest/handoff containing {RELEASE_ID} was found at resolved WS50 head {ws50}.'})

ws09_candidates = grep_files(ws09, RELEASE_ID) if ws09 else []
result['ws09_release_files'] = ws09_candidates
receipt_like = [p for p in ws09_candidates if any(x in p.lower() for x in ('deployment','receipt','release','cutover','domain-live'))]
if receipt_like:
    check('ws09:exact-deployment-receipt', 'PASS', {'files': receipt_like, 'ws09_sha': ws09})
else:
    check('ws09:exact-deployment-receipt', 'BLOCKED', {'searched_release_id': RELEASE_ID, 'ws09_sha': ws09, 'matches': ws09_candidates})
    result['blockers'].append({'owner': 'WS09', 'code': 'EXACT_DEPLOYMENT_RECEIPT_MISSING', 'detail': f'No deployment receipt containing {RELEASE_ID} was found at resolved WS09 head {ws09}.'})

if ws03 and exists(ws03, 'workstreams/ws03/PRODUCTION_POSTGRES_COMPOSITION.json'):
    d = read_json(ws03, 'workstreams/ws03/PRODUCTION_POSTGRES_COMPOSITION.json') or {}
    check('ws03:postgres-composition', 'PASS', {'sha': ws03, 'entrypoint': (d.get('runtime') or {}).get('productionEntrypoint'), 'one_database_e2e': (d.get('ci') or {}).get('oneDatabaseE2E')})
else:
    check('ws03:postgres-composition', 'BLOCKED', {'sha': ws03})

if ws13 and exists(ws13, 'workstreams/ws13/PRODUCTION_ACCOUNT_SERVICE.json'):
    d = read_json(ws13, 'workstreams/ws13/PRODUCTION_ACCOUNT_SERVICE.json') or {}
    check('ws13:production-account-service', 'PASS', {'sha': ws13, 'deployment_state': d.get('deployment_state'), 'delivery': d.get('delivery')})
else:
    check('ws13:production-account-service', 'BLOCKED', {'sha': ws13})

# Historical WS10 C5 proof is intentionally retained as evidence only, never as Gate B.
check('ws10:historical-c5-proof', 'PASS', {
    'run_id': 38604174659,
    'url': 'https://github.com/orhansevinc/oldera-preview/actions/runs/38604174659',
    'scope': 'historical real-browser C5 visibility proof only; not a substitute for domain-live acceptance'
})

if any(c['status'] == 'BLOCKED' for c in result['checks'] if c['id'] in ('ws50:exact-release-manifest','ws09:exact-deployment-receipt')):
    result['status'] = 'BLOCKED'
elif any(c['status'] == 'FAIL' for c in result['checks']):
    result['status'] = 'FAIL'
else:
    result['status'] = 'READY_FOR_GATE_A'

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'release_id': RELEASE_ID, 'gate': result['gate'], 'status': result['status'], 'output': str(OUT), 'blockers': result['blockers']}, indent=2))
sys.exit(1 if result['status'] == 'FAIL' else 0)
