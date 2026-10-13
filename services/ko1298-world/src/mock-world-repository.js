'use strict';

class MockWorldRepository {
  constructor({ characters = [], users = [], npcs = [] } = {}) {
    this.characters = new Map();
    for (const character of characters) {
      this.characters.set(`${character.accountId}\u0000${character.characterId}`, structuredClone(character));
    }
    this.users = users.map((v) => structuredClone(v));
    this.npcs = npcs.map((v) => structuredClone(v));
  }

  async getCharacterForWorld(accountId, characterId) {
    const value = this.characters.get(`${accountId}\u0000${characterId}`);
    return value ? structuredClone(value) : null;
  }

  async getSurroundingUsers({ zoneId, excludeSocketId }) {
    return this.users
      .filter((u) => u.zoneId === zoneId && u.socketId !== excludeSocketId)
      .map((u) => structuredClone(u));
  }

  async getSurroundingNpcs({ zoneId }) {
    return this.npcs
      .filter((n) => n.zoneId === zoneId)
      .map((n) => structuredClone(n));
  }
}

module.exports = { MockWorldRepository };
