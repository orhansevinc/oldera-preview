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
    'WEBSITE': 'official-site-domain-release',
}
required_owner_handoffs = ['WEBSITE', 'WS13', 'WS07', 'WS03', 'WS08', 'WS09', 'WS10']

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

def exists(commit, file_path):
    return bool(commit) and run('git', 'cat-file', '-e', f'{commit}:{file_path}', check=False).returncode == 0

def grep_files(commit, needle):
    if not commit:
        return []
    p = run('git', 'grep', '-l', '-F', needle, commit, '--', check=False)
    files=[]
    if p.returncode in (0,1):
        for line in p.stdout.splitlines():
            if ':' in line:
                _, file_path = line.split(':', 1)
                files.append(file_path)
    return sorted(set(files))

def read_json(commit, file_path):
    if not commit:
        return None
    p = run('git', 'show', f'{commit}:{file_path}', check=False)
    if p.returncode:
        return None
    try:
        return json.loads(p.stdout)
    except Exception:
        return None

result = {
    'schema_version': 'ws10-domain-live-preflight/v2',
    'release_id': RELEASE_ID,
    'generated_at': datetime.now(timezone.utc).isoformat(),
    'gate': 'A_EXACT_RELEASE_COMPOSITION_PREFLIGHT',
    'resolved_refs': {},
    'ws50_release_manifest': None,
    'owner_handoffs': {},
    'checks': [],
    'blockers': [],
    'status': 'BLOCKED'
}

def check(cid, status, evidence=None):
    result['checks'].append({'id': cid, 'status': status, 'evidence': evidence or {}})

def block(owner, code, detail, **extra):
    item = {'owner': owner, 'code': code, 'detail': detail}
    item.update(extra)
    result['blockers'].append(item)

for owner, branch in branches.items():
    ok, err = fetch_branch(branch)
    s = sha(branch) if ok else None
    result['resolved_refs'][owner] = {'branch': branch, 'sha': s, 'fetch_error': None if ok else err}
    check(f'ref:{owner}', 'PASS' if s else 'BLOCKED', {'branch': branch, 'sha': s, 'error': None if ok else err})

ws50 = result['resolved_refs']['WS50']['sha']
ws09 = result['resolved_refs']['WS09']['sha']
ws03 = result['resolved_refs']['WS03']['sha']
ws13 = result['resolved_refs']['WS13']['sha']

manifest_path = f'integration-rehearsal/domain-live/{RELEASE_ID}.json'
manifest = read_json(ws50, manifest_path)
if manifest and manifest.get('release_id') == RELEASE_ID:
    result['ws50_release_manifest'] = {
        'path': manifest_path,
        'commit': ws50,
        'schema_version': manifest.get('schema_version'),
        'parent_release': manifest.get('parent_release'),
        'website': manifest.get('website'),
        'accepted_owner_pins': manifest.get('accepted_owner_pins'),
        'child_candidate': manifest.get('child_candidate'),
        'verification': manifest.get('verification'),
        'deployment_receipt': manifest.get('deployment_receipt'),
        'domain_acceptance_receipt': manifest.get('domain_acceptance_receipt'),
    }
    check('ws50:exact-release-manifest', 'PASS', {'path': manifest_path, 'ws50_sha': ws50, 'schema_version': manifest.get('schema_version')})
else:
    candidates = grep_files(ws50, RELEASE_ID)
    check('ws50:exact-release-manifest', 'BLOCKED', {'path': manifest_path, 'ws50_sha': ws50, 'release_id_matches': candidates})
    block('WS50', 'EXACT_RELEASE_MANIFEST_MISSING', f'Exact WS50 release manifest {manifest_path} is absent or invalid at {ws50}.')

for owner in required_owner_handoffs:
    branch_key = owner
    commit = result['resolved_refs'][branch_key]['sha']
    handoff_path = f'coordination/handoffs/domain-live/{owner}.json'
    handoff = read_json(commit, handoff_path)
    if handoff and handoff.get('release_id') == RELEASE_ID and handoff.get('source_commit'):
        result['owner_handoffs'][owner] = {
            'path': handoff_path,
            'branch_head': commit,
            'release_id': handoff.get('release_id'),
            'source_commit': handoff.get('source_commit'),
            'status': handoff.get('status') or handoff.get('overall'),
            'run_url': handoff.get('run_url') or handoff.get('workflow_run_url'),
        }
        check(f'owner-handoff:{owner}', 'PASS', result['owner_handoffs'][owner])
    else:
        result['owner_handoffs'][owner] = {'path': handoff_path, 'branch_head': commit, 'present': bool(handoff)}
        check(f'owner-handoff:{owner}', 'BLOCKED', result['owner_handoffs'][owner])
        block(owner, 'DOMAIN_LIVE_HANDOFF_MISSING', f'{handoff_path} with release_id={RELEASE_ID} and source_commit is required on {branches[owner]}@{commit}.')

if manifest:
    accepted = manifest.get('accepted_owner_pins') or {}
    child = manifest.get('child_candidate')
    verification = manifest.get('verification') or {}
    if all(owner in accepted for owner in required_owner_handoffs):
        check('ws50:accepted-owner-pins', 'PASS', {'owners': sorted(accepted)})
    else:
        missing = [owner for owner in required_owner_handoffs if owner not in accepted]
        check('ws50:accepted-owner-pins', 'BLOCKED', {'accepted': sorted(accepted), 'missing': missing})
        block('WS50', 'OWNER_PINS_NOT_ACCEPTED', f'WS50 has not accepted all domain-live owner pins; missing: {missing}.')
    if child:
        check('ws50:child-candidate', 'PASS', {'child_candidate': child})
    else:
        check('ws50:child-candidate', 'BLOCKED', {'child_candidate': child})
        block('WS50', 'EXACT_CHILD_CANDIDATE_NOT_BUILT', 'WS50 release manifest has child_candidate=null; Gate A cannot claim exact integrated-candidate acceptance.')
    if verification.get('INTEGRATION_VERIFIED') is True:
        check('ws50:integration-verification', 'PASS', verification)
    else:
        check('ws50:integration-verification', 'BLOCKED', verification)
        block('WS50', 'INTEGRATION_NOT_VERIFIED', 'WS50 exact release manifest does not mark INTEGRATION_VERIFIED=true.')

ws09_candidates = grep_files(ws09, RELEASE_ID) if ws09 else []
result['ws09_release_files'] = ws09_candidates
receipt_like = [p for p in ws09_candidates if any(x in p.lower() for x in ('deployment','receipt','release','cutover','domain-live'))]
ws09_handoff_ok = result['owner_handoffs'].get('WS09', {}).get('source_commit') is not None
manifest_receipt = (manifest or {}).get('deployment_receipt')
if ws09_handoff_ok and (receipt_like or manifest_receipt):
    check('ws09:exact-deployment-receipt', 'PASS', {'files': receipt_like, 'ws09_sha': ws09, 'ws50_deployment_receipt': manifest_receipt})
else:
    check('ws09:exact-deployment-receipt', 'BLOCKED', {'searched_release_id': RELEASE_ID, 'ws09_sha': ws09, 'matches': ws09_candidates, 'ws50_deployment_receipt': manifest_receipt})
    block('WS09', 'EXACT_DEPLOYMENT_RECEIPT_MISSING', f'No validated deployment receipt for {RELEASE_ID} is available from WS09/WS50.')

if ws03 and exists(ws03, 'workstreams/ws03/PRODUCTION_POSTGRES_COMPOSITION.json'):
    d = read_json(ws03, 'workstreams/ws03/PRODUCTION_POSTGRES_COMPOSITION.json') or {}
    check('ws03:postgres-composition', 'PASS', {'sha': ws03, 'entrypoint': (d.get('runtime') or {}).get('productionEntrypoint'), 'one_database_e2e': (d.get('ci') or {}).get('oneDatabaseE2E'), 'credential_envelope': d.get('credentialEnvelope')})
else:
    check('ws03:postgres-composition', 'BLOCKED', {'sha': ws03})

if ws13 and exists(ws13, 'workstreams/ws13/PRODUCTION_ACCOUNT_SERVICE.json'):
    d = read_json(ws13, 'workstreams/ws13/PRODUCTION_ACCOUNT_SERVICE.json') or {}
    check('ws13:production-account-service', 'PASS', {'sha': ws13, 'deployment_state': d.get('deployment_state'), 'delivery': d.get('delivery')})
else:
    check('ws13:production-account-service', 'BLOCKED', {'sha': ws13})

check('ws10:historical-c5-proof', 'PASS', {
    'run_id': 38604174659,
    'url': 'https://github.com/orhansevinc/oldera-preview/actions/runs/38604174659',
    'scope': 'historical real-browser C5 visibility proof only; not a substitute for Gate A exact child candidate or Gate B domain acceptance'
})

critical_prefixes = ('owner-handoff:', 'ws50:accepted-owner-pins', 'ws50:child-candidate', 'ws50:integration-verification')
critical_ids = {'ws50:exact-release-manifest', 'ws09:exact-deployment-receipt'}
critical_blocked = any(c['status'] == 'BLOCKED' and (c['id'] in critical_ids or c['id'].startswith(critical_prefixes)) for c in result['checks'])
if any(c['status'] == 'FAIL' for c in result['checks']):
    result['status'] = 'FAIL'
elif critical_blocked:
    result['status'] = 'BLOCKED'
else:
    result['status'] = 'READY_FOR_GATE_A_BROWSER_INTEGRATION'

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'release_id': RELEASE_ID, 'gate': result['gate'], 'status': result['status'], 'output': str(OUT), 'blockers': result['blockers']}, indent=2))
sys.exit(1 if result['status'] == 'FAIL' else 0)
