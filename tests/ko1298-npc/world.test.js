'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  NpcWorld, NpcInteractionRouter, resolveNpcData, materializeNpcPopulation,
  validateNpcCatalog, catalogStats, createHeightAuthorityPort, encodeNpcIn,
  NPC_BAND, HEIGHT_AUTHORITY_DEPENDENCY,
} = require('../../services/ko1298-npc');

const seedPath = path.join(__dirname, '../../world-data/npc/moradon.json');
function loadDoc() { return JSON.parse(fs.readFileSync(seedPath, 'utf8')); }

const testHeightAuthority = Object.freeze({
  resolveHeight(zoneId, x, z) {
    return {
      status: 'authoritative',
      height: Number((zoneId * 0.01 + x * 0.03125 + z * 0.015625).toFixed(5)),
      surface: 'test-contract-only',
    };
  },
});

function loadMoradon() { return resolveNpcData(loadDoc(), { heightAuthority: testHeightAuthority }); }
function loadCaspy() { return loadMoradon().find(n => n.templateSid === 13001); }
function packetEvent(id) { const b = Buffer.alloc(3); b[0] = 0x20; b.writeUInt16LE(id, 1); return b; }
function packetTarget(id) { const b = Buffer.alloc(4); b[0] = 0x22; b.writeUInt16LE(id, 1); b[3] = 1; return b; }

function sample(overrides = {}) {
  const source = loadCaspy();
  const requestedRuntimeId = Object.prototype.hasOwnProperty.call(overrides, 'instanceId') ? overrides.instanceId : 10000;
  const base = {
    ...source,
    instanceId: requestedRuntimeId,
    runtimeId: requestedRuntimeId,
    sourceInstanceKey: `test:${requestedRuntimeId}`,
    ...overrides,
  };
  const runtimeId = base.instanceId;
  const sourceInstanceKey = Object.prototype.hasOwnProperty.call(overrides, 'sourceInstanceKey')
    ? overrides.sourceInstanceKey
    : `test:${runtimeId}`;
  const height = testHeightAuthority.resolveHeight(base.zoneId, base.x, base.z);
  return {
    ...base,
    instanceId: runtimeId,
    runtimeId,
    sourceInstanceKey,
    y: height.height,
    identity: Object.freeze({ templateSid: base.templateSid, instanceKey: sourceInstanceKey, runtimeId }),
    position: Object.freeze({ zoneId: base.zoneId, x: base.x, y: height.height, z: base.z }),
    positionAuthority: Object.freeze({
      dependency: HEIGHT_AUTHORITY_DEPENDENCY,
      status: 'authoritative',
      surface: height.surface,
      source: null,
    }),
  };
}

test('Moradon catalog is source-backed, duplicate-free and preserves 31/39/43 regression', () => {
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

test('catalog refuses duplicate template/spawn records and any source-declared Y', () => {
  const doc = loadDoc();
  const dupTemplate = structuredClone(doc);
  dupTemplate.templates.push(structuredClone(doc.templates[0]));
  assert.throws(() => validateNpcCatalog(dupTemplate), /duplicate NPC templateSid/);
  const dupSpawn = structuredClone(doc);
  dupSpawn.spawns.push(structuredClone(doc.spawns[0]));
  assert.throws(() => validateNpcCatalog(dupSpawn), /duplicate NPC spawn/);
  const withY = structuredClone(doc);
  withY.spawns[0].anchor.y = 0;
  assert.throws(() => validateNpcCatalog(withY), /must not declare Y/);
});

test('Moradon materialization consumes resolveHeight and fails closed unless status is authoritative', () => {
  const doc = loadDoc();
  assert.throws(() => resolveNpcData(doc), /heightAuthority\.resolveHeight/);
  assert.throws(
    () => resolveNpcData(doc, { heightAuthority: { resolveHeight: () => ({ status: 'unresolved', reason: 'no-map' }) } }),
    error => error?.code === 'NPC_HEIGHT_NOT_AUTHORITATIVE',
  );
  assert.throws(
    () => resolveNpcData(doc, { heightAuthority: { resolveHeight: () => ({ status: 'authoritative', height: Number.NaN }) } }),
    error => error?.code === 'NPC_HEIGHT_NOT_AUTHORITATIVE',
  );
  const report = materializeNpcPopulation(doc, { heightAuthority: testHeightAuthority });
  assert.equal(report.records.length, 37);
  assert.equal(report.authoritativeNpcCount, 37);
  assert.equal(report.sourceDeclaredPopulation, 43);
  assert.equal(report.unresolved.length, 2);
  assert.deepEqual(report.unresolved.map(row => row.templateSid).sort((a, b) => a - b), [16082, 16083]);
  assert.equal(report.records[0].instanceId, NPC_BAND);
  assert.equal(report.records.every(n => n.positionAuthority.status === 'authoritative'), true);
  assert.equal(report.records.some(n => n.templateSid === 16082), false);
  assert.equal(report.records.some(n => n.templateSid === 16083), false);
});

test('height authority port delegates to the public resolveHeight(zoneId,x,z) dependency without owning terrain logic', () => {
  const calls = [];
  const provider = {
    resolveHeight(zoneId, x, z) {
      calls.push([zoneId, x, z]);
      return { status: 'authoritative', height: x - z, surface: 'provider' };
    },
  };
  const port = createHeightAuthorityPort(provider);
  assert.deepEqual(port.resolveHeight(21, 307, 398), { status: 'authoritative', height: -91, surface: 'provider' });
  assert.deepEqual(calls, [[21, 307, 398]]);
  assert.equal(port.dependency, 'terrain.height-authority');
});

test('NpcWorld rejects finite but unauthoritative Y before any visibility is produced', () => {
  const world = new NpcWorld();
  const unsafe = { ...sample(), positionAuthority: { dependency: HEIGHT_AUTHORITY_DEPENDENCY, status: 'unresolved' } };
  assert.throws(() => world.add(unsafe), error => error?.code === 'NPC_POSITION_NOT_AUTHORITATIVE');
  assert.equal(world.nearby(21, unsafe.x, unsafe.z).length, 0);
  assert.equal(world.byId.size, 0);
});

test('nearby uses verified 48-unit, 3x3 region neighborhood', () => {
  const world = new NpcWorld();
  const caspy = sample();
  world.add(caspy);
  world.add(sample({ instanceId: 10100, name: 'Near', x: 370, z: 398 }));
  world.add(sample({ instanceId: 10101, name: 'Far', x: 450, z: 398 }));
  assert.deepEqual(world.nearby(21, 307, 398).map(n => n.instanceId), [caspy.instanceId, 10100].sort((a, b) => a - b));
});

test('detail/nearby semantic snapshots carry authoritative XYZ and separated identities', () => {
  const world = new NpcWorld();
  const npc = world.add(loadCaspy());
  const detail = world.detailSnapshot(npc.instanceId);
  assert.deepEqual(detail.position, { zoneId: 21, x: npc.x, y: npc.y, z: npc.z });
  assert.equal(detail.positionAuthority.status, 'authoritative');
  assert.deepEqual(detail.identity, {
    templateSid: npc.templateSid,
    instanceKey: npc.spawnKey,
    runtimeId: npc.instanceId,
  });
  assert.equal(detail.templateSid, 13001);
  assert.equal(detail.runtimeId, detail.instanceId);
  assert.equal(world.nearbySnapshot(21, npc.x, npc.z)[0].position.y, npc.y);
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

test('region enter/leave delta is deterministic and semantic region snapshots retain authority', () => {
  const world = new NpcWorld();
  world.add(sample());
  world.add(sample({ instanceId: 10001, x: 370 }));
  const first = world.regionDelta(21, 307, 398, []);
  assert.deepEqual(first.ids, [10000, 10001]);
  const semantic = world.regionDeltaSnapshot(21, 307, 398, []);
  assert.equal(semantic.enter.every(n => n.positionAuthority.status === 'authoritative'), true);
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

test('state mutation cannot replace authoritative identity or position', () => {
  const world = new NpcWorld();
  const before = world.add(sample());
  const after = world.setState(before.instanceId, {
    hp: before.hp - 1,
    x: 1,
    y: 2,
    z: 3,
    runtimeId: 19999,
    templateSid: 99999,
    sourceInstanceKey: 'forged',
    positionAuthority: { dependency: HEIGHT_AUTHORITY_DEPENDENCY, status: 'unresolved' },
  });
  assert.equal(after.hp, before.hp - 1);
  assert.deepEqual(after.position, before.position);
  assert.deepEqual(after.identity, before.identity);
  assert.equal(after.runtimeId, before.runtimeId);
  assert.equal(after.templateSid, before.templateSid);
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

test('spawn packet encodes an already-authoritative catalog-backed Moradon NPC', () => {
  const p = encodeNpcIn(loadCaspy());
  assert.equal(p[0], 0x0a);
  assert.equal(p.readUInt16LE(4), 22000);
});
