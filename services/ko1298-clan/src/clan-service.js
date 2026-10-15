'use strict';

const { ClanLimits, ClanRole, ROLE_TO_DUTY } = require('./constants');
const { ClanError, ErrorCode } = require('./errors');
const { assertClanRepository } = require('./repository');
const { assertNation, validateClanName, calculateClanGrade } = require('./rules');

const ROLE_ORDER = new Map([
  [ClanRole.CHIEF, 0],
  [ClanRole.VICE_CHIEF, 1],
  [ClanRole.OFFICER, 2],
  [ClanRole.KNIGHT, 3],
  [ClanRole.TRAINEE, 4],
  [ClanRole.PUNISH, 5],
]);

class ClanService {
  constructor({ repository, clock = () => new Date() }) {
    this.repository = assertClanRepository(repository);
    this.clock = clock;
    this.onlineMembers = new Set();
    this.pendingInvites = new Map();
  }

  async createClan({ creatorId, name }) {
    validateClanName(name);

    return this.repository.transaction(async (tx) => {
      const creator = await this.#requireCharacter(tx, creatorId);
      assertNation(creator.nation);
      await this.#assertNotInClan(tx, creatorId);

      if (!Number.isInteger(creator.level) || creator.level < ClanLimits.CREATION_MIN_LEVEL) {
        throw new ClanError(ErrorCode.LOW_LEVEL, `Clan creation requires level ${ClanLimits.CREATION_MIN_LEVEL}.`);
      }
      if (!Number.isSafeInteger(creator.noah) || creator.noah < ClanLimits.CREATION_NOAH_COST) {
        throw new ClanError(ErrorCode.LOW_NOAH, `Clan creation requires ${ClanLimits.CREATION_NOAH_COST} Noah.`);
      }
      if (await tx.findClanByNameInsensitive(name)) {
        throw new ClanError(ErrorCode.DUPLICATE_CLAN_NAME, 'Clan name already exists.');
      }

      const clanId = await tx.allocateClanId(creator.nation);
      if (clanId == null) {
        throw new ClanError(ErrorCode.CLAN_ID_EXHAUSTED, 'No clan ID is available for this nation.');
      }

      const now = this.clock().toISOString();
      const clan = {
        id: clanId,
        name,
        nation: creator.nation,
        type: 'clan',
        chiefCharacterId: creatorId,
        memberCount: 1,
        nationalPoints: 0,
        grade: 5,
        ranking: 0,
        createdAt: now,
        updatedAt: now,
      };
      await tx.createClan(clan);
      await tx.addMembership({
        clanId,
        characterId: creatorId,
        characterName: creator.name,
        role: ClanRole.CHIEF,
        joinedAt: now,
      });
      await tx.saveCharacter({ ...creator, noah: creator.noah - ClanLimits.CREATION_NOAH_COST });

      return this.#publicClan(clan);
    });
  }

  async invite({ actorId, targetId }) {
    if (actorId === targetId) throw new ClanError(ErrorCode.SELF_TARGET, 'Cannot invite yourself.');

    const actorMembership = await this.#requireMembership(this.repository, actorId);
    if (actorMembership.role !== ClanRole.CHIEF && actorMembership.role !== ClanRole.VICE_CHIEF) {
      throw new ClanError(ErrorCode.INVALID_RIGHT, 'Only the chief or vice-chief can invite a member in the 1298 flow.');
    }

    const clan = await this.#requireClan(this.repository, actorMembership.clanId);
    const target = await this.#requireCharacter(this.repository, targetId, ErrorCode.TARGET_NOT_FOUND);
    if (!this.onlineMembers.has(targetId)) {
      throw new ClanError(ErrorCode.TARGET_OFFLINE, 'The invited character must be online.');
    }
    if (target.dead === true) {
      throw new ClanError(ErrorCode.TARGET_DEAD, 'A dead character cannot be invited.');
    }
    if (target.nation !== clan.nation) {
      throw new ClanError(ErrorCode.ENEMY_NATION, 'Cross-nation clan membership is not allowed.');
    }
    if (await this.repository.getMembershipByCharacter(targetId)) {
      throw new ClanError(ErrorCode.OTHER_CLAN_USER, 'Target character already belongs to a clan.');
    }

    await this.#assertClanCapacity(this.repository, clan.id);
    const invite = {
      clanId: clan.id,
      inviterId: actorId,
      targetId,
      createdAt: this.clock().toISOString(),
    };
    this.pendingInvites.set(targetId, invite);
    return { ...invite, clanName: clan.name };
  }

  async acceptInvite({ characterId, clanId = undefined }) {
    const invite = this.pendingInvites.get(characterId);
    if (!invite) throw new ClanError(ErrorCode.INVITE_NOT_FOUND, 'No pending clan invite exists.');
    if (clanId != null && clanId !== invite.clanId) {
      throw new ClanError(ErrorCode.INVITE_CLAN_MISMATCH, 'Invite does not belong to the requested clan.');
    }

    const membership = await this.repository.transaction(async (tx) => {
      const character = await this.#requireCharacter(tx, characterId);
      await this.#assertNotInClan(tx, characterId);
      const clan = await this.#requireClan(tx, invite.clanId);
      if (character.nation !== clan.nation) {
        throw new ClanError(ErrorCode.ENEMY_NATION, 'Cross-nation clan membership is not allowed.');
      }
      await this.#assertClanCapacity(tx, clan.id);

      const now = this.clock().toISOString();
      const created = {
        clanId: clan.id,
        characterId,
        characterName: character.name,
        role: ClanRole.KNIGHT,
        joinedAt: now,
      };
      await tx.addMembership(created);
      await tx.saveClan({ ...clan, memberCount: clan.memberCount + 1, updatedAt: now });
      return created;
    });

    this.pendingInvites.delete(characterId);
    return this.#publicMembership(membership);
  }

  async rejectInvite({ characterId }) {
    const invite = this.pendingInvites.get(characterId);
    if (!invite) throw new ClanError(ErrorCode.INVITE_NOT_FOUND, 'No pending clan invite exists.');
    this.pendingInvites.delete(characterId);
    return { rejected: true, clanId: invite.clanId, inviterId: invite.inviterId };
  }

  async leave({ characterId }) {
    const membership = await this.#requireMembership(this.repository, characterId);
    if (membership.role === ClanRole.CHIEF) {
      return this.disband({ actorId: characterId });
    }

    return this.repository.transaction(async (tx) => {
      const current = await this.#requireMembership(tx, characterId);
      const clan = await this.#requireClan(tx, current.clanId);
      await tx.removeMembership(characterId);
      await tx.saveClan({
        ...clan,
        memberCount: Math.max(0, clan.memberCount - 1),
        updatedAt: this.clock().toISOString(),
      });
      this.pendingInvites.delete(characterId);
      return { left: true, clanId: clan.id, characterId };
    });
  }

  async kick({ actorId, targetId }) {
    if (actorId === targetId) throw new ClanError(ErrorCode.SELF_TARGET, 'Chief cannot kick themselves.');

    return this.repository.transaction(async (tx) => {
      const actor = await this.#requireMembership(tx, actorId);
      if (actor.role !== ClanRole.CHIEF) {
        throw new ClanError(ErrorCode.INVALID_RIGHT, 'Only the chief can remove a clan member.');
      }
      const target = await this.#requireMembership(tx, targetId);
      if (target.clanId !== actor.clanId) {
        throw new ClanError(ErrorCode.MEMBER_NOT_FOUND, 'Target is not a member of the same clan.');
      }
      if (target.role === ClanRole.CHIEF) {
        throw new ClanError(ErrorCode.INVALID_ROLE_CHANGE, 'The chief cannot be removed by kick.');
      }

      const clan = await this.#requireClan(tx, actor.clanId);
      await tx.removeMembership(targetId);
      await tx.saveClan({
        ...clan,
        memberCount: Math.max(0, clan.memberCount - 1),
        updatedAt: this.clock().toISOString(),
      });
      this.onlineMembers.delete(targetId);
      this.pendingInvites.delete(targetId);
      return { kicked: true, clanId: clan.id, characterId: targetId };
    });
  }

  async disband({ actorId }) {
    const result = await this.repository.transaction(async (tx) => {
      const actor = await this.#requireMembership(tx, actorId);
      if (actor.role !== ClanRole.CHIEF) {
        throw new ClanError(ErrorCode.INVALID_RIGHT, 'Only the chief can disband the clan.');
      }
      const clan = await this.#requireClan(tx, actor.clanId);
      const members = await tx.listClanMembers(clan.id);
      for (const member of members) await tx.removeMembership(member.characterId);
      await tx.deleteClan(clan.id);
      return { disbanded: true, clanId: clan.id, memberIds: members.map((item) => item.characterId) };
    });

    for (const id of result.memberIds) this.onlineMembers.delete(id);
    for (const [targetId, invite] of this.pendingInvites.entries()) {
      if (invite.clanId === result.clanId) this.pendingInvites.delete(targetId);
    }
    return result;
  }

  async appointViceChief({ actorId, targetId }) {
    return this.#changeRole({
      actorId,
      targetId,
      requiredActorRoles: [ClanRole.CHIEF],
      newRole: ClanRole.VICE_CHIEF,
      validate: async (tx, actor, target) => {
        const members = await tx.listClanMembers(actor.clanId);
        const count = members.filter((member) => member.role === ClanRole.VICE_CHIEF && member.characterId !== target.characterId).length;
        if (count >= ClanLimits.MAX_VICE_CHIEFS) {
          throw new ClanError(ErrorCode.VICE_CHIEF_LIMIT, `1298 clan layout supports at most ${ClanLimits.MAX_VICE_CHIEFS} vice-chiefs.`);
        }
      },
    });
  }

  async appointOfficer({ actorId, targetId }) {
    return this.#changeRole({
      actorId,
      targetId,
      requiredActorRoles: [ClanRole.CHIEF],
      newRole: ClanRole.OFFICER,
    });
  }

  async punishMember({ actorId, targetId }) {
    return this.#changeRole({
      actorId,
      targetId,
      requiredActorRoles: [ClanRole.CHIEF, ClanRole.VICE_CHIEF],
      newRole: ClanRole.PUNISH,
    });
  }

  async transferChief({ actorId, targetId }) {
    if (actorId === targetId) throw new ClanError(ErrorCode.SELF_TARGET, 'Target is already the chief.');

    return this.repository.transaction(async (tx) => {
      const actor = await this.#requireMembership(tx, actorId);
      if (actor.role !== ClanRole.CHIEF) {
        throw new ClanError(ErrorCode.INVALID_RIGHT, 'Only the current chief can appoint a new chief.');
      }
      const target = await this.#requireMembership(tx, targetId);
      if (target.clanId !== actor.clanId) {
        throw new ClanError(ErrorCode.MEMBER_NOT_FOUND, 'Target is not a member of the same clan.');
      }

      const now = this.clock().toISOString();
      await tx.updateMembership({ ...actor, role: ClanRole.KNIGHT });
      await tx.updateMembership({ ...target, role: ClanRole.CHIEF });
      const clan = await this.#requireClan(tx, actor.clanId);
      await tx.saveClan({ ...clan, chiefCharacterId: targetId, updatedAt: now });
      return this.#publicMembership({ ...target, role: ClanRole.CHIEF });
    });
  }

  async recalculateGrade({ clanId, totalNationalPoints }) {
    const grade = calculateClanGrade(totalNationalPoints);
    return this.repository.transaction(async (tx) => {
      const clan = await this.#requireClan(tx, clanId);
      const updated = {
        ...clan,
        nationalPoints: totalNationalPoints,
        grade,
        updatedAt: this.clock().toISOString(),
      };
      await tx.saveClan(updated);
      return this.#publicClan(updated);
    });
  }

  async applyRanking({ clanId, ranking }) {
    if (!Number.isInteger(ranking) || ranking < 0) throw new TypeError('ranking must be a non-negative integer.');
    return this.repository.transaction(async (tx) => {
      const clan = await this.#requireClan(tx, clanId);
      const updated = { ...clan, ranking, updatedAt: this.clock().toISOString() };
      await tx.saveClan(updated);
      return this.#publicClan(updated);
    });
  }

  setOnlineState(characterId, online) {
    if (online) this.onlineMembers.add(characterId);
    else this.onlineMembers.delete(characterId);
  }

  clearInvitesForCharacter(characterId) {
    this.pendingInvites.delete(characterId);
    for (const [targetId, invite] of this.pendingInvites.entries()) {
      if (invite.inviterId === characterId) this.pendingInvites.delete(targetId);
    }
  }

  async listMembers({ requesterId, onlineOnly = false }) {
    const requester = await this.#requireMembership(this.repository, requesterId);
    const members = await this.repository.listClanMembers(requester.clanId);
    const filtered = onlineOnly ? members.filter((item) => this.onlineMembers.has(item.characterId)) : members;
    return filtered
      .map((item) => this.#publicMembership(item))
      .sort((a, b) => (ROLE_ORDER.get(a.role) - ROLE_ORDER.get(b.role)) || a.characterName.localeCompare(b.characterName));
  }

  async listOnlineMemberIds(clanId) {
    const clan = await this.#requireClan(this.repository, clanId);
    const members = await this.repository.listClanMembers(clan.id);
    return members.filter((member) => this.onlineMembers.has(member.characterId)).map((member) => member.characterId);
  }

  async getClanContextForCharacter(characterId) {
    const membership = await this.repository.getMembershipByCharacter(characterId);
    if (!membership) return null;
    const clan = await this.repository.getClanById(membership.clanId);
    if (!clan) return null;
    return {
      clanId: clan.id,
      clanName: clan.name,
      nation: clan.nation,
      role: membership.role,
      duty: ROLE_TO_DUTY[membership.role],
    };
  }

  async getClanById(clanId) {
    const clan = await this.#requireClan(this.repository, clanId);
    return this.#publicClan(clan);
  }

  async #changeRole({ actorId, targetId, requiredActorRoles, newRole, validate = null }) {
    if (actorId === targetId) throw new ClanError(ErrorCode.SELF_TARGET, 'Cannot change your own clan role with this operation.');
    return this.repository.transaction(async (tx) => {
      const actor = await this.#requireMembership(tx, actorId);
      if (!requiredActorRoles.includes(actor.role)) {
        throw new ClanError(ErrorCode.INVALID_RIGHT, 'Clan role does not have permission for this operation.');
      }
      const target = await this.#requireMembership(tx, targetId);
      if (target.clanId !== actor.clanId) {
        throw new ClanError(ErrorCode.MEMBER_NOT_FOUND, 'Target is not a member of the same clan.');
      }
      if (target.role === ClanRole.CHIEF) {
        throw new ClanError(ErrorCode.INVALID_ROLE_CHANGE, 'The chief role cannot be changed by this operation.');
      }
      if (validate) await validate(tx, actor, target);
      const updated = { ...target, role: newRole };
      await tx.updateMembership(updated);
      return this.#publicMembership(updated);
    });
  }

  async #assertClanCapacity(repository, clanId) {
    const members = await repository.listClanMembers(clanId);
    if (members.length >= ClanLimits.MAX_MEMBERS) {
      throw new ClanError(ErrorCode.CLAN_FULL, `Clan is full (${ClanLimits.MAX_MEMBERS} members).`);
    }
  }

  async #assertNotInClan(repository, characterId) {
    if (await repository.getMembershipByCharacter(characterId)) {
      throw new ClanError(ErrorCode.ALREADY_IN_CLAN, 'Character already belongs to a clan.');
    }
  }

  async #requireCharacter(repository, characterId, code = ErrorCode.CHARACTER_NOT_FOUND) {
    const character = await repository.getCharacter(characterId);
    if (!character) throw new ClanError(code, `Character not found: ${characterId}`);
    return character;
  }

  async #requireClan(repository, clanId) {
    const clan = await repository.getClanById(clanId);
    if (!clan) throw new ClanError(ErrorCode.CLAN_NOT_FOUND, `Clan not found: ${clanId}`);
    return clan;
  }

  async #requireMembership(repository, characterId) {
    const membership = await repository.getMembershipByCharacter(characterId);
    if (!membership) throw new ClanError(ErrorCode.NOT_IN_CLAN, `Character is not in a clan: ${characterId}`);
    return membership;
  }

  #publicMembership(membership) {
    return {
      clanId: membership.clanId,
      characterId: membership.characterId,
      characterName: membership.characterName,
      role: membership.role,
      duty: ROLE_TO_DUTY[membership.role],
      online: this.onlineMembers.has(membership.characterId),
      joinedAt: membership.joinedAt,
    };
  }

  #publicClan(clan) {
    return {
      id: clan.id,
      name: clan.name,
      nation: clan.nation,
      type: clan.type,
      chiefCharacterId: clan.chiefCharacterId,
      memberCount: clan.memberCount,
      nationalPoints: clan.nationalPoints,
      grade: clan.grade,
      ranking: clan.ranking,
      createdAt: clan.createdAt,
      updatedAt: clan.updatedAt,
    };
  }
}

module.exports = { ClanService };
