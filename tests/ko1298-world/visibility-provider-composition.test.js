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
  buildSurroundingNpcs,
  createMoradonHeightResolver,
  createSharedNpcRuntimeIdNamespace,
} = require('../../services/ko1298-world');

const ws16Root = process.env.WS14_WS16_PROVIDER_ROOT;
const ws25Root = process.env.WS14_WS25_PROVIDER_ROOT;
const npcDataPath = process.env.WS14_WS16_NPC_DATA;
const mobDataPath = process.env.WS14_WS25_MOB_DATA;
const smdPath = process.env.WS14_MORADON_SMD;
const hasPinnedProviders = Boolean(ws16Root && ws25Root && npcDataPath && mobDataPath && smdPath);
const providerTest = hasPinnedProviders ? test : test.skip;

function character() {
  return {
    accountId: 'ws14-provider', characterId: 'VisibilityProbe', nation: 1, race: 1, classId: 101,
    face: 0, hair: 0, rank: 0, title: 0, level: 1, points: 0, maxExp: 1, exp: 0,
    loyalty: 0, monthlyLoyalty: 0, city: 0, knightsId: 0, fame: 0,
    maxHp: 100, hp: 100, maxMp: 100, mp: 100, maxWeight: 1000, itemWeight: 0,
    str: 50, itemStr: 0, sta: 50, itemSta: 0, dex: 50, itemDex: 0,
    intel: 50, itemIntel: 0, cha: 50, itemCha: 0, totalHit: 1, totalAc: 1,
    fireRes: 0, coldRes: 0, lightningRes: 0, magicRes: 0, diseaseRes: 0, poisonRes: 0,
    gold: 0, authority: 0, direction: 0, skills: Array(9).fill(0),
    protocolItems: [], visibleEquipment: [],
  };
}

function phase(opcode, value) {
  return Buffer.from([opcode, value]);
}

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
  const ids = [];
  for (let index = 0; index < count; index += 1) ids.push(packet.readInt16LE(3 + index * 2));
  assert.equal(packet.length, 3 + count * 2);
  return ids;
}

providerTest('current WS25 MobVisibilityService composes with real WS16 NPCs in one shared KO1298_NPC runtime namespace', async () => {
  const ws16 = require(path.join(ws16Root, 'services/ko1298-npc'));
  const ws25 = require(path.join(ws25Root, 'services/ko1298-mobs'));

  assert.equal(typeof ws25.MobVisibilityService, 'function');
  assert.equal(typeof ws25.loadVerifiedWorldDefinition, 'function');

  const resolver = createMoradonHeightResolver({ smdPath });
  const npcDocument = JSON.parse(fs.readFileSync(npcDataPath, 'utf8'));
  const npcPopulation = ws16.materializeNpcPopulation(npcDocument, { heightAuthority: resolver });
  assert.ok(npcPopulation.records.length > 0, 'expected authoritative WS16 Moradon NPC records');

  const npcIds = npcPopulation.records.map((record) => record.runtimeId);
  assert.equal(new Set(npcIds).size, npcIds.length, 'WS16 NPC runtime IDs must be unique');

  const namespace = createSharedNpcRuntimeIdNamespace({
    minInclusive: ws25.RUNTIME_ID_CONTRACT.NPC_BAND,
    maxExclusive: ws25.RUNTIME_ID_CONTRACT.INVALID_BAND,
    reserved: npcPopulation.records,
  });

  const mobDocument = JSON.parse(fs.readFileSync(mobDataPath, 'utf8'));
  const worldDefinition = ws25.loadVerifiedWorldDefinition(mobDocument);
  const mobService = new ws25.MobVisibilityService(worldDefinition, {
    terrain: {
      resolveHeight(zoneId, x, z) {
        return resolver.resolveHeight(Number(zoneId), x, z);
      },
    },
    runtimeIds: namespace,
  });

  const mobs = mobService.initialize(0);
  assert.equal(mobs.length, 135);
  assert.equal(mobService.runtimeIdentityPolicy().ready, true);
  assert.equal(mobService.runtimeIdentityPolicy().claimed, 135);

  const mobIds = mobs.map((record) => record.runtimeId);
  assert.equal(new Set(mobIds).size, 135, 'WS25 mob runtime IDs must be unique');
  const npcIdSet = new Set(npcIds);
  assert.equal(mobIds.filter((id) => npcIdSet.has(id)).length, 0, 'NPC/mob shared namespace collision count must be zero');

  const namespaceState = namespace.snapshot();
  assert.equal(namespaceState.reserved, npcIds.length);
  assert.equal(namespaceState.claimed, 135);
  assert.equal(namespaceState.occupied, npcIds.length + 135);

  for (const mob of mobs) {
    assert.equal(mob.runtimeId, mob.instanceId);
    assert.equal(mob.runtimeId, mob.nid);
    assert.ok(Number.isFinite(mob.position.x));
    assert.ok(Number.isFinite(mob.position.y));
    assert.ok(Number.isFinite(mob.position.z));
    assert.equal(mob.heightAuthority.status, 'authoritative');
  }

  const repository = new MockWorldRepository({
    characters: [character()],
    npcs: npcPopulation.records,
  });
  let movementRegistrations = 0;
  const world = new WorldSessionService({
    repository,
    mobPort: mobService,
    movementPort: {
      registerSession() { movementRegistrations += 1; },
      disconnect() {},
    },
  });

  await world.beginSelectedCharacter({
    accountId: 'ws14-provider',
    characterId: 'VisibilityProbe',
    socketId: 414,
  });

  const loading = await world.handleClientPacket(414, phase(OPCODE.GAMESTART, GAMESTART_PHASE.LOADING));
  assert.equal(loading.state, WORLD_STATE.WAIT_GAMESTART_LOADED);

  const regionPacket = loading.clientPackets.find((packet) => packet[0] === OPCODE.REGION_NPC_IDS);
  assert.ok(regionPacket, 'expected unified WIZ_NPC_REGION packet');
  const unifiedIds = regionIds(regionPacket);
  const nearbyMobs = mobService.getNearby({ zoneId: 21, x: 312, z: 402 });
  assert.ok(nearbyMobs.length > 0, 'expected real nearby WS25 mobs at Moradon world bootstrap');
  assert.ok(unifiedIds.includes(npcPopulation.records[0].runtimeId), 'unified 0x1C must include WS16 NPC ID');
  assert.ok(unifiedIds.includes(nearbyMobs[0].runtimeId), 'unified 0x1C must include WS25 mob ID');

  const requestedNpc = npcPopulation.records[0];
  const requestedMob = nearbyMobs[0];
  const details = await world.handleClientPacket(
    414,
    detailRequest([requestedNpc.runtimeId, requestedMob.runtimeId]),
  );
  assert.deepEqual(details.clientPackets[0], buildSurroundingNpcs([requestedNpc, requestedMob]));

  const mobOut = world.consumeMobVisibilityEvent(414, requestedMob, { type: 'nearby-despawn' });
  assert.equal(mobOut.clientPackets[0][0], OPCODE.NPC_INOUT);
  assert.equal(mobOut.clientPackets[0][1], 0x02);
  const mobIn = world.consumeMobVisibilityEvent(414, requestedMob, { type: 'nearby-spawn' });
  assert.equal(mobIn.clientPackets[0][0], OPCODE.NPC_INOUT);
  assert.equal(mobIn.clientPackets[0][1], 0x01);

  const npcOut = world.leaveNpcVisibility(414, requestedNpc.runtimeId);
  assert.equal(npcOut.clientPackets[0][0], OPCODE.NPC_INOUT);
  assert.equal(npcOut.clientPackets[0][1], 0x02);
  const npcIn = world.enterNpcVisibility(414, requestedNpc);
  assert.equal(npcIn.clientPackets[0][0], OPCODE.NPC_INOUT);
  assert.equal(npcIn.clientPackets[0][1], 0x01);

  const ready = await world.handleClientPacket(414, phase(OPCODE.GAMESTART, GAMESTART_PHASE.LOADED));
  assert.equal(ready.state, WORLD_STATE.WORLD_READY);
  assert.equal(movementRegistrations, 1, 'movement regression: session registration should still occur at WORLD_READY');

  const disconnected = world.disconnect(414, 'WS14_PROVIDER_COMPOSITION_TEST');
  assert.equal(disconnected.disconnected, true);
  assert.equal(world.getSession(414), null);

  console.log('WS14_CURRENT_VISIBILITY_PROVIDER_COMPOSITION', JSON.stringify({
    npcRuntimeIds: npcIds.length,
    mobRuntimeIds: mobIds.length,
    crossDomainCollisions: 0,
    unifiedRegionIds: unifiedIds.length,
    nearbyMobs: nearbyMobs.length,
    worldReady: true,
    movementRegistrations,
  }));
});
