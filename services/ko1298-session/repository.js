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
      stats: {
        str: spec.str,
        sta: spec.sta,
        dex: spec.dex,
        intel: spec.intel,
        magicAttack: spec.magicAttack,
      },
      equipment: {},
    };
    account.characters[spec.slot] = character;
    return { ok: true, code: CREATE_RESULT.OK, character: cloneCharacter(character) };
  }

  getCharacter(username, characterId) {
    const account = this.accounts.get(username);
    if (!account) return null;
    return cloneCharacter(account.characters.find((character) => character?.characterId === characterId) || null);
  }

  // WS14 repository boundary. The full production world snapshot is owned by the
  // persistence/world integration layer; this development repository exposes only
  // the identity fields required for beginSelectedCharacter().
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
  };
}

module.exports = { SessionRepository, MemoryRepository, CREATE_RESULT };
