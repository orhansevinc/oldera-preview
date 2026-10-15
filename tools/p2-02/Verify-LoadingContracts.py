#!/usr/bin/env python3
from pathlib import Path
import json, sys
ROOT=Path(__file__).resolve().parents[2]
idx=(ROOT/'deploy/domain-live/play-production-index.html').read_text(encoding='utf-8')
loader=(ROOT/'play-loading-v2.js').read_text(encoding='utf-8')
worker=(ROOT/'play-cache-worker.js').read_text(encoding='utf-8')
recovery=(ROOT/'play-cache-recovery.js').read_text(encoding='utf-8')
plan=json.loads((ROOT/'coordination/phase2/P2-02/asset-pack-plan.json').read_text(encoding='utf-8'))
checks={
 'index_uses_loader':'/play-loading-v2.js' in idx,
 'index_uses_recovery':'/play-cache-recovery.js' in idx,
 'manifest_no_store':"cache:'no-store'" in loader,
 'hash_versioned':"searchParams.set('sha256'" in loader and "searchParams.set('cv'" in loader,
 'streaming_wasm':'WebAssembly.instantiateStreaming' in loader,
 'world_ready_gate':"oldkoweb:world-ready" in loader and 'first_controllable_frame_ms' in loader,
 'runtime_init_not_overlay_close':"onRuntimeInitialized" in loader and "ui.loader.hidden=true" not in loader.split('onRuntimeInitialized:',1)[1].split('onAbort:',1)[0],
 'sensitive_cache_bypass':all(x in worker for x in ["'/api/'","'/auth'","'/game'","'/admin'","'/account'"]),
 'range_not_cached':"headers.has('range')" in worker,
 'rollback_keeps_previous':"active,previous" in worker,
 'corrupt_retry_invalidate':'OLDKOWEB_INVALIDATE_VERSION' in worker and 'OLDKOWEB_INVALIDATE_VERSION' in recovery,
 'no_placeholder_policy':plan.get('missing_asset_policy','').startswith('fail build'),
 'no_unrelated_maps':len(plan.get('map_policy',{}).get('startup_must_exclude',[]))>=4,
}
failed=[k for k,v in checks.items() if not v]
for k,v in checks.items(): print(('PASS' if v else 'FAIL'),k)
if failed:
 print('FAILED:',','.join(failed),file=sys.stderr); raise SystemExit(1)
print(f'PASS {len(checks)} loading/cache contracts')
