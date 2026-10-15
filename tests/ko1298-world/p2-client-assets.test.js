'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const assets = require('../../services/ko1298-world/data/client-zone-assets.1298.json');

test('target zones have source-pinned terrain, texture/object and minimap bindings', () => {
  assert.equal(assets.fieldSemantics.minimap, 'szMiniMapFN / DXT');
  for (const zoneId of ['1','2','11','12','21','201']) {
    const zone = assets.zones[zoneId];
    assert.ok(zone.terrain.endsWith('.gtd'));
    assert.ok(zone.colorMap.endsWith('.tct'));
    assert.ok(zone.lightMap.endsWith('.tlt'));
    assert.ok(zone.objectPlacement.endsWith('.opd'));
    assert.ok(zone.minimap.endsWith('.dxt'));
    assert.ok(zone.clientZoneTableId > Number(zoneId));
  }
  assert.equal(assets.zones['201'].objectPlacementExtension, 'Zones/Freezone_b.opdext');
  assert.equal(assets.modelInventory.status, 'P2-02_REQUIRED');
});
