'use strict';

const { PacketWriter, assertIntegerRange } = require('./packet-writer');
const {
  OPCODE,
  USER_INOUT,
  GAMESTART_PHASE,
  ZONE_CHANGE_PHASE,
  ZONE_ABILITY,
  MYINFO_ITEM_RECORDS,
  VISIBLE_EQUIPMENT_RECORDS,
  SKILL_BYTES,
} = require('./constants');

function scaledWord(value, signed = false) {
  if (!Number.isFinite(value)) throw new TypeError(`coordinate must be finite: ${String(value)}`);
  const scaled = Math.trunc(value * 10);
  assertIntegerRange(scaled, signed ? -0x8000 : 0, signed ? 0x7fff : 0xffff, signed ? 'coord i16' : 'coord u16');
  return scaled;
}

function latin1(value) {
  return Buffer.from(String(value ?? ''), 'latin1');
}

// Open-KO SetString1(): uint8 length + raw bytes.
function writeString1(w, value) {
  const bytes = latin1(value);
  if (bytes.length > 0xff) throw new RangeError(`SetString1 length exceeds uint8: ${bytes.length}`);
  return w.u8(bytes.length).bytes(bytes);
}

function buildCharacterSelectSuccess({ zoneId, x, z, y, victoryNation = 0 }) {
  return new PacketWriter()
    .u8(OPCODE.CHARACTER_SELECT)
    .u8(1)
    .u8(zoneId)
    .u16(scaledWord(x))
    .u16(scaledWord(z))
    .i16(scaledWord(y, true))
    .u8(victoryNation)
    .toBuffer();
}

function buildCharacterSelectFailure() {
  return Buffer.from([OPCODE.CHARACTER_SELECT, 0x00]);
}

function buildGameStartAck() {
  return Buffer.from([OPCODE.GAMESTART]);
}

function buildZoneChangeTeleport({ zoneId, x, z, y, victoryNation = 0, subZone = 0 }) {
  return new PacketWriter()
    .u8(OPCODE.ZONE_CHANGE)
    .u8(ZONE_CHANGE_PHASE.TELEPORT)
    .u8(zoneId)
    .u8(subZone)
    .u16(scaledWord(x))
    .u16(scaledWord(z))
    .i16(scaledWord(y, true))
    .u8(victoryNation)
    .toBuffer();
}

function buildZoneChangeLoadedAck() {
  return Buffer.from([OPCODE.ZONE_CHANGE, ZONE_CHANGE_PHASE.LOADED]);
}

function buildMoradonZoneAbility({ tariff = 10 } = {}) {
  // In 1.298 Moradon is neutral and allows cross-nation trade/chat.
  return new PacketWriter()
    .u8(OPCODE.ZONE_ABILITY)
    .u8(ZONE_ABILITY.UPDATE)
    .u8(1)
    .u8(ZONE_ABILITY.NEUTRAL)
    .u8(1)
    .i16(tariff)
    .toBuffer();
}

function buildMyInfo(character, session) {
  validateCharacterForMyInfo(character);
  const w = new PacketWriter();
  const items = normalizedItemRecords(character.protocolItems, MYINFO_ITEM_RECORDS);
  const skills = normalizedByteArray(character.skills, SKILL_BYTES);
  const clan = character.clan || null;

  w.u8(OPCODE.MYINFO).u16(session.socketId);
  writeString1(w, character.characterId);
  w.u16(scaledWord(session.x))
    .u16(scaledWord(session.z))
    .i16(scaledWord(session.y, true))
    .u8(character.nation)
    .u8(character.race)
    .u16(character.classId)
    .u8(character.face)
    .u8(character.hair)
    .u8(character.rank)
    .u8(character.title)
    .u8(character.level)
    .u8(character.points)
    .u32(character.maxExp)
    .u32(character.exp)
    .u32(character.loyalty)
    .u32(character.monthlyLoyalty ?? 0)
    .u8(character.city)
    .u16(character.knightsId)
    .u8(character.fame);

  if (clan) {
    w.u16(clan.allianceKnightsId ?? 0)
      .u8(clan.flag ?? 0);
    writeString1(w, clan.name ?? '');
    w.u8(clan.grade ?? 0)
      .u8(clan.ranking ?? 0)
      .u16(clan.markVersion ?? 0)
      .i16(clan.capeId ?? -1);
  } else {
    w.u16(0).u8(0).u8(0).u8(0).u8(0).u16(0).i16(-1);
  }

  w.u16(character.maxHp)
    .u16(character.hp)
    .u16(character.maxMp)
    .u16(character.mp)
    .u16(character.maxWeight)
    .u16(character.itemWeight)
    .u8(character.str)
    .u8(character.itemStr)
    .u8(character.sta)
    .u8(character.itemSta)
    .u8(character.dex)
    .u8(character.itemDex)
    .u8(character.intel)
    .u8(character.itemIntel)
    .u8(character.cha)
    .u8(character.itemCha)
    .u16(character.totalHit)
    .u16(character.totalAc)
    .u8(character.fireRes)
    .u8(character.coldRes)
    .u8(character.lightningRes)
    .u8(character.magicRes)
    .u8(character.diseaseRes)
    .u8(character.poisonRes)
    .u32(character.gold)
    .u8(character.authority)
    .u8(character.knightsRank ?? 0)
    .u8(character.personalRank ?? 0);

  for (const skill of skills) w.u8(skill);
  for (const item of items) writeMyInfoItemRecord(w, item);

  w.u8(character.accountStatus ?? 0)
    .u8(character.premiumType ?? 0)
    .u16(character.premiumTime ?? 0)
    .u8(character.isChicken ? 1 : 0)
    .u32(character.mannerPoint ?? 0);

  return w.toBuffer();
}

function buildUserInOut(character, session, type = USER_INOUT.REGENE) {
  const w = new PacketWriter();
  w.u8(OPCODE.USER_INOUT).u8(type).u16(session.socketId);
  if (type === USER_INOUT.OUT) return w.toBuffer();
  writeSurroundingUserBody(w, toSurroundingUser(character, session));
  return w.toBuffer();
}

function buildRegionUserIds(users = []) {
  const w = new PacketWriter().u8(OPCODE.REGION_USER_IDS).u16(users.length);
  for (const user of users) w.u16(user.socketId);
  return w.toBuffer();
}

function buildRegionNpcIds(npcs = []) {
  const w = new PacketWriter().u8(OPCODE.REGION_NPC_IDS).u16(npcs.length);
  for (const npc of npcs) w.u16(npc.nid);
  return w.toBuffer();
}

function buildSurroundingUsers(users = []) {
  const w = new PacketWriter().u8(OPCODE.REQUEST_USER_IN).u16(users.length);
  for (const user of users) writeSurroundingUserRecord(w, user);
  return w.toBuffer();
}

function buildSurroundingNpcs(npcs = []) {
  const w = new PacketWriter().u8(OPCODE.REQUEST_NPC_IN).u16(npcs.length);
  for (const npc of npcs) writeNpcRecord(w, npc);
  return w.toBuffer();
}

function parseEntityIdRequest(packet, opcode) {
  const p = Buffer.from(packet);
  if (p.length < 3 || p[0] !== opcode) throw new Error(`expected entity request opcode 0x${opcode.toString(16)}`);
  const count = p.readUInt16LE(1);
  const expected = 3 + count * 2;
  if (p.length !== expected) throw new Error(`invalid entity request length: count=${count} actual=${p.length}`);
  const ids = [];
  for (let offset = 3; offset < p.length; offset += 2) ids.push(p.readUInt16LE(offset));
  return ids;
}

function parseGameStart(packet) {
  const p = Buffer.from(packet);
  if (p.length !== 2 || p[0] !== OPCODE.GAMESTART) throw new Error('1298 WIZ_GAMESTART must be exactly [0x0D, phase]');
  if (p[1] !== GAMESTART_PHASE.LOADING && p[1] !== GAMESTART_PHASE.LOADED) {
    throw new Error(`unsupported 1298 WIZ_GAMESTART phase ${p[1]}`);
  }
  return { phase: p[1] };
}

function parseZoneChangePhase(packet) {
  const p = Buffer.from(packet);
  if (p.length !== 2 || p[0] !== OPCODE.ZONE_CHANGE) throw new Error('1298 client WIZ_ZONE_CHANGE must be exactly [0x27, phase]');
  if (p[1] !== ZONE_CHANGE_PHASE.LOADING && p[1] !== ZONE_CHANGE_PHASE.LOADED) {
    throw new Error(`unsupported 1298 WIZ_ZONE_CHANGE phase ${p[1]}`);
  }
  return { phase: p[1] };
}

function writeSurroundingUserRecord(w, user) {
  w.u16(user.socketId);
  writeSurroundingUserBody(w, user);
}

function writeSurroundingUserBody(w, user) {
  const clan = user.clan || null;
  const visible = normalizedVisibleEquipment(user.visibleEquipment);
  writeString1(w, user.characterId);
  w.u8(user.nation)
    .u16(user.knightsId || 0)
    .u8(user.fame || 0);

  // GetUserInfo() differs from MYINFO: it has no clan flag byte.
  if (clan) {
    w.u16(clan.allianceKnightsId ?? 0);
    writeString1(w, clan.name ?? '');
    w.u8(clan.grade ?? 0)
      .u8(clan.ranking ?? 0)
      .u16(clan.markVersion ?? 0)
      .i16(clan.capeId ?? -1);
  } else {
    w.u16(0).u8(0).u8(0).u8(0).u16(0).i16(-1);
  }

  w.u8(user.level)
    .u8(user.race)
    .u16(user.classId)
    .u16(scaledWord(user.x))
    .u16(scaledWord(user.z))
    .i16(scaledWord(user.y, true))
    .u8(user.face)
    .u8(user.hair)
    .u8(user.resHpType ?? 1)
    .u32(user.abnormalType ?? 1)
    .u8(user.needParty ?? 1)
    .u8(user.authority ?? 0)
    .u8(user.isPartyLeader ? 1 : 0)
    .u8(user.invisibilityState ?? 0)
    .u16(user.direction ?? 0)
    .u8(user.isChicken ? 1 : 0)
    .u8(user.rank ?? 0)
    .u8(user.knightsRank ?? 0)
    .u8(user.personalRank ?? 0);

  for (const item of visible) {
    w.u32(item.itemId).u16(item.duration).u8(item.flag);
  }
}

function writeNpcRecord(w, npc) {
  w.u16(npc.nid);
  writeNpcBody(w, npc);
}

function writeNpcBody(w, npc) {
  w.u16(npc.pid)
    .u8(npc.npcType)
    .u32(npc.sellingGroup || 0)
    .u16(npc.size)
    .u32(npc.weapon1 || 0)
    .u32(npc.weapon2 || 0);
  writeString1(w, npc.name || '');
  w.u8(npc.group || 0)
    .u8(npc.level || 1)
    .u16(scaledWord(npc.x))
    .u16(scaledWord(npc.z))
    .i16(scaledWord(npc.y || 0, true))
    .u32(npc.gateOpen || 0)
    .u8(npc.objectType || 0)
    .u16(npc.idk0 || 0)
    .u16(npc.idk1 || 0)
    .u8(npc.direction || 0);
}

function writeMyInfoItemRecord(w, item) {
  w.u32(item.itemId)
    .u16(item.duration)
    .u16(item.count)
    .u8(item.flag)
    .u16(item.timeRemaining);
}

function normalizedItemRecords(items, count) {
  const source = Array.isArray(items) ? items : [];
  return Array.from({ length: count }, (_, i) => ({
    itemId: source[i]?.itemId || 0,
    duration: source[i]?.duration || 0,
    count: source[i]?.count || 0,
    flag: source[i]?.flag || 0,
    timeRemaining: source[i]?.timeRemaining || 0,
  }));
}

function normalizedVisibleEquipment(items) {
  const source = Array.isArray(items) ? items : [];
  return Array.from({ length: VISIBLE_EQUIPMENT_RECORDS }, (_, i) => ({
    itemId: source[i]?.itemId || 0,
    duration: source[i]?.duration || 0,
    flag: source[i]?.flag || 0,
  }));
}

function normalizedByteArray(values, count) {
  const source = Array.isArray(values) ? values : [];
  return Array.from({ length: count }, (_, i) => source[i] || 0);
}

function toSurroundingUser(character, session) {
  return {
    socketId: session.socketId,
    characterId: character.characterId,
    nation: character.nation,
    knightsId: character.knightsId,
    fame: character.fame,
    clan: character.clan,
    level: character.level,
    race: character.race,
    classId: character.classId,
    x: session.x,
    z: session.z,
    y: session.y,
    face: character.face,
    hair: character.hair,
    resHpType: character.resHpType ?? 1,
    abnormalType: character.abnormalType ?? 1,
    needParty: character.needParty ?? 1,
    authority: character.authority,
    isPartyLeader: character.isPartyLeader,
    invisibilityState: character.invisibilityState,
    direction: character.direction,
    isChicken: character.isChicken,
    rank: character.rank,
    knightsRank: character.knightsRank,
    personalRank: character.personalRank,
    visibleEquipment: character.visibleEquipment,
  };
}

function validateCharacterForMyInfo(c) {
  const required = [
    'characterId', 'nation', 'race', 'classId', 'face', 'hair', 'rank', 'title', 'level', 'points',
    'maxExp', 'exp', 'loyalty', 'city', 'knightsId', 'fame', 'maxHp', 'hp', 'maxMp', 'mp',
    'maxWeight', 'itemWeight', 'str', 'itemStr', 'sta', 'itemSta', 'dex', 'itemDex', 'intel',
    'itemIntel', 'cha', 'itemCha', 'totalHit', 'totalAc', 'fireRes', 'coldRes', 'lightningRes',
    'magicRes', 'diseaseRes', 'poisonRes', 'gold', 'authority',
  ];
  for (const key of required) {
    if (c[key] === undefined || c[key] === null) throw new Error(`world character missing ${key}`);
  }
  const nameLen = Buffer.byteLength(c.characterId, 'latin1');
  if (nameLen === 0 || nameLen > 0xff) throw new Error('invalid characterId length for SetString1');
}

module.exports = {
  buildCharacterSelectSuccess,
  buildCharacterSelectFailure,
  buildGameStartAck,
  buildZoneChangeTeleport,
  buildZoneChangeLoadedAck,
  buildMoradonZoneAbility,
  buildMyInfo,
  buildUserInOut,
  buildRegionUserIds,
  buildRegionNpcIds,
  buildSurroundingUsers,
  buildSurroundingNpcs,
  parseEntityIdRequest,
  parseGameStart,
  parseZoneChangePhase,
  scaledWord,
};
