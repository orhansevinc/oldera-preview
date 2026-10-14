'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  NpcWorld, NpcInteractionRouter, resolveNpcData, validateNpcCatalog, catalogStats,
  createTerrainHeightResolver, encodeNpcIn, NPC_BAND,
} = require('../../services/ko1298-npc');

const seedPath = path.join(__dirname, '../../world-data/npc/moradon.json');
function loadDoc() { return JSON.parse(fs.readFileSync(seedPath, 'utf8')); }
function loadMoradon(y = 12) { return resolveNpcData(loadDoc(), { terrainY: () => y }); }
function loadCaspy() { return loadMoradon().find(n => n.templateSid === 13001); }
function packetEvent(id) { const b = Buffer.alloc(3); b[0] = 0x20; b.writeUInt16LE(id, 1); return b; }
function packetTarget(id) { const b = Buffer.alloc(4); b[0] = 0x22; b.writeUInt16LE(id, 1); b[3] = 1; return b; }

function sample(overrides = {}) {
  return {
    instanceId: 10000, templateSid: 13001, resourceId: 22000, npcType: 21, sellingGroup: 203002,
    size: 100, weapon1: 0, weapon2: 0, name: 'Caspy[Accessory]', group: 2,
    level: 50, maxHp: 30000, hp: 30000, x: 307, y: 12, z: 398, gateOpen: 1, objectType: 0, zoneId: 21,
    role: 'merchant', interactionRoute: 'merchant', interactionVerified: true,
    enabled: true, dead: false, ...overrides,
  };
}

test('Moradon catalog is source-backed, duplicate-free and materially broader than Caspy', () => {
  const doc = loadDoc();
  assert.equal(validateNpcCatalog(doc), true);
  const stats = catalogStats(doc);
  assert.deepEqual(stats, {
    templates: 31,
    spawnGroups: 39,
    anchoredSpawnGroups: 37,
    declaredPopulation: 43,
    byRole: { static: 5, inn: 1, merchant: 9, quest: 13, gate: 1, other: 2 },
  });
  assert.equal(new Set(doc.templates.map(t => t.templateSid)).size, 31);
  assert.equal(new Set(doc.spawns.map(s => s.spawnKey)).size, 39);
  assert.ok(doc.provenance.templateSource.ref.includes('Open-KO/OpenKO-db@bec6194'));
  assert.ok(doc.provenance.positionSource.ref.includes('Open-KO/OpenKO-db@bec6194'));
  assert.ok(doc.templates.every(t => typeof t.sourceRow === 'string' && t.sourceRow.startsWith('sSid=')));
  assert.ok(doc.spawns.every(s => typeof s.sourceRow === 'string' && s.sourceRow.startsWith('ZoneID=21;')));
});

test('catalog refuses duplicate template and spawn records', () => {
  const doc = loadDoc();
  const dupTemplate = structuredClone(doc);
  dupTemplate.templates.push(structuredClone(doc.templates[0]));
  assert.throws(() => validateNpcCatalog(dupTemplate), /duplicate NPC templateSid/);
  const dupSpawn = structuredClone(doc);
  dupSpawn.spawns.push(structuredClone(doc.spawns[0]));
  assert.throws(() => validateNpcCatalog(dupSpawn), /duplicate NPC spawn/);
});

test('Moradon materialization refuses invented terrain height and skips non-anchored rows', () => {
  const doc = loadDoc();
  assert.throws(() => resolveNpcData(doc, { terrainY: () => null }), /unresolved terrain Y/);
  const npcs = resolveNpcData(doc, { terrainY: () => 12 });
  assert.equal(npcs.length, 37);
  assert.equal(npcs[0].instanceId, NPC_BAND);
  assert.equal(npcs.every(n => n.y === 12), true);
  assert.equal(npcs.some(n => n.templateSid === 16082), false);
  assert.equal(npcs.some(n => n.templateSid === 16083), false);
});

test('terrain resolver mirrors client policy by preferring the higher terrain/shape height', () => {
  const resolver = createTerrainHeightResolver({ terrainHeight: () => 8.5, shapeHeight: () => 11.25 });
  assert.equal(resolver({ zoneId: 21, x: 307, z: 398 }), 11.25);
  const terrainOnly = createTerrainHeightResolver({ terrainHeight: () => 7, shapeHeight: () => null });
  assert.equal(terrainOnly({ zoneId: 21, x: 1, z: 1 }), 7);
});

test('nearby uses verified 48-unit, 3x3 region neighborhood', () => {
  const world = new NpcWorld();
  const caspy = loadCaspy();
  world.add(caspy);
  world.add({ ...caspy, instanceId: 10100, name: 'Near', x: 370, z: 398 });
  world.add({ ...caspy, instanceId: 10101, name: 'Far', x: 450, z: 398 });
  assert.deepEqual(world.nearby(21, 307, 398).map(n => n.instanceId), [caspy.instanceId, 10100].sort((a, b) => a - b));
});

test('spawn/despawn lifecycle publishes deterministic events', () => {
  const world = new NpcWorld();
  const events = [];
  world.subscribe(e => events.push(e.type));
  world.spawn(sample());
  world.despawn(10000);
  assert.deepEqual(events, ['spawn', 'despawn']);
  assert.equal(world.get(10000), null);
});

test('region enter/leave delta is deterministic', () => {
  const world = new NpcWorld();
  world.add(sample());
  world.add(sample({ instanceId: 10001, x: 370 }));
  const first = world.regionDelta(21, 307, 398, []);
  assert.deepEqual(first.ids, [10000, 10001]);
  const second = world.regionDelta(21, 500, 500, first.ids);
  assert.deepEqual(second.ids, []);
  assert.deepEqual(second.leave, [10000, 10001]);
});

test('runtime ID collision is rejected and allocator skips occupied IDs', () => {
  const world = new NpcWorld();
  world.add(sample());
  assert.throws(() => world.add(sample()), /duplicate NPC instanceId/);
  assert.equal(world.allocateInstanceId(), 10001);
});

test('spawn reload is idempotent and reports updates/removals without duplication', () => {
  const world = new NpcWorld();
  const a = sample();
  const b = sample({ instanceId: 10001, name: 'Rospel[Armor]' });
  const first = world.reloadZone(21, [a, b]);
  assert.equal(first.spawned.length, 2);
  const second = world.reloadZone(21, [a, b]);
  assert.equal(second.unchanged.length, 2);
  assert.equal(second.spawned.length, 0);
  const third = world.reloadZone(21, [{ ...a, hp: 29999 }]);
  assert.equal(third.updated.length, 1);
  assert.equal(third.despawned.length, 1);
  assert.equal(world.byId.size, 1);
});

test('merchant interaction validates range/zone and returns standardized WS22 handoff result', () => {
  const world = new NpcWorld();
  const npc = sample(); world.add(npc);
  const calls = [];
  const router = new NpcInteractionRouter({ world, interactionRange: 6, merchant: ctx => { calls.push(ctx); return { sellingGroup: ctx.npc.sellingGroup }; } });
  const ok = router.route(packetEvent(10000), { playerId: 'p1', zoneId: 21, x: 309, z: 398 });
  assert.deepEqual(ok, { kind: 'npc-interaction', status: 'handled', route: 'merchant', instanceId: 10000, templateSid: 13001, result: { sellingGroup: 203002 } });
  assert.equal(calls.length, 1);
  assert.equal(router.route(packetEvent(10000), { zoneId: 21, x: 400, z: 398 }).reason, 'out-of-range');
  assert.equal(router.route(packetEvent(10000), { zoneId: 1, x: 307, z: 398 }).reason, 'wrong-zone');
});

test('fail-closed range validation never invents a 1298 interaction distance', () => {
  const world = new NpcWorld(); world.add(sample());
  const router = new NpcInteractionRouter({ world, merchant: () => ({}) });
  assert.equal(router.route(packetEvent(10000), { zoneId: 21, x: 307, z: 398 }).reason, 'range-policy-unconfigured');
});

test('disabled/dead NPCs reject interaction', () => {
  const world = new NpcWorld(); world.add(sample({ enabled: false }));
  const router = new NpcInteractionRouter({ world, interactionRange: 6, merchant: () => ({}) });
  assert.equal(router.route(packetEvent(10000), { zoneId: 21, x: 307, z: 398 }).reason, 'npc-disabled');
  world.setState(10000, { enabled: true, dead: true });
  assert.equal(router.route(packetEvent(10000), { zoneId: 21, x: 307, z: 398 }).reason, 'npc-dead');
});

test('unverified quest/gate semantics remain fail-closed in production seed', () => {
  const world = new NpcWorld();
  const questNpc = loadMoradon().find(n => n.templateSid === 16011);
  world.add(questNpc);
  const router = new NpcInteractionRouter({ world, interactionRange: 6, quest: () => ({}) });
  assert.equal(router.route(packetEvent(questNpc.instanceId), { zoneId: 21, x: questNpc.x, z: questNpc.z }).reason, 'interaction-unverified');
});

test('quest, inn and world ports are isolated handoffs when classification is verified', () => {
  for (const [route, role, extra, port] of [
    ['quest', 'quest', {}, 'quest'],
    ['inn', 'inn', { npcType: 31, sellingGroup: 0 }, 'inn'],
    ['world', 'gate', { npcType: 136, sellingGroup: 0 }, 'worldTransition'],
  ]) {
    const world = new NpcWorld();
    world.add(sample({ role, interactionRoute: route, interactionVerified: true, ...extra }));
    let called = 0;
    const options = { world, interactionRange: 6, [port]: ({ action }) => { called++; return { action }; } };
    const result = new NpcInteractionRouter(options).route(packetEvent(10000), { zoneId: 21, x: 307, z: 398 });
    assert.equal(result.route, route);
    assert.equal(result.status, 'handled');
    assert.equal(result.result.action, 'interact');
    assert.equal(called, 1);
  }
});

test('multiple players can interact with the same NPC without shared mutable router state', () => {
  const world = new NpcWorld(); world.add(sample());
  const seen = [];
  const router = new NpcInteractionRouter({ world, interactionRange: 6, merchant: ({ session }) => { seen.push(session.playerId); return session.playerId; } });
  const a = router.route(packetEvent(10000), { playerId: 'a', zoneId: 21, x: 307, z: 398 });
  const b = router.route(packetEvent(10000), { playerId: 'b', zoneId: 21, x: 308, z: 398 });
  assert.deepEqual(seen, ['a', 'b']);
  assert.equal(a.result, 'a'); assert.equal(b.result, 'b');
});

test('target HP is authoritative and wrong-zone target query is rejected', () => {
  const world = new NpcWorld(); world.add(sample());
  const router = new NpcInteractionRouter({ world, interactionRange: 6 });
  const ok = router.route(packetTarget(10000), { zoneId: 21 });
  assert.equal(ok.kind, 'packets');
  assert.equal(ok.packets[0].readUInt32LE(4), 30000);
  assert.equal(router.route(packetTarget(10000), { zoneId: 1 }).reason, 'wrong-zone');
});

test('REQ_NPCIN detail response does not leak NPCs from another zone', () => {
  const world = new NpcWorld();
  world.add(sample());
  world.add(sample({ instanceId: 10001, zoneId: 1, x: 100, z: 100 }));
  const req = Buffer.from([0x1d, 0x02, 0x00, 0x10, 0x27, 0x11, 0x27]);
  const response = new NpcInteractionRouter({ world }).route(req, { zoneId: 21 });
  assert.equal(response.packets[0].readUInt16LE(1), 1);
  assert.equal(response.packets[0].readUInt16LE(3), 10000);
});

test('100+ NPC region simulation remains deterministic', () => {
  const world = new NpcWorld();
  for (let i = 0; i < 180; i++) {
    world.add(sample({ instanceId: 10000 + i, name: `N${i}`, x: 300 + (i % 18), z: 390 + Math.floor(i / 18) }));
  }
  const ids = world.nearby(21, 307, 398).map(n => n.instanceId);
  assert.equal(ids.length, 180);
  assert.equal(ids[0], 10000);
  assert.equal(ids.at(-1), 10179);
});

test('malformed packet fuzz is rejected/unhandled without throwing', () => {
  const world = new NpcWorld(); world.add(sample());
  const router = new NpcInteractionRouter({ world, interactionRange: 6 });
  for (let len = 0; len < 64; len++) {
    for (const opcode of [0x1d, 0x20, 0x22, 0xff]) {
      const b = Buffer.alloc(len, 0xa5);
      if (len) b[0] = opcode;
      assert.doesNotThrow(() => router.route(b, { zoneId: 21, x: 307, z: 398 }));
    }
  }
});

test('despawn followed by region resync removes the NPC', () => {
  const world = new NpcWorld(); world.add(sample());
  const router = new NpcInteractionRouter({ world });
  const before = router.regionSync({ zoneId: 21, x: 307, z: 398 }, []);
  assert.deepEqual(before.ids, [10000]);
  world.despawn(10000);
  const after = router.regionSync({ zoneId: 21, x: 307, z: 398 }, before.ids);
  assert.deepEqual(after.ids, []);
  assert.deepEqual(after.leave, [10000]);
  assert.deepEqual([...after.leavePackets[0]], [0x0a, 0x02, 0x10, 0x27]);
});

test('spawn packet encodes a catalog-backed Moradon NPC', () => {
  const p = encodeNpcIn(loadCaspy());
  assert.equal(p[0], 0x0a);
  assert.equal(p.readUInt16LE(4), 22000);
});
