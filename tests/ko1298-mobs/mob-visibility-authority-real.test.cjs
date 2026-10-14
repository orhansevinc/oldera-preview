'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const moradonVerified = require('../../world-data/mobs/verified/moradon-zone21.verified.json');
const {
  MobService,
  loadVerifiedWorldDefinition,
  RUNTIME_ID_CONTRACT,
} = require('../../services/ko1298-mobs');

const ws14ModulePath = process.env.WS25_WS14_WORLD_MODULE;
const smdPath = process.env.WS25_MORADON_SMD;
const ws11Root = process.env.WS25_WS11_ROOT;
const hasAuthorities = Boolean(ws14ModulePath && smdPath && ws11Root);
const authorityTest = hasAuthorities ? test : test.skip;

function createSharedRuntimeAllocator(reservedIds = []) {
  const occupied = new Set(reservedIds);
  const bySource = new Map();
  let next = RUNTIME_ID_CONTRACT.NPC_BAND;
  return Object.freeze({
    claim(request) {
      if (bySource.has(request.sourceIdentity)) return bySource.get(request.sourceIdentity);
      while (occupied.has(next)) next += 1;
      if (next >= RUNTIME_ID_CONTRACT.INVALID_BAND || next > RUNTIME_ID_CONTRACT.I16_MAX) {
        throw new RangeError('test shared KO1298_NPC namespace exhausted');
      }
      const id = next;
      next += 1;
      occupied.add(id);
      bySource.set(request.sourceIdentity, id);
      return id;
    },
  });
}

function characterFixture() {
  return Object.freeze({
    accountId: 'acct-ws25', characterId: 'MobProbe', nation: 1, race: 1, classId: 101,
    face: 1, hair: 1, rank: 0, title: 0, level: 1, points: 0,
    maxExp: 100, exp: 0, loyalty: 0, city: 0, knightsId: 0, fame: 0,
    maxHp: 100, hp: 100, maxMp: 100, mp: 100, maxWeight: 1000, itemWeight: 0,
    str: 50, itemStr: 0, sta: 50, itemSta: 0, dex: 50, itemDex: 0,
    intel: 50, itemIntel: 0, cha: 50, itemCha: 0, totalHit: 1, totalAc: 1,
    fireRes: 0, coldRes: 0, lightningRes: 0, magicRes: 0, diseaseRes: 0, poisonRes: 0,
    gold: 0, authority: 0, direction: 0, isPartyLeader: false, invisibilityState: 0,
    isChicken: false, protocolItems: [], skills: [], visibleEquipment: [],
  });
}

function decodeWs11MonsterGolden() {
  const tools = path.join(ws11Root, 'tools', 'ws11_protocol');
  const fixture = path.join(ws11Root, 'protocol-lab', 'visibility-fixtures', 'monster_in_spawn.bin');
  const script = [
    'import json,sys',
    `sys.path.insert(0, ${JSON.stringify(tools)})`,
    'from visibility import decode_visibility_payload',
    `raw=open(${JSON.stringify(fixture)},'rb').read()`,
    "n=int.from_bytes(raw[2:4],'little')",
    "decoded=decode_visibility_payload(raw[4:4+n],'S2C')",
    'print(json.dumps(decoded["record"],sort_keys=True))',
  ].join(';');
  return JSON.parse(execFileSync('python3', ['-c', script], { encoding: 'utf8' }));
}

authorityTest('real Moradon mob visibility has shared integer IDs, exact detail semantics and WS14 consumer compatibility', async () => {
  const ws14 = require(path.resolve(ws14ModulePath));
  const { WorldSessionService } = require(path.join(path.resolve(ws14ModulePath), 'src', 'world-session-service.js'));
  const resolver = ws14.createMoradonHeightResolver({ smdPath });
  const world = loadVerifiedWorldDefinition(moradonVerified);
  const reservedNpcRuntimeIds = Array.from({ length: 43 }, (_, i) => 10000 + i);
  const visibilityEvents = [];
  const allocator = createSharedRuntimeAllocator(reservedNpcRuntimeIds);
  const service = new MobService(world, {
    terrain: { resolveHeight: (zoneId, x, z) => resolver.resolveHeight(zoneId, x, z) },
    runtimeIds: allocator,
    visibility: { onEvent: (event) => visibilityEvents.push(event) },
  });

  const mobs = service.initialize(0);
  assert.equal(mobs.length, 135);
  assert.equal(service.runtimeIdentityPolicy().claimed, 135);
  assert.equal(service.runtimeIdentityPolicy().sourceIdentityPreserved, true);

  const runtimeIds = mobs.map((mob) => mob.runtimeId);
  assert.equal(new Set(runtimeIds).size, 135);
  for (const id of runtimeIds) {
    assert.ok(Number.isInteger(id));
    assert.ok(id >= 10000 && id < 30000 && id <= 0x7fff);
    assert.equal(reservedNpcRuntimeIds.includes(id), false, `mob runtime id ${id} collided with reserved NPC namespace`);
  }
  assert.equal(runtimeIds[0], 10043);
  assert.equal(visibilityEvents.filter((event) => event.scope === 'world' && event.type === 'IN').length, 135);

  const first = mobs[0];
  const detail = service.detailSnapshot(first.id);
  assert.equal(detail.runtime_id, first.runtimeId);
  assert.equal(detail.template_resource_id, 700);
  assert.equal(detail.pid, 700);
  assert.equal(detail.npc_type, 0);
  assert.equal(detail.selling_group, 0);
  assert.equal(detail.scale, 120);
  assert.equal(detail.weapon_1, 0);
  assert.equal(detail.weapon_2, 0);
  assert.equal(detail.name, 'Worm');
  assert.equal(detail.group_nation, 0);
  assert.equal(detail.level, 1);
  assert.equal(detail.x, first.position.x);
  assert.equal(detail.y, first.position.y);
  assert.equal(detail.z, first.position.z);
  assert.equal(first.heightAuthority.status, 'authoritative');
  assert.equal(detail.state_gate_open, 0);
  assert.equal(detail.object_type, 0);
  assert.equal(detail.idk0, 0);
  assert.equal(detail.idk1, 0);
  assert.equal(detail.direction, 0);

  const requestedFields = [
    'runtime_id', 'template_resource_id', 'npc_type', 'selling_group', 'scale', 'weapon_1', 'weapon_2',
    'name', 'group_nation', 'level', 'x', 'y', 'z', 'state_gate_open', 'object_type', 'idk0', 'idk1', 'direction',
  ];
  for (const field of requestedFields) assert.ok(Object.hasOwn(detail, field), `missing semantic detail field ${field}`);

  const profile = JSON.parse(fs.readFileSync(path.join(ws11Root, 'protocol-lab', 'VISIBILITY_PROTOCOL_PROFILE.json'), 'utf8'));
  assert.equal(profile.npc_detail_record.status, 'VERIFIED');
  assert.equal(profile.monster_visibility.status, 'VERIFIED');
  const golden = decodeWs11MonsterGolden();
  // WS11 golden values are deterministic representatives, not Moradon source data.
  // Compare exact semantic constants/shape only; source-backed pid/scale/XYZ/gate values must remain real-provider values.
  assert.equal(golden.npc_type, detail.npc_type);
  assert.equal(golden.selling_group, detail.selling_group);
  assert.equal(golden.weapon_1_item_id, detail.weapon_1);
  assert.equal(golden.weapon_2_item_id, detail.weapon_2);
  assert.equal(golden.name, detail.name);
  assert.equal(golden.group_nation, detail.group_nation);
  assert.equal(golden.level, detail.level);
  assert.equal(golden.object_type, detail.object_type);
  assert.equal(golden.client_idk0, detail.idk0);
  assert.equal(golden.client_idk1, detail.idk1);
  assert.equal(golden.direction, detail.direction);
  assert.notEqual(golden.template_resource_id, detail.template_resource_id, 'representative WS11 pid must not overwrite real K_MONSTER sPid');
  assert.notEqual(golden.scale_percent, detail.scale, 'representative WS11 scale must not overwrite real K_MONSTER sSize');
  assert.notEqual(golden.state_gate_open, detail.state_gate_open, 'representative WS11 gate value must not overwrite AI normal-monster state');

  const firstPosition = first.position;
  const bootstrapSeen = [];
  const character = characterFixture();
  const worldService = new WorldSessionService({
    repository: {
      async getCharacterForWorld(accountId, characterId) {
        return { ...character, accountId, characterId };
      },
      async getSurroundingUsers() { return []; },
      async getSurroundingNpcs() { return []; },
    },
    mobPort: service,
    bootstrapPort: {
      async buildMobBootstrap({ mobs: nearby }) {
        bootstrapSeen.push(...nearby);
        return [];
      },
    },
    regionPort: { subscribe() {}, unsubscribe() {} },
  });

  await worldService.beginWorldEntry({
    accountId: character.accountId,
    characterId: character.characterId,
    socketId: 42,
    zoneId: 21,
    position: firstPosition,
  });
  await worldService.handleClientPacket(42, Buffer.from([0x0d, 0x01]));
  assert.ok(bootstrapSeen.length > 0, 'WS14 should consume at least one nearby real mob');
  for (const mob of bootstrapSeen) {
    assert.ok(Number.isInteger(mob.instanceId));
    assert.equal(mob.runtimeId, mob.instanceId);
    assert.ok(Number.isFinite(mob.detail.y));
    assert.equal(mob.detail.runtime_id, mob.instanceId);
  }

  const beforeRespawnId = first.runtimeId;
  service.applyHealth(first.id, 0, 100);
  service.tick(100);
  service.tick(30100);
  const outs = visibilityEvents.filter((event) => event.scope === 'world' && event.type === 'OUT' && event.runtimeId === beforeRespawnId);
  assert.equal(outs.length, 1);
  service.tick(30101);
  const respawned = service.get(first.id);
  assert.equal(respawned.runtimeId, beforeRespawnId);
  assert.equal(respawned.spawnEpoch, 1);
  const respawnIns = visibilityEvents.filter((event) => event.scope === 'world' && event.type === 'IN' && event.runtimeId === beforeRespawnId && event.reason === 'respawn');
  assert.equal(respawnIns.length, 1);

  const serviceAgain = new MobService(world, {
    terrain: { resolveHeight: (zoneId, x, z) => resolver.resolveHeight(zoneId, x, z) },
    runtimeIds: createSharedRuntimeAllocator(reservedNpcRuntimeIds),
  });
  const idsAgain = serviceAgain.initialize(0).map((mob) => mob.runtimeId);
  assert.deepEqual(idsAgain, runtimeIds, 'stable source order + stable shared reservations must reproduce runtime IDs');

  assert.throws(() => new MobService(world, {
    runtimeIds: { claim: () => 10043 },
  }), /duplicate id 10043/);

  console.log('WS25_MORADON_VISIBILITY', JSON.stringify({
    mobs: mobs.length,
    runtimeIds: { min: Math.min(...runtimeIds), max: Math.max(...runtimeIds), unique: new Set(runtimeIds).size },
    reservedNpcIds: reservedNpcRuntimeIds.length,
    ws11Provider: process.env.WS25_WS11_PROVIDER_SHA ?? null,
    ws14Provider: process.env.WS25_WS14_PROVIDER_SHA ?? null,
    ws14BootstrapMobs: bootstrapSeen.length,
    detail: {
      pid: detail.template_resource_id,
      scale: detail.scale,
      y: detail.y,
      stateGateOpen: detail.state_gate_open,
    },
    respawnRuntimeIdStable: respawned.runtimeId === beforeRespawnId,
  }));
});
