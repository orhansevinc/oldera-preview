'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.resolve(__dirname,'..');
const PILOT=path.join(ROOT,'contracts','pilot-moradon-visibility');
const {
  fingerprintCapability,validateRegistry,validateSourceManifest,validateReceipt,
  validateBlocker,validateProviderSets,validateBlockerRouting,providerSetIdentity,
  discoverDependencies,impactAnalysis,ownerInbox
}=require(path.join(PILOT,'tooling.cjs'));
const read=(name)=>JSON.parse(fs.readFileSync(path.join(PILOT,name),'utf8'));
const registry=read('registry.json'),manifests=read('source-manifests.json'),
  blockers=read('blockers.json'),providerSets=read('provider-sets.json');

const mapBy=(arr,key)=>new Map(arr.map(item=>[item[key],item]));

test('pilot registry fingerprints and authority roles remain valid',()=>{
  assert.deepEqual(validateRegistry(registry),[]);
  assert.equal(registry.milestone.id,'moradon-npc-mob-visibility');
  assert.deepEqual(registry.workstreams.map(ws=>ws.ws),['WS03','WS14','WS15','WS16','WS25','WS11','WS31']);
  for(const capability of registry.capabilities){
    assert.equal(capability.contract_hash,fingerprintCapability(capability));
    assert.match(capability.semantic_version,/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i);
  }
  assert.equal(registry.authorities.find(a=>a.ws==='WS11').kind,'protocol');
  assert.equal(registry.authorities.find(a=>a.ws==='WS31').kind,'data');
  const terrain=registry.capabilities.find(c=>c.id==='terrain.height-authority');
  assert.equal(terrain.provider_ws,'WS14');
  assert.equal(terrain.contract.state,'PROVIDER_CANDIDATE_READY_NOT_IN_WS50_C3');
  assert.ok(registry.workstreams.find(ws=>ws.ws==='WS14').provides.includes('terrain.height-authority'));
});

test('source manifests never maintain source HEADs or duplicate central blocker bodies',()=>{
  for(const manifest of manifests.manifests){
    assert.deepEqual(validateSourceManifest(manifest),[]);
    for(const forbidden of ['source_head','source_sha','commit_sha','exact_commit_sha']){
      assert.equal(Object.prototype.hasOwnProperty.call(manifest,forbidden),false,`${manifest.ws} contains ${forbidden}`);
    }
    assert.deepEqual(manifest.known_blockers,[],`${manifest.ws} must discover blockers centrally`);
  }
  const receipt={exact_commit_sha:'1'.repeat(40),provider_set_id:'WS50-C3',resolved_dependencies:[],contract_fingerprints:[],test_run_ids:[],artifacts:[],blockers:[]};
  assert.deepEqual(validateReceipt(receipt),[]);
});

test('ACCEPTED is exact WS50-B0 and CANDIDATE is exact immutable WS50-C3',()=>{
  assert.deepEqual(validateProviderSets(providerSets),[]);
  const accepted=providerSetIdentity(providerSets,'accepted');
  const candidate=providerSetIdentity(providerSets,'candidate');
  assert.equal(accepted.provider_set_id,'WS50-B0');
  assert.equal(accepted.immutable_key,'WS50-B0@sha256:57bf3e37dd4406380e35d042d3336b9bd2f9a6295ea91be7e8b835e7c94e8fda');
  assert.equal(accepted.candidate_result,'ACCEPTED');
  assert.equal(candidate.provider_set_id,'WS50-C3');
  assert.equal(candidate.immutable_key,'WS50-C3@sha256:a9c808898bd1cb9f3cadfb44ddbabadaf34448f9aef0a4990ca91958053458aa');
  assert.equal(candidate.candidate_result,'BLOCKED');
  assert.deepEqual(candidate.blockers,[
    'MOB_BROWSER_BOOTSTRAP_ENCODER_AUTHORITY',
    'NPC_REGION_BODY_AUTHORITY',
    'WORLD_TERRAIN_HEIGHT_AUTHORITY'
  ]);
});

test('C3 blockers are centrally routed once and terrain remains blocked in C3 while resolved by a newer WS14 candidate',()=>{
  assert.equal(blockers.requests.length,3);
  for(const blocker of blockers.requests) assert.deepEqual(validateBlocker(blocker),[]);
  assert.deepEqual(validateBlockerRouting(providerSets,blockers),[]);
  const byId=mapBy(blockers.requests,'request_id');
  const terrain=byId.get('WORLD_TERRAIN_HEIGHT_AUTHORITY');
  assert.equal(terrain.state,'OPEN');
  assert.equal(terrain.set_state,'BLOCKED_IN_IMMUTABLE_SET');
  assert.equal(terrain.resolution.status,'RESOLVED_BY_PROVIDER_CANDIDATE');
  assert.equal(terrain.resolution.provider_ws,'WS14');
  assert.equal(terrain.resolution.exact_sha,'810a58f1bd71037597b896eac32d0139a463d227');
  assert.equal(terrain.resolution.branch_head_evidence_sha,'9b82adefb05a3cca32f430e25f8a1d9109db93b2');
  assert.equal(terrain.resolution.set_inclusion,'NOT_IN_WS50_C3');
  assert.equal(byId.get('NPC_REGION_BODY_AUTHORITY').owner,'WS11');
  assert.equal(byId.get('NPC_REGION_BODY_AUTHORITY').routing_status,'ROUTED_TO_OWNER');
  assert.equal(byId.get('MOB_BROWSER_BOOTSTRAP_ENCODER_AUTHORITY').owner,'WS11');
  assert.equal(byId.get('MOB_BROWSER_BOOTSTRAP_ENCODER_AUTHORITY').routing_status,'ROUTED_TO_OWNER');
});

test('owner inboxes are generated views from the central blocker source only',()=>{
  const ws14=ownerInbox(blockers,'WS14');
  const ws11=ownerInbox(blockers,'WS11');
  assert.equal(ws14.generated_from,'contracts/pilot-moradon-visibility/blockers.json');
  assert.deepEqual(ws14.requests.map(r=>r.request_id),['WORLD_TERRAIN_HEIGHT_AUTHORITY']);
  assert.deepEqual(ws11.requests.map(r=>r.request_id),[
    'NPC_REGION_BODY_AUTHORITY','MOB_BROWSER_BOOTSTRAP_ENCODER_AUTHORITY'
  ]);
  assert.equal(fs.existsSync(path.join(PILOT,'inbox.json')),false);
});

test('WS16 discovers B0/C3, exact provider SHAs, contract identity, WS11/WS31 authority and blockers without STATUS scanning',()=>{
  const result=discoverDependencies(registry,providerSets,blockers,'WS16');
  assert.equal(result.accepted_provider_set.provider_set_id,'WS50-B0');
  assert.equal(result.candidate_provider_set.provider_set_id,'WS50-C3');
  const direct=mapBy(result.direct_contracts,'capability');
  assert.equal(direct.get('session.world-ready').accepted.exact_sha,'237c4a613e94434baae656c1399cb449e7b78067');
  assert.equal(direct.get('session.world-ready').candidate.exact_sha,'495de481726734d85cc28b3d432835799aff7e48');
  assert.equal(direct.get('world.position').candidate.exact_sha,'ce9bed13b8d45c32ff0592595aa3a0d1e7b3964d');
  assert.equal(direct.get('movement.region-membership').candidate.exact_sha,'ce9bed13b8d45c32ff0592595aa3a0d1e7b3964d');
  assert.equal(direct.get('terrain.height-authority').provider_ws,'WS14');
  assert.equal(direct.get('terrain.height-authority').candidate.exact_sha,'c1a1d454285db02c6de0c087a2d65434bfb4593b');
  assert.equal(direct.get('terrain.height-authority').provider_candidate_resolution.exact_sha,'810a58f1bd71037597b896eac32d0139a463d227');
  assert.match(direct.get('terrain.height-authority').contract_identity.contract_hash,/^sha256:/);
  const auth=result.authority_dependencies;
  assert.ok(auth.some(a=>a.authority_ws==='WS11'&&a.candidate.exact_sha==='9ad710e54eda464217ff6cef74ae4a9cf196d68f'));
  assert.ok(auth.some(a=>a.authority_ws==='WS31'&&a.candidate.exact_sha==='546d2ab62cd46a97f3385ebcddbe0c775a02c2eb'));
  assert.deepEqual(result.blockers.map(r=>r.request_id).sort(),[
    'NPC_REGION_BODY_AUTHORITY','WORLD_TERRAIN_HEIGHT_AUTHORITY'
  ]);
});

test('WS25 discovers B0/C3, exact providers, both authorities and its visibility blockers without user mediation',()=>{
  const result=discoverDependencies(registry,providerSets,blockers,'WS25');
  assert.equal(result.accepted_provider_set.provider_set_id,'WS50-B0');
  assert.equal(result.candidate_provider_set.provider_set_id,'WS50-C3');
  const direct=mapBy(result.direct_contracts,'capability');
  assert.equal(direct.get('world.position').candidate.exact_sha,'ce9bed13b8d45c32ff0592595aa3a0d1e7b3964d');
  assert.equal(direct.get('terrain.height-authority').provider_ws,'WS14');
  assert.equal(direct.get('terrain.height-authority').provider_candidate_resolution.status,'RESOLVED_BY_PROVIDER_CANDIDATE');
  assert.ok(result.authority_dependencies.some(a=>a.authority_ws==='WS11'&&a.candidate.exact_sha==='9ad710e54eda464217ff6cef74ae4a9cf196d68f'));
  assert.ok(result.authority_dependencies.some(a=>a.authority_ws==='WS31'&&a.candidate.exact_sha==='546d2ab62cd46a97f3385ebcddbe0c775a02c2eb'));
  assert.deepEqual(result.blockers.map(r=>r.request_id).sort(),[
    'MOB_BROWSER_BOOTSTRAP_ENCODER_AUTHORITY','WORLD_TERRAIN_HEIGHT_AUTHORITY'
  ]);
});

test('WS14 terrain height authority impact points to affected providers/scenarios and requires a new WS50 candidate',()=>{
  const impact=impactAnalysis(registry,providerSets,blockers,'terrain.height-authority');
  assert.equal(impact.owner,'WS14');
  assert.equal(impact.accepted_provider.exact_sha,'82cdcef40bed265ff4c4ce0fb7c8f6ad8cf2f52b');
  assert.equal(impact.candidate_provider.exact_sha,'c1a1d454285db02c6de0c087a2d65434bfb4593b');
  assert.equal(impact.replacement_provider_candidate.exact_sha,'810a58f1bd71037597b896eac32d0139a463d227');
  assert.deepEqual(impact.direct_consumers,['WS15','WS16','WS25']);
  assert.deepEqual(impact.impacted_scenarios,['moradon.mob-visibility','moradon.npc-visibility']);
  assert.equal(impact.requires_new_ws50_candidate,true);
});

test('contract semantic version, content hash, implementation SHA and provider-set ID remain separate identities',()=>{
  const original=registry.capabilities.find(c=>c.id==='npc.nearby');
  const changed=JSON.parse(JSON.stringify(original));
  changed.contract.behavior=`${changed.contract.behavior} changed`;
  assert.notEqual(fingerprintCapability(changed),original.contract_hash);
  assert.equal(changed.semantic_version,original.semantic_version);
  assert.notEqual('810a58f1bd71037597b896eac32d0139a463d227',original.contract_hash);
  assert.notEqual('WS50-C3',original.semantic_version);
});

test('visibility pilot keeps shared types minimal',()=>{
  const names=new Set(registry.shared_types.map(type=>type.id));
  assert.deepEqual([...names].sort(),['CharacterId','CorrelationId','EntityId','Position','ZoneId'].sort());
  for(const forbidden of ['ItemSerial','CombatModel','MobAiState','SessionFsm','Actor']) assert.equal(names.has(forbidden),false);
});
