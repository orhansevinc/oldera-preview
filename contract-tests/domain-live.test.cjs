'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.resolve(__dirname,'..');
const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/domain-live/scenarios.json'),'utf8'));
const gate=require(path.join(ROOT,'tools/ws39_contracts/domain_live.cjs'));
const clone=x=>JSON.parse(JSON.stringify(x));
function handoffs(base=fixture.base_handoffs){ return Object.fromEntries(Object.entries(base).map(([o,h])=>[`${o}.json`,clone(h)])); }
function variant(name){
  const set=clone(fixture.base_handoffs), v=fixture.variants[name];
  set[v.owner]={...set[v.owner],...clone(v.patch)};
  return handoffs(set);
}
function entry(result,id){ return result.compatibility_matrix.find(x=>x.id===id); }

test('domain-live schema adapter supports mixed handoff schema versions without losing authority',()=>{
  const result=gate.validateRelease({releaseId:fixture.release_id,handoffs:handoffs(),sourceValidation:false});
  assert.equal(result.handoff_schema.errors.length,0);
  assert.equal(result.exact_source_pins.WS03.branch,'ws03-ko1298-session');
  assert.ok(result.handoff_schema.warnings.some(x=>x.owner==='WS03'&&x.warning.includes('branch inferred')));
  assert.equal(result.exact_source_pins.WEBSITE.source_commit,'1'.repeat(40));
  assert.equal(result.tooling_state,'READY_TO_FREEZE_AFTER_OWNER_COMPLETION');
  assert.equal(result.final_set_frozen,false);
});

test('compatible fixture checks website/account credentials, shared identity, admin surface, migrations and deployment receipt',()=>{
  const result=gate.validateRelease({releaseId:fixture.release_id,handoffs:handoffs(),sourceValidation:false});
  for(const id of ['WEBSITE_WS13_ACCOUNT_ROUTES','WEBSITE_WS13_CREDENTIAL_POLICY','WS13_WS03_CREDENTIAL_ENVELOPE','WS13_WS07_ACCOUNT_SCHEMA','WS03_WS07_ACCOUNT_CHARACTER_IDENTITY','WS07_MIGRATION_ORDER','WS08_WS07_ADMIN_REPOSITORY_SURFACE','WS08_WS07_COMMAND_STATUS_OUTBOX','WS08_RUNTIME_AUTHORITY_REQUIREMENT','WS09_REQUIRED_SERVICE_ENV_MIGRATION_INPUTS','WS10_ACCEPTED_PROVIDER_DEPLOYMENT_RECEIPT']){
    assert.equal(entry(result,id).state,'COMPATIBLE',id);
  }
  assert.equal(entry(result,'PLAY_LAUNCHER_RELEASE_POINTER').state,'NOT_APPLICABLE');
  assert.equal(result.valid,true);
});

test('stale dependency blocker is preserved as SUPERSEDED_BY_PROVIDER_EVIDENCE and requires consumer reconciliation',()=>{
  const result=gate.validateRelease({releaseId:fixture.release_id,handoffs:variant('stale_admin_blocker'),sourceValidation:false});
  const stale=result.stale_superseded_blockers.find(x=>x.code==='WS07_ADMIN_ADAPTER_MISSING');
  assert.ok(stale);
  assert.equal(stale.state,'SUPERSEDED_BY_PROVIDER_EVIDENCE');
  assert.equal(stale.provider,'WS07');
  assert.equal(stale.reconciliation,'RECONCILIATION_REQUIRED');
  assert.equal(result.open_blockers.some(x=>x.code==='WS07_ADMIN_ADAPTER_MISSING'),false);
  assert.equal(result.valid,false);
});

test('old 10-128 website credential consumer is STALE_CONSUMER against exact WS13 authority and 12-byte game wire',()=>{
  const result=gate.validateRelease({releaseId:fixture.release_id,handoffs:variant('credential_conflict'),sourceValidation:false});
  const web13=entry(result,'WEBSITE_WS13_CREDENTIAL_POLICY');
  assert.equal(web13.state,'STALE_CONSUMER');
  assert.equal(entry(result,'WS13_WS03_CREDENTIAL_ENVELOPE').state,'COMPATIBLE');
  assert.match(web13.detail,/10-128/);
  assert.equal(result.valid,false);
});

test('service-owned migration number may overlap only outside WS07 ledger; ledger collision fails',()=>{
  const good=gate.validateRelease({releaseId:fixture.release_id,handoffs:handoffs(),sourceValidation:false});
  assert.equal(entry(good,'WS07_MIGRATION_ORDER').state,'COMPATIBLE');
  const bad=gate.validateRelease({releaseId:fixture.release_id,handoffs:variant('migration_collision'),sourceValidation:false});
  assert.equal(entry(bad,'WS07_MIGRATION_ORDER').state,'INCOMPATIBLE');
  assert.match(entry(bad,'WS07_MIGRATION_ORDER').detail,/ledger_collision=true/);
});

test('pin digest is deterministic over owner + exact source commit + contract digest and ignores input file order',()=>{
  const a=handoffs();
  const b=Object.fromEntries(Object.entries(a).reverse());
  const ra=gate.validateRelease({releaseId:fixture.release_id,handoffs:a,sourceValidation:false});
  const rb=gate.validateRelease({releaseId:fixture.release_id,handoffs:b,sourceValidation:false});
  assert.equal(ra.pin_digest,rb.pin_digest);
  assert.match(ra.pin_digest,/^sha256:[0-9a-f]{64}$/);
  const changed=handoffs();
  changed['WS13.json'].api_contract_summary.routes.push('POST /v1/example');
  const rc=gate.validateRelease({releaseId:fixture.release_id,handoffs:changed,sourceValidation:false});
  assert.notEqual(ra.pin_digest,rc.pin_digest);
});

test('source validation checks exact commit reachability and branch ancestry without pinning observed moving head',()=>{
  const h=gate.normalizeHandoff(fixture.base_handoffs.WS13,'WS13.json',fixture.release_id);
  const calls=[]; const observed='a'.repeat(40);
  const runner=(args)=>{ calls.push(args.join(' ')); if(args[0]==='rev-parse') return observed; return ''; };
  const result=gate.validateSourceCommit(h,{repoRoot:'/tmp/fake',fetch:true,gitRunner:runner});
  assert.equal(result.reachable,true); assert.equal(result.in_branch_history,true); assert.equal(result.observed_branch_head,observed);
  assert.ok(calls.some(x=>x.includes(`merge-base --is-ancestor ${h.source_commit}`)));
  const pins=gate.pinDigest([h]);
  assert.equal(pins.includes(observed),false);
});

test('blocker classifier emits requested machine-readable classes',()=>{
  assert.equal(gate.classifyBlocker('PUBLIC_TLS_UNAVAILABLE'),'DNS_TLS');
  assert.equal(gate.classifyBlocker('mail webhook secret missing'),'EXTERNAL_SECRET');
  assert.equal(gate.classifyBlocker('real browser acceptance required'),'REAL_BROWSER_ACCEPTANCE');
  assert.equal(gate.classifyBlocker('production deploy required'),'LIVE_DEPLOYMENT');
  assert.equal(gate.classifyBlocker('repository adapter contract mismatch'),'CONTRACT_RECONCILIATION');
  assert.equal(gate.classifyBlocker('implement damage mutation'),'PRODUCT_IMPLEMENTATION');
});
