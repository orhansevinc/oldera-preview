'use strict';

const net = require('node:net');
const path = require('node:path');

const ws03Root = process.env.WS03_ROOT;
const ws14Root = process.env.WS14_ROOT;
if (!ws03Root || !ws14Root) throw new Error('WS03_ROOT and WS14_ROOT are required');

const protocol = require(path.resolve(ws03Root, 'services/ko1298-session/protocol.js'));
const { AuthSession, GameSession } = require(path.resolve(ws03Root, 'services/ko1298-session/session.js'));
const { WorldSessionService } = require(path.resolve(ws14Root, 'services/ko1298-world/index.js'));
const { FrameDecoder, frame, CHARACTER_SLOT_COUNT } = protocol;

const username = process.env.WS10_TEST_ID || 'ws10e2e';
const password = process.env.WS10_TEST_PW || 'ws10pass';
const authPort = Number(process.env.AUTH_TCP_PORT || 16100);
const gamePort = Number(process.env.GAME_TCP_PORT || 16101);

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
  async getSurroundingNpcs({ zoneId }) {
    if (zoneId !== 21) return [];
    return [{
      nid: 10001,
      pid: 12000,
      zoneId: 21,
      npcType: 0,
      sellingGroup: 0,
      size: 100,
      weapon1: 0,
      weapon2: 0,
      name: 'MoradonGateKeeper',
      group: 0,
      level: 1,
      x: 315,
      z: 405,
      y: 0,
      gateOpen: 1,
      objectType: 0,
      direction: 0,
    }];
  },
};

const worldSession = new WorldSessionService({ repository: repo });
let nextSocketId = 1;

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
        });
    const decoder = new FrameDecoder();
    let queue = Promise.resolve();
    console.log(`WS10_COMPOSE event=${kind}-connected socketId=${socketId}`);
    socket.on('data', (chunk) => {
      queue = queue.then(async () => {
        for (const payload of decoder.push(chunk)) {
          console.log(`WS10_COMPOSE event=${kind}-rx opcode=0x${payload[0].toString(16).padStart(2, '0')} bytes=${payload.length}`);
          const responses = await session.handle(payload);
          for (const response of responses) {
            console.log(`WS10_COMPOSE event=${kind}-tx opcode=0x${response[0].toString(16).padStart(2, '0')} bytes=${response.length}`);
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
