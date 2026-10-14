'use strict';

const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const ws03Root = process.env.WS03_ROOT;
const ws14Root = process.env.WS14_ROOT;
const ws16Root = process.env.WS16_ROOT;
const ws25Root = process.env.WS25_ROOT;
const smdPath = process.env.WS14_MORADON_SMD;
const npcDataPath = process.env.WS16_NPC_DATA;
const mobDataPath = process.env.WS25_MOB_DATA;
if (![ws03Root, ws14Root, ws16Root, ws25Root, smdPath, npcDataPath, mobDataPath].every(Boolean)) {
  throw new Error('WS03_ROOT, WS14_ROOT, WS16_ROOT, WS25_ROOT, WS14_MORADON_SMD, WS16_NPC_DATA and WS25_MOB_DATA are required');
}

const protocol = require(path.resolve(ws03Root, 'services/ko1298-session/protocol.js'));
const { AuthSession, GameSession } = require(path.resolve(ws03Root, 'services/ko1298-session/session.js'));
const worldApi = require(path.resolve(ws14Root, 'services/ko1298-world/index.js'));
const ws16 = require(path.resolve(ws16Root, 'services/ko1298-npc'));
const ws25 = require(path.resolve(ws25Root, 'services/ko1298-mobs'));
const {
  WorldSessionService,
  createMoradonHeightResolver,
  createSharedNpcRuntimeIdNamespace,
} = worldApi;
const { FrameDecoder, frame, CHARACTER_SLOT_COUNT } = protocol;

const expectedProviderSet = process.env.WS50_PROVIDER_SET || 'WS50-C5@sha256:7ac3b8a4c06b67e52b8d18518ef8c82209a60c6101c33609a4c16e64d84f119e';
const username = process.env.WS10_TEST_ID || 'ws10e2e';
const password = process.env.WS10_TEST_PW || 'ws10pass';
const authPort = Number(process.env.AUTH_TCP_PORT || 16100);
const gamePort = Number(process.env.GAME_TCP_PORT || 16101);

const resolver = createMoradonHeightResolver({ smdPath });
const npcDocument = JSON.parse(fs.readFileSync(npcDataPath, 'utf8'));
const npcPopulation = ws16.materializeNpcPopulation(npcDocument, { heightAuthority: resolver });
const npcWorld = new ws16.NpcWorld();
for (const record of npcPopulation.records) npcWorld.add(record);

const runtimeNamespace = createSharedNpcRuntimeIdNamespace({
  minInclusive: ws25.RUNTIME_ID_CONTRACT.NPC_BAND,
  maxExclusive: ws25.RUNTIME_ID_CONTRACT.INVALID_BAND,
  reserved: npcPopulation.records,
});
const mobDocument = JSON.parse(fs.readFileSync(mobDataPath, 'utf8'));
const mobDefinition = ws25.loadVerifiedWorldDefinition(mobDocument);
const mobService = new ws25.MobVisibilityService(mobDefinition, {
  terrain: {
    resolveHeight(zoneId, x, z) {
      return resolver.resolveHeight(Number(zoneId), x, z);
    },
  },
  runtimeIds: runtimeNamespace,
});
const mobPopulation = mobService.initialize(0);
if (npcPopulation.records.length !== 37) throw new Error(`expected 37 authoritative Moradon NPCs, got ${npcPopulation.records.length}`);
if (mobPopulation.length !== 135) throw new Error(`expected 135 authoritative Moradon mobs, got ${mobPopulation.length}`);

function runtimeIdOf(record) {
  return record?.runtimeId ?? record?.instanceId ?? record?.nid ?? record?.id;
}
function nameOf(record) {
  return record?.name ?? record?.detailRecord?.name ?? record?.visibilityRecord?.name ?? 'unknown';
}
function templateOf(record) {
  return record?.templateResourceId ?? record?.pid ?? record?.templateId ?? record?.detailRecord?.templateResourceId ?? 0;
}
function positionOf(record) {
  return record?.position || record?.detailRecord?.position || record;
}

const npcIdSet = new Set(npcPopulation.records.map(runtimeIdOf));
const mobIdSet = new Set(mobPopulation.map(runtimeIdOf));
for (const id of npcIdSet) {
  if (mobIdSet.has(id)) throw new Error(`cross-domain runtime ID collision ${id}`);
}

let overlap = null;
for (const mob of mobPopulation) {
  const p = positionOf(mob);
  const npcs = npcWorld.nearby(21, p.x, p.z);
  const mobs = mobService.getNearby({ zoneId: 21, x: p.x, z: p.z });
  if (npcs.length > 0 && mobs.length > 0) {
    overlap = { position: { x: p.x, y: p.y, z: p.z }, npcs, mobs };
    break;
  }
}
if (!overlap) throw new Error('no source-backed Moradon overlap region contains both NPC and mob visibility');

console.log(`WS10_AUTH provider_set=${expectedProviderSet} npc_total=${npcPopulation.records.length} mob_total=${mobPopulation.length} collision=0`);
console.log(`WS10_AUTH spawn x=${overlap.position.x} y=${overlap.position.y} z=${overlap.position.z} nearby_npc=${overlap.npcs.length} nearby_mob=${overlap.mobs.length}`);
for (const record of overlap.npcs) {
  console.log(`WS10_AUTH type=npc id=${runtimeIdOf(record)} template=${templateOf(record)} name=${JSON.stringify(nameOf(record))}`);
}
for (const record of overlap.mobs) {
  console.log(`WS10_AUTH type=mob id=${runtimeIdOf(record)} template=${templateOf(record)} name=${JSON.stringify(nameOf(record))}`);
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function worldCharacter(accountId, spec) {
  return {
    accountId,
    characterId: spec.name,
    slot: spec.slot,
    nation: repo.getNation(accountId),
    race: spec.race,
    classId: spec.classId,
    level: 1,
    face: spec.face,
    hair: spec.hair,
    zone: 21,
    equipment: {},
    rank: 0,
    title: 0,
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
    str: spec.str,
    itemStr: 0,
    sta: spec.sta,
    itemSta: 0,
    dex: spec.dex,
    itemDex: 0,
    intel: spec.intel,
    itemIntel: 0,
    cha: spec.magicAttack,
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
    stats: {
      str: spec.str,
      sta: spec.sta,
      dex: spec.dex,
      intel: spec.intel,
      magicAttack: spec.magicAttack,
    },
  };
}

const repo = {
  accounts: new Map([[username, { password, nation: 0, characters: Array(CHARACTER_SLOT_COUNT).fill(null) }]]),
  authenticate(id, pw) {
    const account = this.accounts.get(id);
    return Boolean(account && account.password === pw);
  },
  getNation(id) {
    return this.accounts.get(id)?.nation ?? 0;
  },
  setNation(id, nation) {
    const account = this.accounts.get(id);
    if (!account) return false;
    account.nation = nation;
    return true;
  },
  listCharacters(id) {
    return (this.accounts.get(id)?.characters || []).map(clone);
  },
  createCharacter(id, spec) {
    const account = this.accounts.get(id);
    if (!account || ![1, 2].includes(account.nation)) return { ok: false, code: 1 };
    if (!Number.isInteger(spec.slot) || spec.slot < 0 || spec.slot >= CHARACTER_SLOT_COUNT) return { ok: false, code: 1 };
    if (account.characters[spec.slot]) return { ok: false, code: 1 };
    if (!spec.name || Buffer.byteLength(spec.name, 'latin1') > 20) return { ok: false, code: 1 };
    for (const other of this.accounts.values()) {
      if (other.characters.some((c) => c?.characterId === spec.name)) return { ok: false, code: 1 };
    }
    const character = worldCharacter(id, spec);
    account.characters[spec.slot] = character;
    console.log(`WS10_COMPOSE event=character-created slot=${spec.slot} name=${spec.name}`);
    return { ok: true, code: 0, character: clone(character) };
  },
  getCharacter(id, characterId) {
    const character = this.accounts.get(id)?.characters.find((c) => c?.characterId === characterId) || null;
    return clone(character);
  },
  async getCharacterForWorld(id, characterId) {
    return this.getCharacter(id, characterId);
  },
  async getSurroundingUsers() {
    return [];
  },
  async getSurroundingNpcs({ zoneId, x, z }) {
    if (zoneId !== 21) return [];
    return npcWorld.nearby(21, x, z);
  },
};

const worldSession = new WorldSessionService({
  repository: repo,
  mobPort: mobService,
  moradonSpawn: overlap.position,
});
let nextSocketId = 1;

function parseRequestedIds(payload) {
  if (!payload || payload[0] !== 0x1d || payload.length < 3) return [];
  const count = payload.readInt16LE(1);
  if (count < 0 || payload.length !== 3 + count * 2) return [];
  const ids = [];
  for (let index = 0; index < count; index += 1) ids.push(payload.readInt16LE(3 + index * 2));
  return ids;
}
function classifyIds(ids) {
  return {
    npc: ids.filter((id) => npcIdSet.has(id)),
    mob: ids.filter((id) => mobIdSet.has(id)),
    unknown: ids.filter((id) => !npcIdSet.has(id) && !mobIdSet.has(id)),
  };
}

function listen(port, kind) {
  const server = net.createServer((socket) => {
    const socketId = kind === 'game' ? nextSocketId++ : 0;
    const session = kind === 'auth'
      ? new AuthSession(repo, { gameHost: '127.0.0.1', gameName: 'OldKO' })
      : new GameSession(repo, {
          worldSession,
          socketId,
          onWorldBroadcast: ({ packet, snapshot }) => {
            console.log(`WS10_COMPOSE event=world-broadcast opcode=0x${packet[0].toString(16).padStart(2, '0')} state=${snapshot?.state || 'unknown'}`);
          },
          onGameplayBroadcast: ({ owner, packet }) => {
            console.log(`WS10_COMPOSE event=gameplay-broadcast owner=${owner} opcode=0x${packet[0].toString(16).padStart(2, '0')}`);
          },
        });
    const decoder = new FrameDecoder();
    let queue = Promise.resolve();
    console.log(`WS10_COMPOSE event=${kind}-connected socketId=${socketId}`);
    socket.on('data', (chunk) => {
      queue = queue.then(async () => {
        for (const payload of decoder.push(chunk)) {
          console.log(`WS10_COMPOSE event=${kind}-rx opcode=0x${payload[0].toString(16).padStart(2, '0')} bytes=${payload.length}`);
          if (kind === 'game' && payload[0] === 0x1d) {
            const requested = parseRequestedIds(payload);
            const classified = classifyIds(requested);
            console.log(`WS10_AUTH event=client-detail-request ids=${requested.join(',')} npc=${classified.npc.join(',')} mob=${classified.mob.join(',')} unknown=${classified.unknown.join(',')}`);
          }
          if (kind === 'game' && payload[0] === 0x06) {
            console.log(`WS10_AUTH event=browser-movement bytes=${payload.length}`);
          }
          const responses = await session.handle(payload);
          for (const response of responses) {
            console.log(`WS10_COMPOSE event=${kind}-tx opcode=0x${response[0].toString(16).padStart(2, '0')} bytes=${response.length}`);
            if (kind === 'game' && response[0] === 0x1c) {
              const ids = parseRequestedIds(Buffer.concat([Buffer.from([0x1d]), response.subarray(1)]));
              const classified = classifyIds(ids);
              console.log(`WS10_AUTH event=region-list count=${ids.length} npc=${classified.npc.join(',')} mob=${classified.mob.join(',')} unknown=${classified.unknown.join(',')}`);
            }
            socket.write(frame(response));
          }
        }
      }).catch((error) => {
        console.error(`WS10_COMPOSE event=${kind}-error message=${JSON.stringify(error.message)}`);
        socket.destroy(error);
      });
    });
    socket.on('close', () => console.log(`WS10_COMPOSE event=${kind}-closed socketId=${socketId}`));
  });
  server.listen(port, '127.0.0.1', () => console.log(`WS10_COMPOSE event=${kind}-listening port=${port}`));
  return server;
}

const auth = listen(authPort, 'auth');
const game = listen(gamePort, 'game');

function shutdown() {
  auth.close();
  game.close();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
