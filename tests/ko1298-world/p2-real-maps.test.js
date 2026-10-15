'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { WorldAssetRegistry, resolveSourceSpawn } = require('../../services/ko1298-world/src/world-asset-registry');

const mapRoot = process.env.P2_WORLD_MAP_ROOT;
const TARGET_ZONES = [1,2,11,12,21,201];

test('all P2-04 target SMDs parse with exact source identity and resolve source spawn collision where source is representable', { skip: !mapRoot }, () => {
  const registry = WorldAssetRegistry.fromAssetRoot(path.resolve(mapRoot));
  const resolver = registry.createHeightResolver();
  for (const zoneId of TARGET_ZONES) {
    const zone = registry.getByServerZoneId(zoneId);
    const map = resolver.preload(zoneId);
    assert.equal(map.gitBlobSha1, zone.serverSmd.gitBlobSha1, `zone ${zoneId} SMD blob`);
    assert.equal(map.byteLength, zone.serverSmd.byteLength, `zone ${zoneId} SMD bytes`);
    assert.ok(map.mapWidth > 0 && map.mapLength > 0, `zone ${zoneId} terrain dimensions`);
    assert.ok(map.collisionFaceCount >= 0, `zone ${zoneId} collision section`);
    if (zone.sourceSpawn.status === 'SOURCE_CANDIDATE_REQUIRES_COLLISION_VALIDATION') {
      const spawn = resolveSourceSpawn({ assetRegistry:registry, heightResolver:resolver, zoneId });
      assert.equal(spawn.ok, true, `zone ${zoneId} source spawn must resolve against real SMD: ${JSON.stringify(spawn)}`);
      assert.ok(Number.isFinite(spawn.position.y));
    }
  }
});
