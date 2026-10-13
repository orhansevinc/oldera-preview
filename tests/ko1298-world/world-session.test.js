'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  OPCODE,
  USER_INOUT,
  GAMESTART_PHASE,
  ZONE_CHANGE_PHASE,
  ZONE,
  MORADON_SPAWN,
  WORLD_STATE,
  MYINFO_ITEM_RECORDS,
  buildCharacterSelectSuccess,
  buildGameStartAck,
  buildZoneChangeTeleport,
  buildZoneChangeLoadedAck,
  buildMoradonZoneAbility,
  buildMyInfo,
  buildRegionUserIds,
  buildRegionNpcIds,
  buildSurroundingUsers,
  buildSurroundingNpcs,
  parseGameStart,
  parseZoneChangePhase,
  MockWorldRepository,
  WorldSessionService,
} = require('../../services/ko1298-world');

function fixtureCharacter(overrides = {}) {
  return {
    accountId: 'account-a',
    characterId: 'TestHero',
    nation: 1,
    race: 1,
    classId: 101,
    face: 2,
    hair: 3,
    rank: 0,
    title: 0,
    level: 1,
    points: 0,
    maxExp: 100,
    exp: 0,
    loyalty: 0,
    monthlyLoyalty: 0,
    city: 0,
    knightsId: 0,
    fame: 0,
    clan: null,
    maxHp: 120,
    hp: 120,
    maxMp: 80,
    mp: 80,
    maxWeight: 2500,
    itemWeight: 0,
    str: 60,
    itemStr: 0,
    sta: 60,
    itemSta: 0,
    dex: 60,
    itemDex: 0,
    intel: 60,
    itemIntel: 0,
    cha: 60,
    itemCha: 0,
    totalHit: 10,
    totalAc: 5,
    fireRes: 0,
    coldRes: 0,
    lightningRes: 0,
    magicRes: 0,
    diseaseRes: 0,
    poisonRes: 0,
    gold: 0,
    authority: 1,
    knightsRank: 0,
    personalRank: 0,
    skills: Array(9).fill(0),
    protocolItems: [],
    visibleEquipment: [],
    accountStatus: 0,
    premiumType: 0,
    premiumTime: 0,
    isChicken: false,
    mannerPoint: 0,
    resHpType: 1,
    abnormalType: 1,
    needParty: 1,
    isPartyLeader: false,
    invisibilityState: 0,
    direction: 0,
    ...overrides,
  };
}

function phasePacket(opcode, phase) {
  return Buffer.from([opcode, phase]);
}

function idRequest(opcode, ids) {
  const b = Buffer.alloc(3 + ids.length * 2);
  b[0] = opcode;
  b.writeUInt16LE(ids.length, 1);
  ids.forEach((id, i) => b.writeUInt16LE(id, 3 + i * 2));
  return b;
}

function skipString1(packet, offset, expected) {
  const len = packet[offset];
  offset += 1;
  const text = packet.subarray(offset, offset + len).toString('latin1');
  if (expected !== undefined) assert.equal(text, expected);
  return offset + len;
}

test('Moradon constants are locked to zone 21 and verified 312/402/0 spawn', () => {
  assert.equal(ZONE.MORADON, 21);
  assert.deepEqual(MORADON_SPAWN, { x: 312, z: 402, y: 0 });
});

test('character-select success packet matches 1298 client parser layout', () => {
  const packet = buildCharacterSelectSuccess({ zoneId: ZONE.MORADON, ...MORADON_SPAWN, victoryNation: 0 });
  assert.equal(packet.toString('hex'), '040115300cb40f000000');
});

test('1298 GAMESTART is two-phase and server acknowledgement is opcode-only', () => {
  assert.deepEqual(parseGameStart(phasePacket(OPCODE.GAMESTART, GAMESTART_PHASE.LOADING)), { phase: 1 });
  assert.deepEqual(parseGameStart(phasePacket(OPCODE.GAMESTART, GAMESTART_PHASE.LOADED)), { phase: 2 });
  assert.equal(buildGameStartAck().toString('hex'), '0d');
  assert.throws(() => parseGameStart(Buffer.from([0x0d, 1, 0])), /exactly/);
  assert.throws(() => parseGameStart(Buffer.from([0x0d, 3])), /unsupported/);
});

test('1298 zone-change TELEPORT packet and LOADED acknowledgement are exact', () => {
  const packet = buildZoneChangeTeleport({ zoneId: ZONE.MORADON, ...MORADON_SPAWN, victoryNation: 0 });
  assert.equal(packet.toString('hex'), '27031500300cb40f000000');
  assert.equal(buildZoneChangeLoadedAck().toString('hex'), '2702');
  assert.deepEqual(parseZoneChangePhase(Buffer.from([0x27, 1])), { phase: ZONE_CHANGE_PHASE.LOADING });
  assert.deepEqual(parseZoneChangePhase(Buffer.from([0x27, 2])), { phase: ZONE_CHANGE_PHASE.LOADED });
});

test('Moradon zone ability packet matches 1298 neutral cross-nation trade/chat values', () => {
  assert.equal(buildMoradonZoneAbility().toString('hex'), '5e010100010a00');
});

test('MYINFO uses 1298 SetString1, monthly loyalty, 42 eleven-byte item records and premium tail', () => {
  const character = fixtureCharacter();
  const session = { socketId: 321, ...MORADON_SPAWN };
  const packet = buildMyInfo(character, session);
  let o = 0;
  assert.equal(packet[o++], OPCODE.MYINFO);
  assert.equal(packet.readUInt16LE(o), 321); o += 2;
  o = skipString1(packet, o, 'TestHero');
  assert.equal(packet.readUInt16LE(o), 3120); o += 2;
  assert.equal(packet.readUInt16LE(o), 4020); o += 2;
  assert.equal(packet.readInt16LE(o), 0); o += 2;
  assert.equal(packet[o++], 1); // nation
  assert.equal(packet[o++], 1); // race
  assert.equal(packet.readUInt16LE(o), 101); o += 2;
  o += 6; // face, hair, rank, title, level, points
  o += 4 + 4 + 4;
  assert.equal(packet.readUInt32LE(o), 0); o += 4; // monthly loyalty
  o += 1 + 2 + 1; // city, knights, fame

  // no-clan block: alliance, flag, empty SetString1, grade, ranking, markVersion, cape=-1
  assert.equal(packet.readUInt16LE(o), 0); o += 2;
  assert.equal(packet[o++], 0); // flag
  assert.equal(packet[o++], 0); // clan string length
  assert.equal(packet[o++], 0); // grade
  assert.equal(packet[o++], 0); // ranking
  assert.equal(packet.readUInt16LE(o), 0); o += 2;
  assert.equal(packet.readInt16LE(o), -1); o += 2;

  o += 12; // max/current HP/MP + weights
  o += 10; // base/item stat pairs
  o += 4; // totalHit/totalAc
  o += 6; // resistances
  assert.equal(packet.readUInt32LE(o), 0); o += 4; // gold is DWORD in 1298
  assert.equal(packet[o++], 1); // authority
  assert.equal(packet[o++], 0); // knights rank
  assert.equal(packet[o++], 0); // personal rank
  o += 9; // skill bytes

  const itemStart = o;
  const itemBytes = MYINFO_ITEM_RECORDS * 11;
  assert.equal(packet.subarray(itemStart, itemStart + itemBytes).every((v) => v === 0), true);
  o += itemBytes;

  assert.equal(packet[o++], 0); // account status
  assert.equal(packet[o++], 0); // premium type
  assert.equal(packet.readUInt16LE(o), 0); o += 2;
  assert.equal(packet[o++], 0); // chicken
  assert.equal(packet.readUInt32LE(o), 0); o += 4;
  assert.equal(o, packet.length);
});

test('region bootstrap packets carry only nearby IDs before detail requests', () => {
  assert.equal(buildRegionUserIds([{ socketId: 7 }, { socketId: 9 }]).toString('hex'), '15020007000900');
  assert.equal(buildRegionNpcIds([{ nid: 10001 }]).toString('hex'), '1c01001127');
});

test('1298 surrounding user record uses SetString1, DWORD abnormal type and 8 seven-byte equipment records', () => {
  const user = {
    socketId: 88, characterId: 'Nearby', nation: 2, knightsId: 0, fame: 0, clan: null,
    level: 2, race: 11, classId: 201, x: 313, z: 403, y: 0, face: 1, hair: 1,
    resHpType: 1, abnormalType: 1, needParty: 1, authority: 1, isPartyLeader: false,
    invisibilityState: 0, direction: 0, isChicken: false, rank: 0, knightsRank: 0,
    personalRank: 0, visibleEquipment: [],
  };
  const packet = buildSurroundingUsers([user]);
  let o = 0;
  assert.equal(packet[o++], OPCODE.REQUEST_USER_IN);
  assert.equal(packet.readUInt16LE(o), 1); o += 2;
  assert.equal(packet.readUInt16LE(o), 88); o += 2;
  o = skipString1(packet, o, 'Nearby');
  o += 1 + 2 + 1; // nation, knights, fame
  o += 2 + 1 + 1 + 1 + 2 + 2; // no-clan block (no flag in GetUserInfo)
  o += 1 + 1 + 2 + 2 + 2 + 2 + 1 + 1 + 1;
  assert.equal(packet.readUInt32LE(o), 1); o += 4; // abnormal type
  o += 1 + 1 + 1 + 1 + 2 + 1 + 1 + 1 + 1;
  assert.equal(packet.length - o, 8 * 7);
  assert.equal(packet.subarray(o).every((v) => v === 0), true);
});

test('1298 NPC detail contains gate DWORD, two client IDK shorts and direction', () => {
  const npc = {
    nid: 10001, pid: 12000, zoneId: 21, npcType: 0, sellingGroup: 0, size: 100,
    weapon1: 0, weapon2: 0, name: 'StaticNpc', group: 0, level: 1, x: 315, z: 405, y: 0,
    gateOpen: 1, objectType: 0, direction: 7,
  };
  const packet = buildSurroundingNpcs([npc]);
  assert.equal(packet[0], OPCODE.REQUEST_NPC_IN);
  assert.equal(packet.readUInt16LE(1), 1);
  assert.equal(packet.readUInt16LE(3), 10001);
  assert.equal(packet.at(-1), 7);
  assert.equal(packet.readUInt16LE(packet.length - 5), 0);
  assert.equal(packet.readUInt16LE(packet.length - 3), 0);
});

test('selected character becomes WORLD_READY only after 1298 GAMESTART phase 2', async () => {
  const character = fixtureCharacter();
  const nearbyUser = {
    socketId: 88, zoneId: 21, characterId: 'Nearby', nation: 2, knightsId: 0, fame: 0, clan: null,
    level: 2, race: 11, classId: 201, x: 313, z: 403, y: 0, face: 1, hair: 1,
    resHpType: 1, abnormalType: 1, needParty: 1, authority: 1, visibleEquipment: [],
  };
  const nearbyNpc = {
    nid: 10001, pid: 12000, zoneId: 21, npcType: 0, sellingGroup: 0, size: 100,
    weapon1: 0, weapon2: 0, name: 'StaticNpc', group: 0, level: 1, x: 315, z: 405, y: 0,
    gateOpen: 1, objectType: 0,
  };
  const repository = new MockWorldRepository({ characters: [character], users: [nearbyUser], npcs: [nearbyNpc] });
  const service = new WorldSessionService({ repository });

  const selected = await service.beginSelectedCharacter({ accountId: 'account-a', characterId: 'TestHero', socketId: 321 });
  assert.equal(selected.state, WORLD_STATE.WAIT_GAMESTART_LOADING);
  assert.equal(selected.clientPackets[0].toString('hex'), '040115300cb40f000000');

  const loading = await service.handleClientPacket(321, phasePacket(OPCODE.GAMESTART, 1));
  assert.equal(loading.state, WORLD_STATE.WAIT_GAMESTART_LOADED);
  assert.deepEqual(loading.clientPackets.map((p) => p[0]), [0x0e, 0x5e, 0x15, 0x1c, 0x0d]);
  assert.equal(loading.clientPackets[2].toString('hex'), '1501005800');
  assert.equal(loading.clientPackets[3].toString('hex'), '1c01001127');
  assert.equal(loading.clientPackets[4].toString('hex'), '0d');
  assert.equal(loading.broadcastPackets.length, 0);

  // Detail requests are valid while the client is still loading the scene.
  const userDetails = await service.handleClientPacket(321, idRequest(OPCODE.REQUEST_USER_IN, [88]));
  assert.equal(userDetails.clientPackets[0].readUInt16LE(1), 1);
  const npcDetails = await service.handleClientPacket(321, idRequest(OPCODE.REQUEST_NPC_IN, [10001]));
  assert.equal(npcDetails.clientPackets[0].readUInt16LE(1), 1);

  const loaded = await service.handleClientPacket(321, phasePacket(OPCODE.GAMESTART, 2));
  assert.equal(loaded.state, WORLD_STATE.WORLD_READY);
  assert.equal(loaded.clientPackets.length, 0);
  assert.equal(loaded.broadcastPackets[0][0], OPCODE.USER_INOUT);
  assert.equal(loaded.broadcastPackets[0][1], USER_INOUT.REGENE);

  const duplicate = await service.handleClientPacket(321, phasePacket(OPCODE.GAMESTART, 2));
  assert.equal(duplicate.ignored, true);
});

test('zone-change handshake is TELEPORT -> client LOADING -> server LOADED -> client LOADED -> WORLD_READY', async () => {
  const character = fixtureCharacter();
  const service = new WorldSessionService({ repository: new MockWorldRepository({ characters: [character] }) });
  await service.beginSelectedCharacter({ accountId: 'account-a', characterId: 'TestHero', socketId: 7 });
  await service.handleClientPacket(7, phasePacket(OPCODE.GAMESTART, 1));
  await service.handleClientPacket(7, phasePacket(OPCODE.GAMESTART, 2));

  const transition = service.beginMoradonZoneChange(7);
  assert.equal(transition.state, WORLD_STATE.ZONE_CHANGE_WAIT_LOADING);
  assert.equal(transition.clientPackets[0].toString('hex'), '27031500300cb40f000000');

  const loading = await service.handleClientPacket(7, phasePacket(OPCODE.ZONE_CHANGE, 1));
  assert.equal(loading.state, WORLD_STATE.ZONE_CHANGE_WAIT_LOADED);
  assert.deepEqual(loading.clientPackets.map((p) => p.toString('hex')), ['150000', '1c0000', '2702']);
  assert.equal(loading.broadcastPackets.length, 0);

  const ready = await service.handleClientPacket(7, phasePacket(OPCODE.ZONE_CHANGE, 2));
  assert.equal(ready.state, WORLD_STATE.WORLD_READY);
  assert.equal(ready.clientPackets.length, 0);
  assert.equal(ready.broadcastPackets[0][1], USER_INOUT.REGENE);
});

test('repository ownership boundary rejects a character not belonging to the selected account', async () => {
  const character = fixtureCharacter({ accountId: 'account-b' });
  const repository = {
    async getCharacterForWorld() { return character; },
    async getSurroundingUsers() { return []; },
    async getSurroundingNpcs() { return []; },
  };
  const service = new WorldSessionService({ repository });
  await assert.rejects(
    service.beginSelectedCharacter({ accountId: 'account-a', characterId: 'TestHero', socketId: 1 }),
    /outside the selected account boundary/,
  );
});
