'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { WorldAssetRegistry, resolveSourceSpawn } = require('../../services/ko1298-world/src/world-asset-registry');
const { SharedWorldAoi, AOI_ENTITY_KIND } = require('../../services/ko1298-world/src/shared-world-aoi');

const EXPECTED = new Map([[1,10],[2,20],[11,110],[12,120],[21,210],[201,2010]]);

test('P2-04 scope pins server/client zone namespaces and exact SMD identities', () => {
  const registry = new WorldAssetRegistry({ resolverClass: class {} });
  assert.equal(registry.list().length, 6);
  for (const [serverId, clientId] of EXPECTED) {
    const zone = registry.requirePair(serverId, clientId);
    assert.match(zone.serverSmd.file, /\.smd$/);
    assert.match(zone.serverSmd.gitBlobSha1, /^[0-9a-f]{40}$/);
    assert.ok(zone.serverSmd.byteLength > 1000);
    assert.ok(zone.clientAssetRefs.length >= 10);
  }
  assert.throws(() => registry.requirePair(21, 21), /namespace mismatch/);
  assert.equal(registry.getByServerZoneId(201).serverSmd.file, 'freezone_1217.smd');
  assert.equal(registry.getByServerZoneId(201).alternateServerArtifactsNotSelectedByZoneInfo[0].file, 'freezone_1218.smd');
});

test('generic resolver receives source-pinned hash and length for every configured map', () => {
  class ResolverSpy { constructor(options) { this.options = options; } }
  const registry = WorldAssetRegistry.fromAssetRoot('/maps', { resolverClass: ResolverSpy });
  const resolver = registry.createHeightResolver();
  for (const [serverId] of EXPECTED) {
    const zone = registry.getByServerZoneId(serverId);
    const asset = resolver.options.zoneAssets[serverId];
    assert.equal(asset.expectedGitBlobSha1, zone.serverSmd.gitBlobSha1);
    assert.equal(asset.expectedByteLength, zone.serverSmd.byteLength);
    assert.ok(asset.path.endsWith(zone.serverSmd.file));
  }
});

test('safe spawn is fail-closed and uses authoritative terrain/collision height', () => {
  const registry = new WorldAssetRegistry({ resolverClass: class {} });
  const heightResolver = { resolveHeight(zoneId, x, z) { return { status:'authoritative', height:42.25, surface:'shape', zoneId, x, z }; } };
  const moradon = resolveSourceSpawn({ assetRegistry:registry, heightResolver, zoneId:21 });
  assert.equal(moradon.ok, true);
  assert.deepEqual(moradon.position, { x:312, z:402, y:42.25 });
  const emc = resolveSourceSpawn({ assetRegistry:registry, heightResolver, zoneId:2 });
  assert.equal(emc.ok, false);
  assert.equal(emc.reason, 'NO_SAFE_SOURCE_CANDIDATE');
  const missing = resolveSourceSpawn({ assetRegistry:registry, heightResolver:{resolveHeight(){return {status:'unresolved'};}}, zoneId:201 });
  assert.equal(missing.reason, 'HEIGHT_OR_COLLISION_UNRESOLVED');
});

test('AOI is one shared zone world for players, NPCs and mobs and cleans transitions', () => {
  const aoi = new SharedWorldAoi();
  aoi.upsert({ kind:'player', runtimeId:100, zoneId:21, x:300, z:400 });
  aoi.upsert({ kind:'player', runtimeId:101, zoneId:21, x:305, z:405 });
  aoi.upsert({ kind:'npc', runtimeId:10000, zoneId:21, x:304, z:401 });
  aoi.upsert({ kind:'mob', runtimeId:10001, zoneId:21, x:309, z:402 });
  aoi.upsert({ kind:'player', runtimeId:102, zoneId:201, x:305, z:405 });
  const visible = aoi.visibleFrom({ zoneId:21, x:300, z:400, radius:15, exclude:{kind:'player',runtimeId:100} });
  assert.deepEqual(visible.map((x)=>x.runtimeId), [101,10000,10001]);
  assert.equal(aoi.leaveZone(21, (e)=>e.kind==='player' && e.runtimeId===100), 1);
  assert.equal(aoi.snapshot(21).some((e)=>e.runtimeId===100), false);
  aoi.upsert({ kind:'player', runtimeId:100, zoneId:201, x:10, z:10 });
  assert.equal(aoi.snapshot(201).filter((e)=>e.kind==='player').length, 2);
});

test('NPC and mob runtime identities share one signed-i16 namespace', () => {
  const aoi = new SharedWorldAoi();
  aoi.upsert({ kind:AOI_ENTITY_KIND.NPC, runtimeId:20000, zoneId:21, x:1, z:1 });
  assert.throws(() => aoi.upsert({ kind:AOI_ENTITY_KIND.MOB, runtimeId:20000, zoneId:21, x:2, z:2 }), /runtime ID collision/);
  assert.throws(() => aoi.upsert({ kind:AOI_ENTITY_KIND.MOB, runtimeId:40000, zoneId:21, x:2, z:2 }), /signed i16/);
});
