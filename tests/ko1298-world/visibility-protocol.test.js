'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  OPCODE,
  GAMESTART_PHASE,
  WORLD_STATE,
  MockWorldRepository,
  WorldSessionService,
  buildRegionNpcIds,
  parseNpcInRequest,
  buildSurroundingNpcs,
  buildNpcIn,
  buildNpcOut,
  canonicalNpcDetailRecord,
  assertUniqueRuntimeIds,
} = require('../../services/ko1298-world');

const FALLBACK_PAYLOADS = Object.freeze({
  'npc_region_list.bin': '1c020011277427',
  'req_npcin_request.bin': '1d020011277427',
  'req_npcin_response.bin': '1d02001127c93201fa180300640000000000000000000543617370790001300cb40f0000010000000000000000007427ee0200000000006400000000000000000004576f726d0001800c0410000001000000000000000000',
  'npc_in_spawn.bin': '0a011127c93201fa180300640000000000000000000543617370790001300cb40f000001000000000000000000',
  'npc_out_despawn.bin': '0a021127',
  'monster_in_spawn.bin': '0a017427ee0200000000006400000000000000000004576f726d0001800c0410000001000000000000000000',
  'monster_out_despawn.bin': '0a027427',
});

function unwrapFrame(frame) {
  assert.equal(frame[0], 0xaa);
  assert.equal(frame[1], 0x55);
  const length = frame.readUInt16LE(2);
  assert.equal(frame.length, 4 + length + 2);
  assert.equal(frame.at(-2), 0x55);
  assert.equal(frame.at(-1), 0xaa);
  return frame.subarray(4, 4 + length);
}

function goldenPayload(name) {
  const root = process.env.WS14_WS11_VISIBILITY_FIXTURES;
  if (root) return unwrapFrame(fs.readFileSync(path.join(root, name)));
  return Buffer.from(FALLBACK_PAYLOADS[name], 'hex');
}

function npcFixture(overrides = {}) {
  return {
    runtimeId: 10001,
    templateResourceId: 13001,
    npcType: 1,
    sellingGroup: 203002,
    scale: 100,
    weapon1: 0,
    weapon2: 0,
    name: 'Caspy',
    groupNation: 0,
    level: 1,
    position: { x: 312, z: 402, y: 0 },
    stateGateOpen: 1,
    objectType: 0,
    clientIdk0: 0,
    clientIdk1: 0,
    direction: 0,
    ...overrides,
  };
}

function monsterFixture(overrides = {}) {
  return {
    runtimeId: 10100,
    templateResourceId: 750,
    npcType: 0,
    sellingGroup: 0,
    scale: 100,
    weapon1: 0,
    weapon2: 0,
    name: 'Worm',
    groupNation: 0,
    level: 1,
    position: { x: 320, z: 410, y: 0 },
    stateGateOpen: 1,
    objectType: 0,
    clientIdk0: 0,
    clientIdk1: 0,
    direction: 0,
    ...overrides,
  };
}

function character() {
  return {
    accountId: 'a', characterId: 'c', nation: 1, race: 1, classId: 101, face: 0, hair: 0,
    rank: 0, title: 0, level: 1, points: 0, maxExp: 1, exp: 0, loyalty: 0, monthlyLoyalty: 0,
    city: 0, knightsId: 0, fame: 0, maxHp: 1, hp: 1, maxMp: 1, mp: 1, maxWeight: 1,
    itemWeight: 0, str: 1, itemStr: 0, sta: 1, itemSta: 0, dex: 1, itemDex: 0,
    intel: 1, itemIntel: 0, cha: 1, itemCha: 0, totalHit: 0, totalAc: 0, fireRes: 0,
    coldRes: 0, lightningRes: 0, magicRes: 0, diseaseRes: 0, poisonRes: 0, gold: 0,
    authority: 1, skills: Array(9).fill(0), protocolItems: [], visibleEquipment: [],
  };
}

function phase(opcode, value) { return Buffer.from([opcode, value]); }
function req(ids) {
  const b = Buffer.alloc(3 + ids.length * 2);
  b[0] = OPCODE.REQUEST_NPC_IN;
  b.writeInt16LE(ids.length, 1);
  ids.forEach((id, index) => b.writeInt16LE(id, 3 + index * 2));
  return b;
}

test('WS14 visibility encoder has byte parity with independent WS11 golden fixtures', () => {
  const npc = npcFixture();
  const mob = monsterFixture();
  assert.deepEqual(buildRegionNpcIds([npc, mob]), goldenPayload('npc_region_list.bin'));
  assert.deepEqual(parseNpcInRequest(goldenPayload('req_npcin_request.bin')), [10001, 10100]);
  assert.deepEqual(buildSurroundingNpcs([npc, mob]), goldenPayload('req_npcin_response.bin'));
  assert.deepEqual(buildNpcIn(npc), goldenPayload('npc_in_spawn.bin'));
  assert.deepEqual(buildNpcOut(10001), goldenPayload('npc_out_despawn.bin'));
  assert.deepEqual(buildNpcIn(mob), goldenPayload('monster_in_spawn.bin'));
  assert.deepEqual(buildNpcOut(10100), goldenPayload('monster_out_despawn.bin'));
});

test('WS11 signed i16 runtime/detail fields and source coordinate quantization fail closed', () => {
  assert.throws(() => buildRegionNpcIds([{ runtimeId: 32768 }]), /runtimeId/);
  assert.throws(() => buildSurroundingNpcs([npcFixture({ templateResourceId: 32768 })]), /templateResourceId/);
  assert.throws(() => buildSurroundingNpcs([npcFixture({ scale: 32768 })]), /scale/);
  assert.throws(() => buildSurroundingNpcs([npcFixture({ position: { x: 312, z: 402 } })]), /position.y/);
  assert.throws(() => buildSurroundingNpcs([npcFixture({ positionAuthority: { status: 'unresolved' } })]), /non-authoritative/);
  assert.throws(() => buildSurroundingNpcs([npcFixture({ name: 'x'.repeat(256) })]), /255/);

  const canonical = canonicalNpcDetailRecord(npcFixture({
    position: { x: 312.99, z: 402.99, y: -1.99 },
    clientIdk0: -1,
    clientIdk1: -2,
  }));
  const encoded = buildSurroundingNpcs([canonical]);
  const nameBytes = Buffer.from('Caspy', 'latin1').length;
  const recordStart = 3;
  const xOffset = recordStart + 2 + 2 + 1 + 4 + 2 + 4 + 4 + 1 + nameBytes + 1 + 1;
  assert.equal(encoded.readUInt16LE(xOffset), 3120);
  assert.equal(encoded.readUInt16LE(xOffset + 2), 4020);
  assert.equal(encoded.readInt16LE(xOffset + 4), -10);
});

test('runtime IDs are unique across NPC and monster namespaces', () => {
  assert.equal(assertUniqueRuntimeIds([npcFixture()], [monsterFixture()]), true);
  assert.throws(() => assertUniqueRuntimeIds([npcFixture()], [monsterFixture({ runtimeId: 10001 })]), /runtime ID collision 10001/);
});

test('WORLD LOADING emits one unified 0x1C NPC+monster list and 0x1D recovers both exact details', async () => {
  const npc = npcFixture({ nid: 10001, pid: 13001, size: 100, group: 0, x: 312, z: 402, y: 0, gateOpen: 1 });
  const mob = monsterFixture();
  const repository = new MockWorldRepository({ characters: [character()], npcs: [{ ...npc, zoneId: 21 }] });
  const service = new WorldSessionService({ repository, mobPort: { async getNearby() { return [mob]; } } });

  await service.beginSelectedCharacter({ accountId: 'a', characterId: 'c', socketId: 77 });
  const loading = await service.handleClientPacket(77, phase(OPCODE.GAMESTART, GAMESTART_PHASE.LOADING));
  assert.equal(loading.state, WORLD_STATE.WAIT_GAMESTART_LOADED);
  assert.deepEqual(loading.clientPackets.map((packet) => packet[0]), [0x0e, 0x5e, 0x15, 0x1c, 0x0d]);
  assert.deepEqual(loading.clientPackets[3], goldenPayload('npc_region_list.bin'));

  const details = await service.handleClientPacket(77, goldenPayload('req_npcin_request.bin'));
  assert.deepEqual(details.clientPackets[0], goldenPayload('req_npcin_response.bin'));

  const unknown = await service.handleClientPacket(77, req([10001, 12345]));
  assert.equal(unknown.clientPackets[0].readInt16LE(1), 1);
  assert.equal(unknown.clientPackets[0].readInt16LE(3), 10001);

  const ready = await service.handleClientPacket(77, phase(OPCODE.GAMESTART, 2));
  assert.equal(ready.state, WORLD_STATE.WORLD_READY);

  const mobOut = service.consumeMobVisibilityEvent(77, mob, { type: 'nearby-despawn' });
  assert.deepEqual(mobOut.clientPackets[0], goldenPayload('monster_out_despawn.bin'));
  const mobIn = service.consumeMobVisibilityEvent(77, mob, { type: 'nearby-spawn' });
  assert.deepEqual(mobIn.clientPackets[0], goldenPayload('monster_in_spawn.bin'));
  const npcOut = service.leaveNpcVisibility(77, 10001);
  assert.deepEqual(npcOut.clientPackets[0], goldenPayload('npc_out_despawn.bin'));
  const npcIn = service.enterNpcVisibility(77, npc);
  assert.deepEqual(npcIn.clientPackets[0], goldenPayload('npc_in_spawn.bin'));
});

test('world bootstrap fails closed on cross-domain collision and missing Y', async () => {
  const npc = { ...npcFixture(), nid: 10001, pid: 13001, size: 100, group: 0, x: 312, z: 402, y: 0, gateOpen: 1, zoneId: 21 };
  const collision = new WorldSessionService({
    repository: new MockWorldRepository({ characters: [character()], npcs: [npc] }),
    mobPort: { async getNearby() { return [monsterFixture({ runtimeId: 10001 })]; } },
  });
  await collision.beginSelectedCharacter({ accountId: 'a', characterId: 'c', socketId: 78 });
  await assert.rejects(collision.handleClientPacket(78, phase(OPCODE.GAMESTART, 1)), /runtime ID collision 10001/);

  const missingY = new WorldSessionService({
    repository: new MockWorldRepository({ characters: [character()] }),
    mobPort: { async getNearby() { return [monsterFixture({ position: { x: 320, z: 410 } })]; } },
  });
  await missingY.beginSelectedCharacter({ accountId: 'a', characterId: 'c', socketId: 79 });
  await assert.rejects(missingY.handleClientPacket(79, phase(OPCODE.GAMESTART, 1)), /finite authoritative Y/);
});

test('pinned WS25 provider is explicitly rejected until it supplies integer runtime visibility identity', () => {
  const root = process.env.WS14_WS25_PROVIDER_ROOT;
  if (!root) return;
  const source = fs.readFileSync(path.join(root, 'services/ko1298-mobs/mob-model.cjs'), 'utf8');
  assert.match(source, /id:\s*`\$\{group\.groupId\}\/\$\{spawn\.spawnId\}`/);
  assert.doesNotMatch(source, /runtimeId\s*:/);
  assert.throws(() => buildRegionNpcIds([{ id: 'group/spawn', position: { x: 1, y: 1, z: 1 } }]), /runtimeId/);
});

test('current WS16 semantic nearby/detail snapshots are directly encodable with WS14 authoritative Y', () => {
  const ws16Root = process.env.WS14_WS16_PROVIDER_ROOT;
  const smdPath = process.env.WS14_MORADON_SMD;
  const npcPath = process.env.WS14_WS16_NPC_DATA;
  if (!ws16Root || !smdPath || !npcPath) return;

  const ws16 = require(path.join(ws16Root, 'services/ko1298-npc'));
  const { createMoradonHeightResolver } = require('../../services/ko1298-world');
  const doc = JSON.parse(fs.readFileSync(npcPath, 'utf8'));
  const stats = ws16.catalogStats(doc);
  assert.equal(stats.templates, 31);
  assert.equal(stats.spawnGroups, 39);
  assert.equal(stats.declaredPopulation, 43);

  const resolver = createMoradonHeightResolver({ smdPath });
  const population = ws16.materializeNpcPopulation(doc, { heightAuthority: resolver });
  const world = new ws16.NpcWorld();
  for (const record of population.records) world.add(record);
  const nearby = world.nearbySnapshot(21, 312, 402);
  assert.ok(nearby.length > 0, 'expected real WS16 NPCs near Moradon player spawn');
  for (const record of nearby) {
    assert.equal(record.positionAuthority.status, 'authoritative');
    assert.ok(Number.isFinite(record.position.y));
    assert.doesNotThrow(() => canonicalNpcDetailRecord(record));
  }
  const region = buildRegionNpcIds(nearby);
  assert.equal(region[0], OPCODE.REGION_NPC_IDS);
  assert.equal(region.readInt16LE(1), nearby.length);
  const details = buildSurroundingNpcs(nearby.slice(0, Math.min(3, nearby.length)));
  assert.equal(details[0], OPCODE.REQUEST_NPC_IN);
  assert.equal(details.readInt16LE(1), Math.min(3, nearby.length));
});
