'use strict';

const { CHARACTER_SLOT_COUNT } = require('./protocol');

const CREATE_RESULT = {
  OK: 0,
  FAILED: 1,
};

class SessionRepository {
  authenticate() { throw Error('not implemented'); }
  getNation() { throw Error('not implemented'); }
  setNation() { throw Error('not implemented'); }
  listCharacters() { throw Error('not implemented'); }
  createCharacter() { throw Error('not implemented'); }
  getCharacter() { throw Error('not implemented'); }
}

class MemoryRepository extends SessionRepository {
  constructor() {
    super();
    this.accounts = new Map([
      ['osevinc', { password: 'osevinc', nation: 0, characters: Array(CHARACTER_SLOT_COUNT).fill(null) }],
    ]);
  }

  authenticate(username, password) {
    const account = this.accounts.get(username);
    return !!account && account.password === password;
  }

  getNation(username) {
    return this.accounts.get(username)?.nation ?? 0;
  }

  setNation(username, nation) {
    const account = this.accounts.get(username);
    if (!account) return false;
    account.nation = nation;
    return true;
  }

  listCharacters(username) {
    const account = this.accounts.get(username);
    if (!account) return [];
    return account.characters.map(cloneCharacter);
  }

  createCharacter(username, spec) {
    const account = this.accounts.get(username);
    if (!account || (account.nation !== 1 && account.nation !== 2)) return { ok: false, code: CREATE_RESULT.FAILED };
    if (!Number.isInteger(spec.slot) || spec.slot < 0 || spec.slot >= CHARACTER_SLOT_COUNT) return { ok: false, code: CREATE_RESULT.FAILED };
    if (account.characters[spec.slot]) return { ok: false, code: CREATE_RESULT.FAILED };
    if (!spec.name || Buffer.byteLength(spec.name, 'latin1') > 20) return { ok: false, code: CREATE_RESULT.FAILED };
    if (this.#characterNameExists(spec.name)) return { ok: false, code: CREATE_RESULT.FAILED };

    // Keep the development/staging repository protocol-complete. WS14's MYINFO
    // encoder requires a full 1298 world snapshot after character select; the
    // browser must not disconnect merely because this in-memory fixture omitted
    // fields that production persistence would normally supply.
    const character = {
      accountId: username,
      characterId: spec.name,
      slot: spec.slot,
      nation: account.nation,
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
    account.characters[spec.slot] = character;
    return { ok: true, code: CREATE_RESULT.OK, character: cloneCharacter(character) };
  }

  getCharacter(username, characterId) {
    const account = this.accounts.get(username);
    if (!account) return null;
    return cloneCharacter(account.characters.find((character) => character?.characterId === characterId) || null);
  }

  // WS14 repository boundary. The in-memory fixture mirrors the full world
  // snapshot shape required by the verified 1298 MYINFO encoder.
  async getCharacterForWorld(accountId, characterId) {
    return this.getCharacter(accountId, characterId);
  }

  async getSurroundingUsers() {
    return [];
  }

  async getSurroundingNpcs() {
    return [];
  }

  #characterNameExists(characterId) {
    for (const account of this.accounts.values()) {
      if (account.characters.some((character) => character?.characterId === characterId)) return true;
    }
    return false;
  }
}

function cloneCharacter(character) {
  if (!character) return null;
  return {
    ...character,
    stats: { ...(character.stats || {}) },
    equipment: Object.fromEntries(
      Object.entries(character.equipment || {}).map(([key, value]) => [key, { ...value }]),
    ),
    skills: Array.isArray(character.skills) ? [...character.skills] : [],
    protocolItems: Array.isArray(character.protocolItems) ? character.protocolItems.map((item) => ({ ...item })) : [],
    visibleEquipment: Array.isArray(character.visibleEquipment) ? character.visibleEquipment.map((item) => ({ ...item })) : [],
    clan: character.clan ? { ...character.clan } : null,
  };
}

module.exports = { SessionRepository, MemoryRepository, CREATE_RESULT };
