#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const providerRoot = path.resolve(process.argv[2]);
const outputPath = path.resolve(process.argv[3] || 'artifacts/ws49/c5-visibility-gate.json');
const smdPath = process.env.WS49_MORADON_SMD;
if (!providerRoot || !smdPath || !fs.existsSync(smdPath)) throw new Error('provider root and WS49_MORADON_SMD are required');

const worldApi = require(path.join(providerRoot, 'services/ko1298-world'));
const ws16 = require(path.join(providerRoot, 'services/ko1298-npc'));
const ws25 = require(path.join(providerRoot, 'services/ko1298-mobs'));

const {
  OPCODE, GAMESTART_PHASE, WORLD_STATE,
  MockWorldRepository, WorldSessionService,
  createMoradonHeightResolver, createSharedNpcRuntimeIdNamespace,
  buildRegionNpcIds, buildSurroundingNpcs, buildNpcIn, buildNpcOut,
} = worldApi;

const manifest = JSON.parse(fs.readFileSync(path.join(providerRoot, 'ws50-provider-set.json'), 'utf8'));
const EXPECTED_KEY = 'WS50-C5@sha256:7ac3b8a4c06b67e52b8d18518ef8c82209a60c6101c33609a4c16e64d84f119e';
assert.equal(manifest.immutable_key, EXPECTED_KEY);

function character(accountId, characterId) {
  return {
    accountId, characterId, nation: 1, race: 1, classId: 101, face: 0, hair: 0,
    rank: 0, title: 0, level: 1, points: 0, maxExp: 1, exp: 0,
    loyalty: 0, monthlyLoyalty: 0, city: 0, knightsId: 0, fame: 0,
    maxHp: 100, hp: 100, maxMp: 100, mp: 100, maxWeight: 1000, itemWeight: 0,
    str: 50, itemStr: 0, sta: 50, itemSta: 0, dex: 50, itemDex: 0,
    intel: 50, itemIntel: 0, cha: 50, itemCha: 0, totalHit: 1, totalAc: 1,
    fireRes: 0, coldRes: 0, lightningRes: 0, magicRes: 0, diseaseRes: 0, poisonRes: 0,
    gold: 0, authority: 0, direction: 0, skills: Array(9).fill(0),
    protocolItems: [], visibleEquipment: [],
  };
}
function phase(value) { return Buffer.from([OPCODE.GAMESTART, value]); }
function detailRequest(ids) {
  const packet = Buffer.alloc(3 + ids.length * 2);
  packet[0] = OPCODE.REQUEST_NPC_IN;
  packet.writeInt16LE(ids.length, 1);
  ids.forEach((id, index) => packet.writeInt16LE(id, 3 + index * 2));
  return packet;
}
function regionIds(packet) {
  assert.equal(packet[0], OPCODE.REGION_NPC_IDS);
  const count = packet.readInt16LE(1);
  assert.equal(packet.length, 3 + count * 2);
  const ids = [];
  for (let i = 0; i < count; i += 1) ids.push(packet.readInt16LE(3 + i * 2));
  return ids;
}
function ids(records) { return records.map((record) => record.runtimeId ?? record.instanceId ?? record.nid).sort((a, b) => a - b); }
function setDiff(a, b) { const bs = new Set(b); return a.filter((id) => !bs.has(id)); }

const resolver = createMoradonHeightResolver({ smdPath });
const npcDoc = JSON.parse(fs.readFileSync(path.join(providerRoot, 'world-data/npc/moradon.json'), 'utf8'));
const npcPopulation = ws16.materializeNpcPopulation(npcDoc, { heightAuthority: resolver });
assert.equal(npcPopulation.records.length, 37);
const npcWorld = new ws16.NpcWorld();
for (const record of npcPopulation.records) npcWorld.add(record);

const namespace = createSharedNpcRuntimeIdNamespace({
  minInclusive: ws25.RUNTIME_ID_CONTRACT.NPC_BAND,
  maxExclusive: ws25.RUNTIME_ID_CONTRACT.INVALID_BAND,
  reserved: npcPopulation.records,
});
const mobDoc = JSON.parse(fs.readFileSync(path.join(providerRoot, 'world-data/mobs/verified/moradon-zone21.verified.json'), 'utf8'));
const mobDefinition = ws25.loadVerifiedWorldDefinition(mobDoc);
const mobService = new ws25.MobVisibilityService(mobDefinition, {
  terrain: { resolveHeight(zoneId, x, z) { return resolver.resolveHeight(Number(zoneId), x, z); } },
  runtimeIds: namespace,
});
const allMobs = mobService.initialize(0);
assert.equal(allMobs.length, 135);
assert.equal(mobService.runtimeIdentityPolicy().ready, true);
assert.equal(mobService.runtimeIdentityPolicy().claimed, 135);

const npcIds = ids(npcPopulation.records);
const mobIds = ids(allMobs);
assert.equal(new Set(npcIds).size, 37);
assert.equal(new Set(mobIds).size, 135);
assert.equal(mobIds.filter((id) => new Set(npcIds).has(id)).length, 0);
for (const npc of npcPopulation.records) {
  assert.equal(npc.positionAuthority.status, 'authoritative');
  assert.ok([npc.x, npc.y, npc.z].every(Number.isFinite));
}
for (const mob of allMobs) {
  const detail = mobService.detailSnapshot(mob.runtimeId);
  assert.ok([detail.x, detail.y, detail.z].every(Number.isFinite));
}

function visibleAt(position) {
  const npcs = npcWorld.nearby(21, position.x, position.z);
  const mobs = mobService.getNearby({ zoneId: 21, x: position.x, z: position.z });
  const records = [...npcs, ...mobs].sort((a, b) => (a.runtimeId ?? a.instanceId) - (b.runtimeId ?? b.instanceId));
  return { position, npcs, mobs, records, ids: ids(records) };
}

let regionA = null;
for (const mob of allMobs) {
  const candidate = visibleAt(mob.position);
  if (candidate.npcs.length > 0 && candidate.mobs.length > 0) { regionA = candidate; break; }
}
assert.ok(regionA, 'no real region contains both NPC and mob visibility');

let regionB = null;
for (const mob of allMobs) {
  const candidate = visibleAt(mob.position);
  const leave = setDiff(regionA.ids, candidate.ids);
  const enter = setDiff(candidate.ids, regionA.ids);
  if (leave.length > 0 && enter.length > 0) { regionB = candidate; break; }
}
assert.ok(regionB, 'no real region crossing produces both leave and enter sets');

const leaveIds = setDiff(regionA.ids, regionB.ids);
const enterIds = setDiff(regionB.ids, regionA.ids);
const byIdB = new Map(regionB.records.map((r) => [r.runtimeId ?? r.instanceId ?? r.nid, r]));
const enterRecords = enterIds.map((id) => byIdB.get(id));
assert.ok(enterRecords.every(Boolean));

const regionABytes = buildRegionNpcIds(regionA.records);
const regionBBytes = buildRegionNpcIds(regionB.records);
assert.deepEqual(regionIds(regionABytes), regionA.ids);
assert.deepEqual(regionIds(regionBBytes), regionB.ids);
for (const id of leaveIds) {
  const out = buildNpcOut(id);
  assert.equal(out[0], OPCODE.NPC_INOUT);
  assert.equal(out[1], 0x02);
}
const enterDetails = buildSurroundingNpcs(enterRecords);
assert.equal(enterDetails[0], OPCODE.REQUEST_NPC_IN);
assert.equal(enterDetails.readInt16LE(1), enterRecords.length);
for (const record of enterRecords.slice(0, Math.min(8, enterRecords.length))) {
  const packet = buildNpcIn(record);
  assert.equal(packet[0], OPCODE.NPC_INOUT);
  assert.equal(packet[1], 0x01);
}

const npcProbe = regionA.npcs[0];
const mobProbe = regionA.mobs[0];
for (const probe of [npcProbe, mobProbe]) {
  const inside = buildNpcIn(probe);
  const outside = buildNpcOut(probe.runtimeId ?? probe.instanceId ?? probe.nid);
  assert.equal(inside[0], OPCODE.NPC_INOUT); assert.equal(inside[1], 0x01);
  assert.equal(outside[0], OPCODE.NPC_INOUT); assert.equal(outside[1], 0x02);
}

let movementRegistrations = 0;
const repo = new MockWorldRepository({
  characters: [character('a1', 'p1'), character('a2', 'p2')],
  npcs: regionA.npcs,
});
const service = new WorldSessionService({
  repository: repo,
  mobPort: mobService,
  movementPort: { registerSession() { movementRegistrations += 1; }, disconnect() {} },
});

async function bootstrap(accountId, characterId, socketId) {
  await service.beginWorldEntry({ accountId, characterId, socketId, zoneId: 21, position: regionA.position });
  const loading = await service.handleClientPacket(socketId, phase(GAMESTART_PHASE.LOADING));
  assert.equal(loading.state, WORLD_STATE.WAIT_GAMESTART_LOADED);
  const regionPacket = loading.clientPackets.find((packet) => packet[0] === OPCODE.REGION_NPC_IDS);
  assert.ok(regionPacket);
  assert.deepEqual(regionIds(regionPacket), regionA.ids);

  const mixed = await service.handleClientPacket(socketId, detailRequest([
    npcProbe.runtimeId ?? npcProbe.instanceId,
    mobProbe.runtimeId ?? mobProbe.instanceId,
  ]));
  assert.equal(mixed.clientPackets[0][0], OPCODE.REQUEST_NPC_IN);
  assert.equal(mixed.clientPackets[0].readInt16LE(1), 2);

  const unknown = await service.handleClientPacket(socketId, detailRequest([29999]));
  assert.equal(unknown.clientPackets[0][0], OPCODE.REQUEST_NPC_IN);
  assert.equal(unknown.clientPackets[0].readInt16LE(1), 0);

  await assert.rejects(
    service.handleClientPacket(socketId, Buffer.from([OPCODE.REQUEST_NPC_IN, 1, 0])),
    /bytes|length|packet|request/i,
  );
  assert.equal(service.getSession(socketId).state, WORLD_STATE.WAIT_GAMESTART_LOADED);

  const ready = await service.handleClientPacket(socketId, phase(GAMESTART_PHASE.LOADED));
  assert.equal(ready.state, WORLD_STATE.WORLD_READY);
  return regionPacket;
}

(async () => {
  const p1Region = await bootstrap('a1', 'p1', 101);
  const p2Region = await bootstrap('a2', 'p2', 202);
  assert.deepEqual(p1Region, p2Region);
  assert.equal(movementRegistrations, 2);

  repo.setAuthoritativeWorldState({
    accountId: 'a1', characterId: 'p1', zoneId: 21,
    x: regionA.position.x, y: regionA.position.y, z: regionA.position.z,
  });
  const beforeReconnectMobIds = ids(mobService.visibilitySnapshot());
  assert.equal(service.disconnect(101, 'WS49_RECONNECT').disconnected, true);
  await service.restoreAuthoritativeSession({ accountId: 'a1', characterId: 'p1', socketId: 303 });
  const reconnectLoading = await service.handleClientPacket(303, phase(GAMESTART_PHASE.LOADING));
  const reconnectRegion = reconnectLoading.clientPackets.find((packet) => packet[0] === OPCODE.REGION_NPC_IDS);
  assert.deepEqual(regionIds(reconnectRegion), regionA.ids);
  assert.equal(new Set(regionIds(reconnectRegion)).size, regionA.ids.length);
  assert.deepEqual(ids(mobService.visibilitySnapshot()), beforeReconnectMobIds);
  const reconnectReady = await service.handleClientPacket(303, phase(GAMESTART_PHASE.LOADED));
  assert.equal(reconnectReady.state, WORLD_STATE.WORLD_READY);
  assert.equal(movementRegistrations, 3);

  service.disconnect(202, 'WS49_DONE');
  service.disconnect(303, 'WS49_DONE');

  const report = {
    schema_version: 'ws49-moradon-visibility-gate/v1',
    provider_set: manifest.immutable_key,
    result: 'PASS',
    real_providers: true,
    synthetic_substitute: false,
    counts: { npc_runtime_ids: npcIds.length, mob_runtime_ids: mobIds.length, cross_domain_collisions: 0 },
    region_a: { x: regionA.position.x, y: regionA.position.y, z: regionA.position.z, npc_ids: ids(regionA.npcs), mob_ids: ids(regionA.mobs), combined_ids: regionA.ids },
    region_b: { x: regionB.position.x, y: regionB.position.y, z: regionB.position.z, npc_ids: ids(regionB.npcs), mob_ids: ids(regionB.mobs), combined_ids: regionB.ids },
    region_crossing: { leave_ids: leaveIds, enter_ids: enterIds, old_entities_out: true, new_entities_discovery_detail: true },
    acceptance: {
      login_world_ready_regression: true,
      movement_regression: true,
      real_npc_region_ids: true,
      real_mob_region_ids: true,
      npc_detail_recovery: true,
      mob_detail_recovery: true,
      npc_in_out: true,
      mob_in_out: true,
      authoritative_xyz: true,
      runtime_id_uniqueness: true,
      region_crossing: true,
      reconnect_no_duplicate_stale_identity: true,
      malformed_unknown_id_fail_safe: true,
      two_player_consistency: true,
    },
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`WS49_C5_VISIBILITY_GATE PASS ${manifest.immutable_key}`);
  console.log(`WS49_REGION_CROSSING leave=${leaveIds.length} enter=${enterIds.length}`);
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
