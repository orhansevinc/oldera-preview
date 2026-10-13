'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { OPCODE, WorldSessionService, MockWorldRepository } = require('../../services/ko1298-world');

function minimalCharacter() {
  return {
    accountId: 'a', characterId: 'c', nation: 1, race: 1, classId: 101, face: 0, hair: 0,
    rank: 0, title: 0, level: 1, points: 0, maxExp: 1, exp: 0, loyalty: 0, city: 0,
    knightsId: 0, fame: 0, maxHp: 1, hp: 1, maxMp: 1, mp: 1, maxWeight: 1, itemWeight: 0,
    str: 1, itemStr: 0, sta: 1, itemSta: 0, dex: 1, itemDex: 0, intel: 1, itemIntel: 0,
    cha: 1, itemCha: 0, totalHit: 0, totalAc: 0, fireRes: 0, coldRes: 0, lightningRes: 0,
    magicRes: 0, diseaseRes: 0, poisonRes: 0, gold: 0, authority: 1,
  };
}

test('WS14 rejects combat/movement/inventory opcodes instead of silently owning them', async () => {
  const service = new WorldSessionService({ repository: new MockWorldRepository({ characters: [minimalCharacter()] }) });
  await service.beginSelectedCharacter({ accountId: 'a', characterId: 'c', socketId: 3 });
  await assert.rejects(service.handleClientPacket(3, Buffer.from([0x06])), /outside WS14 scope/); // movement
  await assert.rejects(service.handleClientPacket(3, Buffer.from([0x08])), /outside WS14 scope/); // attack
  await assert.rejects(service.handleClientPacket(3, Buffer.from([0x1f])), /outside WS14 scope/); // item move
  assert.equal(OPCODE.GAMESTART, 0x0d);
});

test('WS14 rejects the obsolete pre-1298 character-name GAMESTART shape', async () => {
  const service = new WorldSessionService({ repository: new MockWorldRepository({ characters: [minimalCharacter()] }) });
  await service.beginSelectedCharacter({ accountId: 'a', characterId: 'c', socketId: 4 });
  await assert.rejects(service.handleClientPacket(4, Buffer.from([0x0d, 1, 0x63])), /exactly/);
});
