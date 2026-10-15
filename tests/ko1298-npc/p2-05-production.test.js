'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  OPCODES,
  WAREHOUSE_SUBPACKETS,
  P2_05_INTERACTION_RANGE,
  createProductionNpcRuntime,
  classifyNpcBinding,
  buildNpcCoverage,
} = require('../../services/ko1298-npc/production');

function click(id) {
  const packet = Buffer.alloc(3);
  packet[0] = OPCODES.WIZ_NPC_EVENT;
  packet.writeUInt16LE(id, 1);
  return packet;
}

function worldWith(npc) { return { get: (id) => id === npc.instanceId ? npc : null }; }
function actor(npc, dx = 0) { return { zoneId: npc.zoneId, position: { x: npc.x + dx, y: npc.y, z: npc.z } }; }

const merchant = Object.freeze({ instanceId: 10001, templateSid: 13001, zoneId: 21, x: 100, y: 0, z: 100, npcType: 21, sellingGroup: 203002, interactionRoute: 'merchant', interactionVerified: true });
const tinker = Object.freeze({ ...merchant, instanceId: 10002, templateSid: 13004, npcType: 22, sellingGroup: 201000 });
const inn = Object.freeze({ ...merchant, instanceId: 10003, templateSid: 12000, npcType: 31, sellingGroup: 0, interactionRoute: 'inn' });

test('merchant click reaches real 1298 WIZ_TRADE_NPC response through nested router result', async () => {
  const runtime = createProductionNpcRuntime({ world: worldWith(merchant) });
  const outcome = await runtime.router.route(click(merchant.instanceId), actor(merchant));
  assert.equal(outcome.status, 'handled');
  assert.equal(outcome.clientPackets.length, 1);
  assert.equal(outcome.clientPackets[0][0], OPCODES.WIZ_TRADE_NPC);
  assert.equal(outcome.clientPackets[0].readUInt32LE(1), merchant.sellingGroup);
});

test('tinker click opens repair protocol, not merchant protocol', async () => {
  const runtime = createProductionNpcRuntime({ world: worldWith(tinker) });
  const outcome = await runtime.router.route(click(tinker.instanceId), actor(tinker));
  assert.equal(outcome.clientPackets[0][0], OPCODES.WIZ_REPAIR_NPC);
  assert.equal(outcome.clientPackets[0].readUInt32LE(1), tinker.sellingGroup);
});

test('inn click emits warehouse innkeeper subpacket only', async () => {
  const runtime = createProductionNpcRuntime({ world: worldWith(inn) });
  const outcome = await runtime.router.route(click(inn.instanceId), actor(inn));
  assert.deepEqual([...outcome.clientPackets[0]], [OPCODES.WIZ_WAREHOUSE, WAREHOUSE_SUBPACKETS.N3_SP_WARE_INN]);
});

test('server rejects NPC click outside verified 11m range', async () => {
  const runtime = createProductionNpcRuntime({ world: worldWith(merchant) });
  const outcome = await runtime.router.route(click(merchant.instanceId), actor(merchant, P2_05_INTERACTION_RANGE + 0.01));
  assert.equal(outcome.kind, 'reject');
  assert.equal(outcome.reason, 'out-of-range');
});

test('server rejects wrong-zone NPC click', async () => {
  const runtime = createProductionNpcRuntime({ world: worldWith(merchant) });
  const outcome = await runtime.router.route(click(merchant.instanceId), { ...actor(merchant), zoneId: 1 });
  assert.equal(outcome.kind, 'reject');
  assert.equal(outcome.reason, 'wrong-zone');
});

test('unverified quest remains fail-closed instead of returning success', async () => {
  const quest = { ...merchant, instanceId: 10004, templateSid: 13009, npcType: 34, sellingGroup: 0, interactionRoute: 'quest', interactionVerified: false };
  const runtime = createProductionNpcRuntime({ world: worldWith(quest) });
  const outcome = await runtime.router.route(click(quest.instanceId), actor(quest));
  assert.equal(outcome.kind, 'reject');
  assert.equal(outcome.reason, 'interaction-unverified');
});

test('catalog classification exposes source mismatches instead of silently wiring them', () => {
  assert.deepEqual(classifyNpcBinding({ name: 'Miraselth[Warehouse Keeper]', npcType: 29, role: 'other', sellingGroup: 0 }), {
    service: 'source-review', status: 'blocked-source-mismatch', blocker: 'WAREHOUSE_NAME_TYPE_MISMATCH_EXPECTED_31_GOT_29',
  });
  assert.deepEqual(classifyNpcBinding({ name: 'Selith[Special Store]', npcType: 23, role: 'other', sellingGroup: 0 }), {
    service: 'special-store', status: 'blocked-source', blocker: 'SELITH_SPECIAL_STORE_HANDLER_UNVERIFIED',
  });
  assert.deepEqual(classifyNpcBinding({ name: 'Aban[Battlefield Gate-keeper]', npcType: 136, role: 'gate', interactionRoute: 'world', sellingGroup: 0 }), {
    service: 'source-review', status: 'blocked-source-mismatch', blocker: 'GATE_ROUTE_TYPE_MISMATCH_EXPECTED_28_GOT_136',
  });
});

test('coverage register contains every template and every spawn anchor', () => {
  const catalog = {
    zoneId: 21,
    templates: [
      { templateSid: 13001, name: 'Caspy', npcType: 21, sellingGroup: 203002, role: 'merchant', interactionRoute: 'merchant', interactionVerified: true, sourceRow: 'sSid=13001' },
      { templateSid: 12000, name: 'Inn hostess', npcType: 31, sellingGroup: 0, role: 'inn', interactionRoute: 'inn', interactionVerified: true, sourceRow: 'sSid=12000' },
    ],
    spawns: [
      { spawnKey: '21:13001:1', templateSid: 13001, anchor: { x: 307, z: 398 }, sourceRow: 'merchant-spawn' },
      { spawnKey: '21:12000:1', templateSid: 12000, anchor: { x: 368, z: 425 }, sourceRow: 'inn-spawn' },
    ],
  };
  const coverage = buildNpcCoverage(catalog);
  assert.equal(coverage.length, catalog.templates.length);
  assert.equal(coverage.reduce((n, row) => n + row.spawns.length, 0), catalog.spawns.length);
  assert.equal(coverage[0].spawns[0].x, 307);
  assert.equal(coverage[1].spawns[0].z, 425);
});

const { OfferedOptionLedger } = require('../../services/ko1298-npc/quest-bridge');
const canonicalMoradon = require('../../world-data/npc/moradon.json');

test('quest option ledger accepts only the exact server-offered option and consumes it once', () => {
  const ledger = new OfferedOptionLedger();
  ledger.offer({ sessionId: 's1', npcRuntimeId: 10004, npcTemplateSid: 13009, options: [{ action: 'accept:21001', menuId: 21101 }] });
  const selected = ledger.select({ sessionId: 's1', npcRuntimeId: 10004, index: 0 });
  assert.equal(selected.action, 'accept:21001');
  assert.throws(() => ledger.select({ sessionId: 's1', npcRuntimeId: 10004, index: 0 }), /no active server-authored NPC offer/);
});

test('quest option ledger rejects selection for a different NPC', () => {
  const ledger = new OfferedOptionLedger();
  ledger.offer({ sessionId: 's2', npcRuntimeId: 10004, npcTemplateSid: 13009, options: [{ action: 'accept:21001' }] });
  assert.throws(() => ledger.select({ sessionId: 's2', npcRuntimeId: 10005, index: 0 }), /does not belong/);
});

test('canonical Moradon catalog has an exhaustive binding record for all 31 source templates and every spawn', () => {
  const coverage = buildNpcCoverage(canonicalMoradon);
  assert.equal(canonicalMoradon.templates.length, 31);
  assert.equal(coverage.length, canonicalMoradon.templates.length);
  assert.equal(coverage.reduce((n, row) => n + row.spawns.length, 0), canonicalMoradon.spawns.length);
  assert.deepEqual(new Set(coverage.map(row => row.templateSid)), new Set(canonicalMoradon.templates.map(row => row.templateSid)));
  assert.ok(coverage.every(row => typeof row.source === 'string' && row.source.length > 0));
  assert.ok(coverage.every(row => row.status !== 'wired' || row.interactionVerified));
});
