'use strict';

const { idRangeForNation } = require('./rules');

function clone(value) {
  return value == null ? value : structuredClone(value);
}

class MemoryClanRepository {
  constructor({ characters = [], clans = [], memberships = [] } = {}) {
    this.characters = new Map(characters.map((item) => [item.id, clone(item)]));
    this.clans = new Map(clans.map((item) => [item.id, clone(item)]));
    this.memberships = new Map(memberships.map((item) => [item.characterId, clone(item)]));
  }

  async transaction(work) {
    const snapshot = {
      characters: clone(this.characters),
      clans: clone(this.clans),
      memberships: clone(this.memberships),
    };
    try {
      return await work(this);
    } catch (error) {
      this.characters = snapshot.characters;
      this.clans = snapshot.clans;
      this.memberships = snapshot.memberships;
      throw error;
    }
  }

  async getCharacter(id) {
    return clone(this.characters.get(id) ?? null);
  }

  async saveCharacter(character) {
    this.characters.set(character.id, clone(character));
    return clone(character);
  }

  async getClanById(id) {
    return clone(this.clans.get(id) ?? null);
  }

  async findClanByNameInsensitive(name) {
    const needle = name.toLocaleLowerCase('en-US');
    for (const clan of this.clans.values()) {
      if (clan.name.toLocaleLowerCase('en-US') === needle) return clone(clan);
    }
    return null;
  }

  async allocateClanId(nation) {
    const { min, max } = idRangeForNation(nation);
    let highest = min - 1;
    for (const clan of this.clans.values()) {
      if (clan.id >= min && clan.id <= max && clan.id > highest) highest = clan.id;
    }
    const next = highest + 1;
    return next <= max ? next : null;
  }

  async createClan(clan) {
    if (this.clans.has(clan.id)) throw new Error(`Clan ${clan.id} already exists.`);
    this.clans.set(clan.id, clone(clan));
    return clone(clan);
  }

  async saveClan(clan) {
    if (!this.clans.has(clan.id)) throw new Error(`Clan ${clan.id} does not exist.`);
    this.clans.set(clan.id, clone(clan));
    return clone(clan);
  }

  async deleteClan(id) {
    this.clans.delete(id);
  }

  async getMembershipByCharacter(characterId) {
    return clone(this.memberships.get(characterId) ?? null);
  }

  async listClanMembers(clanId) {
    const result = [];
    for (const membership of this.memberships.values()) {
      if (membership.clanId === clanId) result.push(clone(membership));
    }
    return result;
  }

  async addMembership(membership) {
    if (this.memberships.has(membership.characterId)) {
      throw new Error(`Character ${membership.characterId} already has a clan membership.`);
    }
    this.memberships.set(membership.characterId, clone(membership));
    return clone(membership);
  }

  async updateMembership(membership) {
    if (!this.memberships.has(membership.characterId)) {
      throw new Error(`Character ${membership.characterId} has no clan membership.`);
    }
    this.memberships.set(membership.characterId, clone(membership));
    return clone(membership);
  }

  async removeMembership(characterId) {
    this.memberships.delete(characterId);
  }
}

module.exports = { MemoryClanRepository };
