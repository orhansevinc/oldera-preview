'use strict';

const assert = require('node:assert/strict');
const { proveVisibilityV2 } = require('./verify-visibility-v2.cjs');
const { computeContentHash, lockProviderSet } = require('./lock-provider-set.cjs');

const providerSet = 'WS50-NEXT@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const server = [
  `WS10_AUTH provider_set=${providerSet} npc_total=1 mob_total=1 collision=0`,
  'WS10_AUTH type=npc id=11001 template=1 name="NPC"',
  'WS10_AUTH type=mob id=21001 template=700 name="Worm"',
].join('\n');
const chain = (id) => [
  `WS10_VISIBILITY DETAIL_RECORD id=${id} resource=700 name=x x=1 y=2 z=3`,
  `WS10_VISIBILITY ENTITY_CREATE id=${id} resource=700 name=x`,
  `WS10_VISIBILITY MODEL_READY id=${id} resource=700 source=authority`,
  `WS10_VISIBILITY_V2 BOUNDS id=${id} transform=valid front=1 frustum=1 screen=1 x=10 y=20 w=30 h=40 area=1200 depth=7.5 bounds_source=native-minmax`,
  `WS10_VISIBILITY_V2 DRAW_SUBMIT id=${id} x=10 y=20 w=30 h=40 area=1200`,
  `WS10_VISIBILITY_V2 PIXEL_DELTA id=${id} changed=33 total=1200 ratio=0.027500`,
  `WS10_VISIBILITY_V2 HUMAN_VISIBLE id=${id} changed=33 area=1200`,
].join('\n');
const goodDriver = [
  chain(11001), chain(21001),
  'WS10_BROWSER_MOVEMENT_INPUT complete=1',
  'WS10_VISIBILITY_V2_CAPTURE_OK source=pre-swap-gl id=3030 npc=11001 mob=21001 artifact=moradon-visibility-v2-native.png ratio=0.4200',
].join('\n');
const proof = proveVisibilityV2({ serverLog: server, driverLog: goodDriver, expectedProviderSet: providerSet });
assert.deepEqual(proof.npc.provenIds, [11001]);
assert.deepEqual(proof.mob.provenIds, [21001]);

// Product regression: packet/entity/model/Render + generic non-black frame used to pass,
// even though no NPC/mob produced human-visible pixels. V2 must fail it.
const falsePositiveDriver = [
  'WS10_VISIBILITY DETAIL_RECORD id=11001 resource=1 name=x x=1 y=2 z=3',
  'WS10_VISIBILITY ENTITY_CREATE id=11001 resource=1 name=x',
  'WS10_VISIBILITY MODEL_READY id=11001 resource=1 source=authority',
  'WS10_VISIBILITY RENDERED id=11001 lod=1',
  'WS10_VISIBILITY DETAIL_RECORD id=21001 resource=700 name=x x=1 y=2 z=3',
  'WS10_VISIBILITY ENTITY_CREATE id=21001 resource=700 name=x',
  'WS10_VISIBILITY MODEL_READY id=21001 resource=700 source=authority',
  'WS10_VISIBILITY RENDERED id=21001 lod=1',
  'WS10_BROWSER_MOVEMENT_INPUT complete=1',
  'WS10_VISIBILITY_CAPTURE_OK source=pre-swap-gl id=2020 ratio=0.4200',
].join('\n');
assert.throws(
  () => proveVisibilityV2({ serverLog: server, driverLog: falsePositiveDriver, expectedProviderSet: providerSet }),
  /human-visible pixel chain|generic non-black/,
  'packets parsed but invisible NPC/mob must FAIL V2',
);

for (const badLine of [
  'transform=invalid front=1 frustum=1 screen=1',
  'transform=valid front=0 frustum=1 screen=1',
  'transform=valid front=1 frustum=0 screen=1',
  'transform=valid front=1 frustum=1 screen=0',
]) {
  const bad = goodDriver.replace('transform=valid front=1 frustum=1 screen=1', badLine);
  assert.throws(() => proveVisibilityV2({ serverLog: server, driverLog: bad, expectedProviderSet: providerSet }));
}
assert.throws(() => proveVisibilityV2({ serverLog: server, driverLog: goodDriver.replace('changed=33', 'changed=1'), expectedProviderSet: providerSet }), /human-visible pixel chain/);
assert.throws(() => proveVisibilityV2({ serverLog: server, driverLog: goodDriver.replace('npc=11001', 'npc=21001'), expectedProviderSet: providerSet }), /screenshot NPC/);

const manifest = {
  schema_version: 'ws50-provider-set/v1',
  set_id: 'WS50-NEXT',
  candidate_result: 'PREPARED',
  providers: [{ ws: 'WS11', branch: 'ws11-protocol-lab', exact_sha: '1'.repeat(40) }, { ws: 'WS25', branch: 'ws25-mob-ai', exact_sha: '2'.repeat(40) }],
};
manifest.content_hash = computeContentHash(manifest);
manifest.immutable_key = `WS50-NEXT@${manifest.content_hash}`;
const locked = lockProviderSet(manifest, manifest.immutable_key);
assert.equal(locked.providers.WS11, '1'.repeat(40));
assert.throws(() => lockProviderSet({ ...manifest, providers: [{ ws: 'WS11', branch: 'x', exact_sha: '3'.repeat(40) }] }, manifest.immutable_key), /content hash mismatch/);
assert.throws(() => lockProviderSet(manifest, 'WS50-WRONG@sha256:' + 'b'.repeat(64)), /immutable provider-set mismatch/);

console.log('WS10_VISIBILITY_V2_SELFTEST PASS regression=invisible-after-render-generic-frame-fails native-bounds=required provider-lock=fail-closed');
