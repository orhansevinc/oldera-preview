'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { NpcWorld, NpcInteractionRouter, resolveNpcData } = require('../../services/ko1298-npc');

function loadCaspy() {
  const doc = JSON.parse(fs.readFileSync(path.join(__dirname, '../../world-data/npc/moradon.json'), 'utf8'));
  return resolveNpcData(doc, { terrainY: () => 12 })[0];
}

test('Moradon seed refuses to invent terrain height and accepts explicit resolver', () => {
  const doc = JSON.parse(fs.readFileSync(path.join(__dirname, '../../world-data/npc/moradon.json'), 'utf8'));
  assert.equal(doc.templates[0].resourceId, 22000);
  assert.equal(doc.templates[0].npcType, 21);
  assert.equal(doc.instances[0].y, null);
  assert.throws(() => resolveNpcData(doc, { terrainY: () => null }), /unresolved terrain Y/);
  assert.equal(resolveNpcData(doc, { terrainY: () => 12 })[0].y, 12);
});

test('nearby uses verified 48-unit, 3x3 region neighborhood', () => {
  const world = new NpcWorld();
  const caspy = loadCaspy();
  world.add(caspy);
  world.add({ ...caspy, instanceId: 10001, name: 'Near', x: 370, z: 398 });
  world.add({ ...caspy, instanceId: 10002, name: 'Far', x: 450, z: 398 });
  assert.deepEqual(world.nearby(21, 307, 398).map(n => n.instanceId), [10000, 10001]);
});

test('router returns requested NPC records and routes merchant event', () => {
  const world = new NpcWorld();
  world.add(loadCaspy());
  let called = false;
  const router = new NpcInteractionRouter({ world, merchant: ({ npc }) => { called = true; return { kind: 'merchant', sellingGroup: npc.sellingGroup }; } });
  const response = router.route(Buffer.from([0x1d, 0x01, 0x00, 0x10, 0x27]), { zoneId: 21 });
  assert.equal(response.kind, 'packets');
  assert.equal(response.packets[0][0], 0x1d);
  const interaction = router.route(Buffer.from([0x20, 0x10, 0x27]), { zoneId: 21 });
  assert.equal(called, true);
  assert.deepEqual(interaction, { kind: 'merchant', sellingGroup: 203002 });
  const target = router.route(Buffer.from([0x22, 0x10, 0x27, 0x01]), { zoneId: 21 });
  assert.equal(target.kind, 'packets');
  assert.equal(target.packets[0].readUInt32LE(4), 30000);
});

test('router rejects interaction from wrong zone', () => {
  const world = new NpcWorld();
  world.add(loadCaspy());
  const router = new NpcInteractionRouter({ world });
  assert.equal(router.route(Buffer.from([0x20, 0x10, 0x27]), { zoneId: 1 }).reason, 'wrong-zone');
});
