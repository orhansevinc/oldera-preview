'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  OPCODE,
  ZONE,
  WORLD_STATE,
  TRANSITION_REASON,
  MORADON_SPAWN,
  ZoneRegistry,
  createVerified1298ZoneRegistry,
  MockWorldRepository,
  WorldSessionService,
} = require('../../services/ko1298-world');

function character(overrides = {}) {
  return {
    accountId: 'account-a', characterId: 'Hero', nation: 1, race: 1, classId: 101, face: 0, hair: 0,
    rank: 0, title: 0, level: 1, points: 0, maxExp: 100, exp: 0, loyalty: 0, monthlyLoyalty: 0,
    city: 0, knightsId: 0, fame: 0, clan: null, maxHp: 100, hp: 100, maxMp: 50, mp: 50,
    maxWeight: 1000, itemWeight: 0, str: 60, itemStr: 0, sta: 60, itemSta: 0,
    dex: 60, itemDex: 0, intel: 60, itemIntel: 0, cha: 60, itemCha: 0,
    totalHit: 1, totalAc: 1, fireRes: 0, coldRes: 0, lightningRes: 0, magicRes: 0,
    diseaseRes: 0, poisonRes: 0, gold: 0, authority: 1, direction: 0,
    visibleEquipment: [], protocolItems: [], skills: Array(9).fill(0),
    ...overrides,
  };
}

function syntheticRegistry() {
  return new ZoneRegistry([
    {
      zoneId: ZONE.MORADON,
      name: 'Moradon',
      zoneType: 'NEUTRAL',
      mapRef: 'moradon_0826.smd',
      spawn: MORADON_SPAWN,
      entryStatus: 'PRODUCTION_READY',
      zoneAbility: { canTradeWithOtherNation: true, abilityType: 0, canTalkToOtherNation: true, tariff: 10 },
    },
    {
      zoneId: 90,
      name: 'Synthetic Zone B',
      zoneType: 'TEST',
      mapRef: 'synthetic-b.smd',
      spawn: { x: 50, z: 60, y: 7 },
      entryStatus: 'PRODUCTION_READY',
      zoneAbility: { canTradeWithOtherNation: false, abilityType: 1, canTalkToOtherNation: false, tariff: 20 },
    },
    {
      zoneId: 91,
      name: 'Synthetic Nation 2',
      zoneType: 'TEST',
      nationConstraint: 2,
      mapRef: 'synthetic-n2.smd',
      spawn: { x: 70, z: 80, y: 0 },
      entryStatus: 'PRODUCTION_READY',
      zoneAbility: { canTradeWithOtherNation: false, abilityType: 1, canTalkToOtherNation: false, tariff: 10 },
    },
  ]);
}

function phase(opcode, value) {
  return Buffer.from([opcode, value]);
}

async function makeReady(service, { accountId = 'account-a', characterId = 'Hero', socketId = 1 } = {}) {
  await service.beginSelectedCharacter({ accountId, characterId, socketId });
  await service.handleClientPacket(socketId, phase(OPCODE.GAMESTART, 1));
  return service.handleClientPacket(socketId, phase(OPCODE.GAMESTART, 2));
}

async function finishTransition(service, socketId) {
  const loading = await service.handleClientPacket(socketId, phase(OPCODE.ZONE_CHANGE, 1));
  const ready = await service.handleClientPacket(socketId, phase(OPCODE.ZONE_CHANGE, 2));
  return { loading, ready };
}

test('verified 1298 registry exposes 16 source-backed zone identities but fails closed on incomplete entry data', () => {
  const registry = createVerified1298ZoneRegistry();
  assert.equal(registry.list().length, 16);
  assert.equal(registry.requireProductionReady(ZONE.MORADON).mapRef, 'moradon_0826.smd');
  assert.deepEqual(registry.requireProductionReady(ZONE.MORADON).spawn, MORADON_SPAWN);
  assert.throws(() => registry.requireProductionReady(ZONE.KARUS), /not production-ready/);
  assert.throws(() => registry.requireProductionReady(ZONE.BIFROST), /not production-ready/);
  assert.throws(() => registry.requireProductionReady(ZONE.CAITHAROS_ARENA), /not production-ready/);
  assert.throws(() => registry.requireKnown(250), /unknown zone 250; fail closed/);
});

test('generic production-ready zone entry uses data-driven zone definition and runtime membership', async () => {
  const c = character();
  const registry = syntheticRegistry();
  const service = new WorldSessionService({
    repository: new MockWorldRepository({ characters: [c] }),
    zoneRegistry: registry,
  });
  const started = await service.beginWorldEntry({
    accountId: c.accountId,
    characterId: c.characterId,
    socketId: 10,
    zoneId: 90,
  });
  assert.equal(started.clientPackets[0][2], 90);
  const loading = await service.handleClientPacket(10, phase(OPCODE.GAMESTART, 1));
  assert.deepEqual(loading.clientPackets.map((p) => p[0]), [0x0e, 0x5e, 0x15, 0x1c, 0x0d]);
  await service.handleClientPacket(10, phase(OPCODE.GAMESTART, 2));
  assert.equal(service.getSession(10).state, WORLD_STATE.WORLD_READY);
  assert.equal(service.getSession(10).zoneId, 90);
  assert.equal(registry.runtime(90).has(10), true);
});

test('Moradon regression keeps exact select and same-zone teleport packet bytes', async () => {
  const c = character();
  const service = new WorldSessionService({ repository: new MockWorldRepository({ characters: [c] }) });
  const started = await service.beginSelectedCharacter({ accountId: c.accountId, characterId: c.characterId, socketId: 11 });
  assert.equal(started.clientPackets[0].toString('hex'), '040115300cb40f000000');
  await service.handleClientPacket(11, phase(OPCODE.GAMESTART, 1));
  await service.handleClientPacket(11, phase(OPCODE.GAMESTART, 2));
  const change = service.beginMoradonZoneChange(11);
  assert.equal(change.state, WORLD_STATE.ZONE_CHANGE_WAIT_LOADING);
  assert.deepEqual(change.clientPackets.map((p) => p.toString('hex')), ['27031500300cb40f000000']);
  const loading = await service.handleClientPacket(11, phase(OPCODE.ZONE_CHANGE, 1));
  assert.equal(loading.state, WORLD_STATE.ZONE_CHANGE_WAIT_LOADED);
  assert.deepEqual(loading.clientPackets.map((p) => p.toString('hex')), ['150000', '1c0000', '2702']);
});

test('wrong-nation entry hook rejects before world placement', async () => {
  const c = character({ nation: 1 });
  const service = new WorldSessionService({
    repository: new MockWorldRepository({ characters: [c] }),
    zoneRegistry: syntheticRegistry(),
  });
  await assert.rejects(
    service.beginWorldEntry({ accountId: c.accountId, characterId: c.characterId, socketId: 12, zoneId: 91 }),
    /nation 1 cannot enter zone 91/,
  );
});

test('invalid or unknown target zone is rejected without mutating the ready session', async () => {
  const c = character();
  const service = new WorldSessionService({
    repository: new MockWorldRepository({ characters: [c] }),
    zoneRegistry: syntheticRegistry(),
  });
  await makeReady(service, { socketId: 13 });
  assert.throws(() => service.requestZoneChange({ socketId: 13, targetZoneId: 250 }), /unknown zone 250/);
  assert.deepEqual(service.getSession(13), {
    accountId: 'account-a', characterId: 'Hero', socketId: 13, zoneId: 21,
    x: 312, z: 402, y: 0, state: WORLD_STATE.WORLD_READY,
    capabilities: { movement: true, combat: true }, transition: null,
  });
});

test('second concurrent zone request is deterministically rejected', async () => {
  const c = character();
  const service = new WorldSessionService({
    repository: new MockWorldRepository({ characters: [c] }),
    zoneRegistry: syntheticRegistry(),
  });
  await makeReady(service, { socketId: 14 });
  service.requestZoneChange({ socketId: 14, targetZoneId: 90 });
  assert.throws(
    () => service.requestZoneChange({ socketId: 14, targetZoneId: ZONE.MORADON }),
    /zone change already in progress/,
  );
});

test('disconnect in TELEPORT state cleans source/target membership and movement state', async () => {
  const c = character();
  const registry = syntheticRegistry();
  const disconnected = [];
  const service = new WorldSessionService({
    repository: new MockWorldRepository({ characters: [c] }),
    zoneRegistry: registry,
    movementPort: { disconnect: (sessionId) => disconnected.push(sessionId) },
  });
  await makeReady(service, { socketId: 15 });
  service.requestZoneChange({ socketId: 15, targetZoneId: 90 });
  assert.equal(registry.runtime(21).has(15), false);
  assert.equal(registry.runtime(90).has(15), false);
  const outcome = service.disconnect(15, 'TEST_DISCONNECT');
  assert.equal(outcome.disconnected, true);
  assert.equal(service.getSession(15), null);
  assert.equal(registry.runtime(21).has(15), false);
  assert.equal(registry.runtime(90).has(15), false);
  assert.deepEqual(disconnected, [15]);
  assert.equal(service.getAuditTrail(15).at(-1).state, 'DISCONNECTED');
});

test('target load failure rolls back source membership, authoritative position and movement baseline', async () => {
  const c = character();
  const base = new MockWorldRepository({ characters: [c] });
  const repository = {
    getCharacterForWorld: (...args) => base.getCharacterForWorld(...args),
    getSurroundingNpcs: (...args) => base.getSurroundingNpcs(...args),
    async getSurroundingUsers(query) {
      if (query.zoneId === 90) throw new Error('synthetic target load failure');
      return base.getSurroundingUsers(query);
    },
  };
  const registry = syntheticRegistry();
  const teleports = [];
  const service = new WorldSessionService({
    repository,
    zoneRegistry: registry,
    movementPort: {
      registerSession() {},
      teleport(sessionId, request) { teleports.push({ sessionId, ...request }); },
    },
  });
  await makeReady(service, { socketId: 16 });
  service.requestZoneChange({ socketId: 16, targetZoneId: 90 });
  let thrown;
  try {
    await service.handleClientPacket(16, phase(OPCODE.ZONE_CHANGE, 1));
  } catch (error) {
    thrown = error;
  }
  assert.match(thrown.message, /synthetic target load failure/);
  assert.equal(thrown.rollbackOutcome.rolledBack, true);
  assert.equal(thrown.rollbackOutcome.clientPackets[0][2], ZONE.MORADON);
  assert.equal(service.getSession(16).zoneId, ZONE.MORADON);
  assert.equal(service.getSession(16).state, WORLD_STATE.WORLD_READY);
  assert.equal(registry.runtime(ZONE.MORADON).has(16), true);
  assert.equal(registry.runtime(90).has(16), false);
  assert.deepEqual(teleports.map((t) => [t.zoneId, t.reason]), [[90, 'TELEPORT'], [21, 'ROLLBACK']]);
});

test('WS15 teleport adapter resets movement baseline only after target LOADING is accepted', async () => {
  const c = character({ direction: 321 });
  const calls = [];
  const service = new WorldSessionService({
    repository: new MockWorldRepository({ characters: [c] }),
    zoneRegistry: syntheticRegistry(),
    movementPort: {
      registerSession() {},
      teleport(sessionId, request) { calls.push({ sessionId, request }); },
    },
  });
  await makeReady(service, { socketId: 17 });
  service.requestZoneChange({ socketId: 17, targetZoneId: 90, reason: TRANSITION_REASON.GATE });
  assert.equal(calls.length, 0);
  await service.handleClientPacket(17, phase(OPCODE.ZONE_CHANGE, 1));
  assert.deepEqual(calls, [{
    sessionId: 17,
    request: { zoneId: 90, position: { x: 50, z: 60, y: 7 }, headingRaw: 321, reason: 'GATE' },
  }]);
});

test('nearby bootstrap ordering is users then NPCs then mob adapter, before LOADED ack', async () => {
  const c = character();
  const nearbyUser = character({ accountId: 'other', characterId: 'Other', socketId: 55, zoneId: 90, x: 51, z: 61, y: 7, nation: 2 });
  const nearbyNpc = {
    nid: 10001, pid: 12000, zoneId: 90, npcType: 0, sellingGroup: 0, size: 100,
    weapon1: 0, weapon2: 0, name: 'Npc', group: 0, level: 1, x: 52, z: 62, y: 7,
    gateOpen: 1, objectType: 0,
  };
  const service = new WorldSessionService({
    repository: new MockWorldRepository({ characters: [c], users: [nearbyUser], npcs: [nearbyNpc] }),
    zoneRegistry: syntheticRegistry(),
    mobPort: { getNearby: ({ zoneId }) => zoneId === 90 ? [{ instanceId: 70001 }] : [] },
    bootstrapPort: { buildMobBootstrap: ({ mobs }) => mobs.length ? [Buffer.from([0xaa, mobs.length])] : [] },
  });
  await makeReady(service, { socketId: 18 });
  service.requestZoneChange({ socketId: 18, targetZoneId: 90 });
  const loading = await service.handleClientPacket(18, phase(OPCODE.ZONE_CHANGE, 1));
  assert.deepEqual(loading.bootstrapStages, ['USERS', 'NPCS', 'MOBS']);
  assert.deepEqual(loading.clientPackets.map((p) => p[0]), [0x15, 0x1c, 0xaa, 0x27]);
  assert.equal(loading.clientPackets[0].readUInt16LE(1), 1);
  assert.equal(loading.clientPackets[1].readUInt16LE(1), 1);
});

test('stale-region cleanup and source leave happen before target membership is added', async () => {
  const c = character();
  const nearbyUser = character({ accountId: 'u', characterId: 'U', socketId: 88, zoneId: 21, x: 313, z: 403 });
  const nearbyNpc = { nid: 10001, pid: 1, zoneId: 21, npcType: 0, size: 100, name: 'N', x: 314, z: 404, y: 0 };
  const registry = syntheticRegistry();
  const events = [];
  const service = new WorldSessionService({
    repository: new MockWorldRepository({ characters: [c], users: [nearbyUser], npcs: [nearbyNpc] }),
    zoneRegistry: registry,
    lifecycle: {
      onClientRegionReset: (value) => events.push(['client-reset', value.userIds, value.npcIds]),
      onSourceLeave: () => events.push(['source-leave']),
    },
    regionPort: {
      subscribe: ({ zoneId }) => events.push(['subscribe', zoneId]),
      unsubscribe: ({ zoneId }) => events.push(['unsubscribe', zoneId]),
    },
  });
  await makeReady(service, { socketId: 19 });
  events.length = 0;
  const requested = service.requestZoneChange({ socketId: 19, targetZoneId: 90 });
  assert.deepEqual(requested.clientEntityCleanup.userIds, [88]);
  assert.deepEqual(requested.clientEntityCleanup.npcIds, [10001]);
  assert.deepEqual(events, [
    ['client-reset', [88], [10001]],
    ['unsubscribe', 21],
    ['source-leave'],
  ]);
  assert.equal(registry.runtime(21).has(19), false);
  assert.equal(registry.runtime(90).has(19), false);
  await service.handleClientPacket(19, phase(OPCODE.ZONE_CHANGE, 1));
  assert.equal(registry.runtime(90).has(19), true);
});

test('reconnect restores only repository-authoritative zone/position through fail-closed registry', async () => {
  const c = character();
  const repository = new MockWorldRepository({
    characters: [c],
    worldStates: [{ accountId: c.accountId, characterId: c.characterId, zoneId: 90, x: 52, z: 62, y: 8 }],
  });
  const service = new WorldSessionService({ repository, zoneRegistry: syntheticRegistry() });
  const restored = await service.restoreAuthoritativeSession({ accountId: c.accountId, characterId: c.characterId, socketId: 20 });
  assert.equal(restored.clientPackets[0][2], 90);
  assert.deepEqual([restored.snapshot.x, restored.snapshot.z, restored.snapshot.y], [52, 62, 8]);

  repository.setAuthoritativeWorldState({ accountId: c.accountId, characterId: c.characterId, zoneId: 250, x: 1, z: 1, y: 0 });
  await assert.rejects(
    service.restoreAuthoritativeSession({ accountId: c.accountId, characterId: c.characterId, socketId: 21 }),
    /unknown zone 250; fail closed/,
  );
});

test('repeated A -> B -> A transitions preserve one authoritative membership', async () => {
  const c = character();
  const registry = syntheticRegistry();
  const service = new WorldSessionService({
    repository: new MockWorldRepository({ characters: [c] }),
    zoneRegistry: registry,
  });
  await makeReady(service, { socketId: 22 });
  const toB = service.requestZoneChange({ socketId: 22, targetZoneId: 90, reason: TRANSITION_REASON.WARP });
  assert.deepEqual(toB.clientPackets.map((p) => p[0]), [0x5e, 0x27]);
  await finishTransition(service, 22);
  assert.equal(service.getSession(22).zoneId, 90);
  const toA = service.requestZoneChange({ socketId: 22, targetZoneId: ZONE.MORADON, reason: TRANSITION_REASON.GATE });
  assert.deepEqual(toA.clientPackets.map((p) => p[0]), [0x5e, 0x27]);
  await finishTransition(service, 22);
  assert.equal(service.getSession(22).zoneId, ZONE.MORADON);
  assert.equal(registry.runtime(ZONE.MORADON).has(22), true);
  assert.equal(registry.runtime(90).has(22), false);
});

test('malformed transition packet is rejected without corrupting pending TELEPORT state', async () => {
  const c = character();
  const service = new WorldSessionService({
    repository: new MockWorldRepository({ characters: [c] }),
    zoneRegistry: syntheticRegistry(),
  });
  await makeReady(service, { socketId: 23 });
  service.requestZoneChange({ socketId: 23, targetZoneId: 90 });
  await assert.rejects(
    service.handleClientPacket(23, Buffer.from([OPCODE.ZONE_CHANGE, 1, 0xff])),
    /must be exactly/,
  );
  assert.equal(service.getSession(23).state, WORLD_STATE.TELEPORT);
  assert.equal(service.getSession(23).zoneId, ZONE.MORADON);
});

test('movement and combat capability stays disabled until WORLD_READY on both entry and transition', async () => {
  const c = character();
  const service = new WorldSessionService({
    repository: new MockWorldRepository({ characters: [c] }),
    zoneRegistry: syntheticRegistry(),
  });
  await service.beginSelectedCharacter({ accountId: c.accountId, characterId: c.characterId, socketId: 24 });
  assert.deepEqual(service.getCapabilities(24), { movement: false, combat: false });
  await service.handleClientPacket(24, phase(OPCODE.GAMESTART, 1));
  assert.deepEqual(service.getCapabilities(24), { movement: false, combat: false });
  await service.handleClientPacket(24, phase(OPCODE.GAMESTART, 2));
  assert.deepEqual(service.getCapabilities(24), { movement: true, combat: true });
  service.requestZoneChange({ socketId: 24, targetZoneId: 90 });
  assert.deepEqual(service.getCapabilities(24), { movement: false, combat: false });
  await service.handleClientPacket(24, phase(OPCODE.ZONE_CHANGE, 1));
  assert.deepEqual(service.getCapabilities(24), { movement: false, combat: false });
  await service.handleClientPacket(24, phase(OPCODE.ZONE_CHANGE, 2));
  assert.deepEqual(service.getCapabilities(24), { movement: true, combat: true });
});

test('WS27 world reposition contract preserves warp/gate/teleport/respawn intent without conflating packet paths', async () => {
  const c = character();
  const service = new WorldSessionService({
    repository: new MockWorldRepository({ characters: [c] }),
    zoneRegistry: syntheticRegistry(),
  });
  await makeReady(service, { socketId: 25 });
  for (const reason of Object.values(TRANSITION_REASON)) {
    const sameZone = service.planWorldReposition({
      socketId: 25,
      targetZoneId: ZONE.MORADON,
      position: { x: 320, z: 410, y: 0 },
      reason,
    });
    assert.equal(sameZone.kind, 'IN_ZONE_REPOSITION');
    assert.equal(sameZone.reason, reason);
  }
  const crossZone = service.planWorldReposition({ socketId: 25, targetZoneId: 90, reason: TRANSITION_REASON.RESPAWN });
  assert.equal(crossZone.kind, 'ZONE_TRANSITION');
  assert.equal(crossZone.reason, 'RESPAWN');
});

test('audit trail records the complete requested -> authorized -> leave -> teleport -> loading -> loaded -> ready state machine', async () => {
  const c = character();
  const service = new WorldSessionService({
    repository: new MockWorldRepository({ characters: [c] }),
    zoneRegistry: syntheticRegistry(),
  });
  await makeReady(service, { socketId: 26 });
  service.requestZoneChange({ socketId: 26, targetZoneId: 90 });
  await finishTransition(service, 26);
  const states = service.getAuditTrail(26).map((e) => e.state);
  const expected = ['REQUESTED', 'AUTHORIZED', 'LEAVING_SOURCE', 'TELEPORT', 'LOADING', 'LOADED', 'WORLD_READY'];
  let cursor = -1;
  for (const state of expected) {
    cursor = states.indexOf(state, cursor + 1);
    assert.notEqual(cursor, -1, `missing audit state ${state}`);
  }
  const sequences = service.getAuditTrail(26).map((e) => e.sequence);
  assert.deepEqual(sequences, [...sequences].sort((a, b) => a - b));
});

test('synthetic load: 120 sessions deterministically transition Moradon -> B -> Moradon with no membership leak', async () => {
  const count = 120;
  const characters = Array.from({ length: count }, (_, i) => character({
    accountId: `account-${i}`,
    characterId: `Hero${i}`,
  }));
  const registry = syntheticRegistry();
  const service = new WorldSessionService({
    repository: new MockWorldRepository({ characters }),
    zoneRegistry: registry,
    auditLimit: 64,
  });

  for (let i = 0; i < count; i += 1) {
    await makeReady(service, { accountId: `account-${i}`, characterId: `Hero${i}`, socketId: 1000 + i });
  }
  assert.equal(registry.runtime(ZONE.MORADON).size, count);

  for (let i = 0; i < count; i += 1) {
    const socketId = 1000 + i;
    service.requestZoneChange({ socketId, targetZoneId: 90, reason: TRANSITION_REASON.TELEPORT });
    await finishTransition(service, socketId);
  }
  assert.equal(registry.runtime(ZONE.MORADON).size, 0);
  assert.equal(registry.runtime(90).size, count);

  for (let i = 0; i < count; i += 1) {
    const socketId = 1000 + i;
    service.requestZoneChange({ socketId, targetZoneId: ZONE.MORADON, reason: TRANSITION_REASON.WARP });
    await finishTransition(service, socketId);
    assert.equal(service.getSession(socketId).state, WORLD_STATE.WORLD_READY);
    assert.equal(service.getSession(socketId).zoneId, ZONE.MORADON);
  }
  assert.equal(registry.runtime(ZONE.MORADON).size, count);
  assert.equal(registry.runtime(90).size, 0);
});
