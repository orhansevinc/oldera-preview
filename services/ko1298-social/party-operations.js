
'use strict';

const { LIMITS, PARTY_RESULT } = require('./constants');
const {
  encodePartyPermit, encodePartyInsertFailure, encodePartyMemberInsert, encodePartyRemove, encodePartyDelete,
} = require('./protocol');

function outcome(ok, code, extra = {}) { return { ok, code, ...extra }; }
function keyName(s) { return String(s).toLocaleLowerCase('en-US'); }

const partyOperations = {
  async inviteParty(inviterId, targetName, create) {
    const inviter = this.getSessionByCharacter(inviterId), target = this.sessionByName.get(keyName(targetName));
    if (!inviter?.connected || !target?.connected || inviter.characterId === target?.characterId) return outcome(false, 'INVALID_PARTY_TARGET');
    return this.lock.run(`invite-target:${target.characterId}`, async () => {
      if (this.partyByCharacter.has(target.characterId) || this.pendingInvites.has(target.characterId)) return this._partyFail(inviter, PARTY_RESULT.GENERIC_FAILURE, 'PARTY_TARGET_BUSY');
      if (inviter.nation && target.nation && inviter.nation !== target.nation) return this._partyFail(inviter, PARTY_RESULT.NATION_MISMATCH, 'PARTY_NATION_MISMATCH');
      if ((await this.canPartyTogether(inviter, target)) !== true) return this._partyFail(inviter, PARTY_RESULT.GENERIC_FAILURE, 'PARTY_COMPATIBILITY_REJECTED');
      let party = this.getParty(inviter.characterId);
      if (create) {
        if (party) return this._partyFail(inviter, PARTY_RESULT.GENERIC_FAILURE, 'ALREADY_IN_PARTY');
        party = { id: this.nextPartyId++, leaderId: inviter.characterId, members: [inviter.characterId], version: 1 };
        this.parties.set(party.id, party); this.partyByCharacter.set(inviter.characterId, party.id);
      } else if (!party || party.leaderId !== inviter.characterId) return this._partyFail(inviter, PARTY_RESULT.GENERIC_FAILURE, party ? 'NOT_PARTY_LEADER' : 'NOT_IN_PARTY');
      const pending = [...this.pendingInvites.values()].filter((x) => x.partyId === party.id).length;
      if (party.members.length + pending >= LIMITS.MAX_PARTY_MEMBERS) return this._partyFail(inviter, PARTY_RESULT.GENERIC_FAILURE, 'PARTY_FULL');
      this.pendingInvites.set(target.characterId, { partyId: party.id, inviterId: inviter.characterId, partyVersion: party.version });
      this.sendPacket(target.sessionId, encodePartyPermit({ leaderSid: inviter.sid, leaderName: inviter.nameBytes }), { kind: 'party', action: 'permit', partyId: party.id });
      return outcome(true, 'PARTY_INVITE_SENT', { partyId: party.id });
    });
  },

  async answerPartyInvite(characterId, accepted) {
    const invitee = this.getSessionByCharacter(characterId); if (!invitee?.connected) return outcome(false, 'SESSION_NOT_FOUND');
    const pending = this.pendingInvites.get(invitee.characterId); if (!pending) return outcome(false, 'NO_PENDING_PARTY_INVITE');
    return this.lock.run(`party:${pending.partyId}`, async () => {
      const current = this.pendingInvites.get(invitee.characterId), party = current && this.parties.get(current.partyId);
      if (!current || !party || current.partyVersion !== party.version) { this.pendingInvites.delete(invitee.characterId); return outcome(false, 'STALE_PARTY_INVITE'); }
      if (!accepted) { this.pendingInvites.delete(invitee.characterId); this._cleanupLeaderOnlyParty(party); return outcome(true, 'PARTY_INVITE_REJECTED'); }
      if (this.partyByCharacter.has(invitee.characterId) || party.members.length >= LIMITS.MAX_PARTY_MEMBERS) { this.pendingInvites.delete(invitee.characterId); return outcome(false, 'PARTY_FULL_OR_BUSY'); }
      this.pendingInvites.delete(invitee.characterId); const existing = [...party.members]; party.members.push(invitee.characterId); party.version += 1; this.partyByCharacter.set(invitee.characterId, party.id);
      for (const id of existing) { const member = this.getSessionByCharacter(id); if (member?.connected) this.sendPacket(invitee.sessionId, encodePartyMemberInsert(member), { kind: 'party', action: 'insert-existing', partyId: party.id }); }
      const insert = encodePartyMemberInsert(invitee); for (const id of party.members) { const member = this.getSessionByCharacter(id); if (member?.connected) this.sendPacket(member.sessionId, insert, { kind: 'party', action: 'insert', partyId: party.id }); }
      return outcome(true, 'PARTY_INVITE_ACCEPTED', { partyId: party.id, size: party.members.length });
    });
  },

  async removePartyMember(actorId, targetId) {
    const party = this.getParty(actorId); if (!party) return outcome(false, 'NOT_IN_PARTY');
    return this.lock.run(`party:${party.id}`, async () => {
      if (!party.members.includes(String(targetId))) return outcome(false, 'PARTY_MEMBER_NOT_FOUND');
      if (String(actorId) !== String(targetId) && party.leaderId !== String(actorId)) return outcome(false, 'NOT_PARTY_LEADER');
      if (String(targetId) === party.leaderId) return this._dissolveParty(party, 'LEADER_LEFT');
      const target = this.getSessionByCharacter(targetId); party.members = party.members.filter((id) => id !== String(targetId)); party.version += 1; this.partyByCharacter.delete(String(targetId));
      if (target) { const packet = encodePartyRemove(target.sid); for (const id of party.members) { const m = this.getSessionByCharacter(id); if (m?.connected) this.sendPacket(m.sessionId, packet, { kind: 'party', action: 'remove', partyId: party.id }); } }
      if (party.members.length <= 1) return this._dissolveParty(party, 'ONLY_LEADER_REMAINS');
      return outcome(true, 'PARTY_MEMBER_REMOVED', { partyId: party.id, size: party.members.length });
    });
  },

  async deleteParty(actorId) {
    const party = this.getParty(actorId); if (!party) return outcome(false, 'NOT_IN_PARTY');
    if (party.leaderId !== String(actorId)) return outcome(false, 'NOT_PARTY_LEADER');
    return this.lock.run(`party:${party.id}`, () => this._dissolveParty(party, 'LEADER_DELETE'));
  },

  getPartyShareSnapshot(ownerCharacterId, { purpose, event, eligible } = {}) {
    const party = this.getParty(ownerCharacterId); if (!party) return { partyId: null, members: [String(ownerCharacterId)], purpose, event };
    const members = [];
    for (const id of party.members) { const s = this.getSessionByCharacter(id); if (!s?.connected) continue; if (eligible && !eligible(s, event)) continue; members.push({ characterId: id, level: s.level, zoneId: s.zoneId, context: s.context }); }
    return { partyId: party.id, partyVersion: party.version, members, purpose, event };
  },

  _partyFail(session, code, name) { this.sendPacket(session.sessionId, encodePartyInsertFailure(code), { kind: 'party', action: 'failure', code }); return outcome(false, name); },
  _cleanupLeaderOnlyParty(party) { const pending = [...this.pendingInvites.values()].some((x) => x.partyId === party.id); if (party.members.length === 1 && !pending) this._dissolveParty(party, 'EMPTY_INVITES'); },
  _dissolveParty(party, reason) { const packet = encodePartyDelete(); for (const id of party.members) { this.partyByCharacter.delete(id); const s = this.getSessionByCharacter(id); if (s?.connected) this.sendPacket(s.sessionId, packet, { kind: 'party', action: 'delete', partyId: party.id, reason }); } for (const [target, invite] of [...this.pendingInvites]) if (invite.partyId === party.id) this.pendingInvites.delete(target); this.parties.delete(party.id); return outcome(true, 'PARTY_DELETED', { partyId: party.id, reason }); },
  async _syncPartyTo(session, party) { for (const id of party.members) { const m = this.getSessionByCharacter(id); if (m?.connected) this.sendPacket(session.sessionId, encodePartyMemberInsert(m), { kind: 'party', action: 'resync', partyId: party.id }); } },
};

module.exports = { partyOperations };
