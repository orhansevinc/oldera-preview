'use strict';

class MockWorldRepository {
  constructor({ characters = [], users = [], npcs = [], worldStates = [] } = {}) {
    this.characters = new Map();
    for (const character of characters) {
      this.characters.set(`${character.accountId}\u0000${character.characterId}`, structuredClone(character));
    }
    this.users = users.map((v) => structuredClone(v));
    this.npcs = npcs.map((v) => structuredClone(v));
    this.worldStates = new Map();
    for (const state of worldStates) {
      this.worldStates.set(`${state.accountId}\u0000${state.characterId}`, structuredClone(state));
    }
  }

  async getCharacterForWorld(accountId, characterId) {
    const value = this.characters.get(`${accountId}\u0000${characterId}`);
    return value ? structuredClone(value) : null;
  }

  async getAuthoritativeWorldState(accountId, characterId) {
    const value = this.worldStates.get(`${accountId}\u0000${characterId}`);
    return value ? structuredClone(value) : null;
  }

  setAuthoritativeWorldState(state) {
    this.worldStates.set(`${state.accountId}\u0000${state.characterId}`, structuredClone(state));
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
