import { MAX_AVAILABLE_CHARACTER, Nation } from '../character-select/CharacterSelectRuntime.js';

export const OLD_ERA_DEV_SERVER = Object.freeze({
  id: 'oldera-1298-dev',
  name: 'OldERA 1298',
});

export const OLD_ERA_DEV_CREDENTIALS = Object.freeze({
  username: 'osevinc',
  password: 'osevinc',
});

function cloneCharacter(character) {
  return character ? { ...character } : null;
}

function normalizeName(value) {
  return String(value ?? '').trim();
}

export class DevAccountStore {
  constructor() {
    this.account = {
      username: OLD_ERA_DEV_CREDENTIALS.username,
      password: OLD_ERA_DEV_CREDENTIALS.password,
      serverId: OLD_ERA_DEV_SERVER.id,
      nation: null,
      characters: Array(MAX_AVAILABLE_CHARACTER).fill(null),
    };
    this.authenticated = false;
  }

  authenticate(username, password) {
    const ok = username === this.account.username && password === this.account.password;
    this.authenticated = ok;
    return ok;
  }

  selectServer(serverId) {
    this.#requireAuth();
    if (serverId !== this.account.serverId) throw new RangeError(`Unknown server: ${serverId}`);
    return OLD_ERA_DEV_SERVER;
  }

  selectNation(nation) {
    this.#requireAuth();
    if (nation !== Nation.KARUS && nation !== Nation.ELMORAD) {
      throw new RangeError(`Unsupported nation: ${nation}`);
    }
    if (this.account.nation !== null && this.account.nation !== nation) {
      throw new Error('Nation is already fixed for this dev account.');
    }
    this.account.nation = nation;
    return nation;
  }

  getNation() {
    this.#requireAuth();
    return this.account.nation;
  }

  listCharacters() {
    this.#requireAuth();
    return this.account.characters.map(cloneCharacter);
  }

  createCharacter({
    slot,
    id,
    race,
    classId,
    face = 0,
    hair = 0,
    zone = 1,
    level = 1,
    stats = null,
  }) {
    this.#requireAuth();
    if (this.account.nation === null) throw new Error('Select a nation before creating a character.');
    if (!Number.isInteger(slot) || slot < 0 || slot >= MAX_AVAILABLE_CHARACTER) {
      throw new RangeError(`slot must be between 0 and ${MAX_AVAILABLE_CHARACTER - 1}.`);
    }
    if (this.account.characters[slot]) throw new Error(`Character slot ${slot} is already occupied.`);

    const characterId = normalizeName(id);
    if (!characterId) throw new Error('Character id cannot be empty.');
    if (characterId.length >= 32) throw new Error('Character id must be shorter than 32 characters.');
    if (this.account.characters.some((character) => character?.id.toLowerCase() === characterId.toLowerCase())) {
      throw new Error(`Character id already exists: ${characterId}`);
    }

    const character = {
      id: characterId,
      nation: this.account.nation,
      race,
      classId,
      level,
      face,
      hair,
      zone,
      stats: stats ? { ...stats } : null,
      equipment: {
        helmet: 0,
        upper: 0,
        cloak: 0,
        rightHand: 0,
        leftHand: 0,
        lower: 0,
        gloves: 0,
        shoes: 0,
      },
    };

    this.account.characters[slot] = character;
    return cloneCharacter(character);
  }

  deleteCharacter(slot) {
    this.#requireAuth();
    if (!Number.isInteger(slot) || slot < 0 || slot >= MAX_AVAILABLE_CHARACTER) {
      throw new RangeError(`slot must be between 0 and ${MAX_AVAILABLE_CHARACTER - 1}.`);
    }
    const previous = this.account.characters[slot];
    this.account.characters[slot] = null;
    return cloneCharacter(previous);
  }

  reset() {
    this.authenticated = false;
    this.account.nation = null;
    this.account.characters = Array(MAX_AVAILABLE_CHARACTER).fill(null);
  }

  #requireAuth() {
    if (!this.authenticated) throw new Error('Authentication required.');
  }
}
