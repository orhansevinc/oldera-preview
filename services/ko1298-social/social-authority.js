'use strict';

const { OPCODES, CHAT_TYPES, PARTY_SUBOPCODES, LIMITS, PARTY_RESULT } = require('./constants');
const {
  ProtocolError, ensureBuffer, decodeClientPacket, encodeChatPacket, encodeChatTargetResult,
  encodePartyPermit, encodePartyInsertFailure, encodePartyMemberInsert, encodePartyRemove, encodePartyDelete,
} = require('./protocol');
const { KeyedMutex } = require('./locks');
const { partyOperations } = require('./party-operations');

function keyName(s) { return String(s).toLocaleLowerCase('en-US'); }
function outcome(ok, code, extra = {}) { return { ok, code, ...extra }; }

class SocialAuthority {
  constructor(options = {}) {
    this.sessions = new Map();
    this.sessionByCharacter = new Map();
    this.sessionByName = new Map();
    this.sessionBySid = new Map();
    this.privateTargets = new Map();
    this.parties = new Map();
    this.partyByCharacter = new Map();
    this.pendingInvites = new Map();
    this.nextPartyId = 1;
    this.sendPacket = options.sendPacket ?? (() => {});
    this.emitAction = options.emitAction ?? (() => {});
    this.nearbyCharacters = options.nearbyCharacters ?? (() => []);
    this.friendPort = options.friendPort ?? null;
    this.clanPort = options.clanPort ?? null;
    this.authorizeChat = options.authorizeChat ?? (() => true);
    this.authorizeShout = options.authorizeShout ?? (() => false);
    this.canPartyTogether = options.canPartyTogether ?? (() => true);
    this.lock = new KeyedMutex();
  }

  async registerSession(input) {
    if (!input || !input.sessionId || !input.characterId || !input.name) throw new TypeError('sessionId, characterId and name are required');
    const sessionId = String(input.sessionId), characterId = String(input.characterId), name = String(input.name);
    if (this.sessions.has(sessionId)) throw new Error('duplicate sessionId');
    const previous = this.sessionByCharacter.get(characterId);
    if (previous && previous.connected) throw new Error('character already has an active social session');
    const s = {
      sessionId, characterId, name, nameBytes: ensureBuffer(input.nameBytes ?? name), sid: Number(input.sid), nation: Number(input.nation),
      level: Number(input.level ?? 1), classId: Number(input.classId ?? 0), maxHp: Number(input.maxHp ?? 0), hp: Number(input.hp ?? 0),
      maxMp: Number(input.maxMp ?? 0), mp: Number(input.mp ?? 0), zoneId: Number(input.zoneId ?? 0), zoneEpoch: Number(input.zoneEpoch ?? 0),
      connected: true, context: input.context ?? null,
    };
    if (!Number.isInteger(s.sid) || s.sid < -32768 || s.sid > 32767) throw new TypeError('sid must fit int16');
    this.sessions.set(sessionId, s); this.sessionByCharacter.set(characterId, s); this.sessionByName.set(keyName(name), s); this.sessionBySid.set(s.sid, s);
    if (this.friendPort?.sessionOnline) await this.friendPort.sessionOnline({ characterId, sessionId, meta: { zoneId: s.zoneId } });
    if (this.clanPort?.setOnlineState) this.clanPort.setOnlineState(characterId, true);
    await this._presence(characterId, true);
    const party = this.getParty(characterId);
    if (party) await this._syncPartyTo(s, party);
    return s;
  }

  getSessionByCharacter(characterId) { return this.sessionByCharacter.get(String(characterId)) ?? null; }
  getParty(characterId) { const id = this.partyByCharacter.get(String(characterId)); return id == null ? null : this.parties.get(id) ?? null; }

  async updateZone(characterId, zoneId) {
    const s = this.getSessionByCharacter(characterId); if (!s) return outcome(false, 'SESSION_NOT_FOUND');
    s.zoneId = Number(zoneId); s.zoneEpoch += 1; return outcome(true, 'ZONE_UPDATED', { zoneEpoch: s.zoneEpoch });
  }

  async handlePacket(sessionId, packet) {
    const sender = this.sessions.get(String(sessionId));
    if (!sender?.connected) return outcome(false, 'SESSION_NOT_FOUND');
    let decoded;
    try { decoded = decodeClientPacket(packet); } catch (e) { if (e instanceof ProtocolError) return outcome(false, e.code); throw e; }
    if (decoded.opcode === OPCODES.OPERATOR) return outcome(false, 'PRIVILEGED_OPCODE_DENIED');
    if (decoded.opcode === OPCODES.FRIEND || decoded.opcode === OPCODES.KNIGHTS) return outcome(false, 'CLIENT_CODEC_NOT_VERIFIED');
    if (decoded.opcode === OPCODES.CHAT) return this._chat(sender, decoded.type, decoded.message);
    if (decoded.opcode === OPCODES.CHAT_TARGET) return this._selectPrivate(sender, decoded.name.toString('latin1'));
    if (decoded.opcode === OPCODES.PARTY) return this._partyPacket(sender, decoded);
    return outcome(false, 'UNSUPPORTED_SOCIAL_OPCODE');
  }

  async _chat(sender, type, message) {
    if ([CHAT_TYPES.GM, CHAT_TYPES.COMMAND, CHAT_TYPES.PUBLIC, CHAT_TYPES.WAR_SYSTEM, CHAT_TYPES.FORCE].includes(type)) return outcome(false, 'PRIVILEGED_CHAT_DENIED');
    if (![CHAT_TYPES.GENERAL, CHAT_TYPES.PRIVATE, CHAT_TYPES.PARTY, CHAT_TYPES.SHOUT, CHAT_TYPES.KNIGHTS].includes(type)) return outcome(false, 'UNSUPPORTED_CHAT_TYPE');
    if (!(await this.authorizeChat(sender, { type, message: Buffer.from(message) }))) return outcome(false, 'CHAT_POLICY_REJECTED');
    if (type === CHAT_TYPES.SHOUT && !(await this.authorizeShout(sender, { message: Buffer.from(message) }))) return outcome(false, 'SHOUT_RESOURCE_REJECTED');
    const text = Buffer.concat([sender.nameBytes, Buffer.from(' : ', 'ascii'), message]);
    const packet = encodeChatPacket({ type, nation: sender.nation, sid: sender.sid, text });
    let recipients = [];
    if (type === CHAT_TYPES.GENERAL || type === CHAT_TYPES.SHOUT) recipients = [sender.characterId, ...(await this.nearbyCharacters(sender, { shout: type === CHAT_TYPES.SHOUT }))];
    else if (type === CHAT_TYPES.PRIVATE) {
      const targetId = this.privateTargets.get(sender.characterId); const target = targetId && this.getSessionByCharacter(targetId);
      if (!target?.connected || target.characterId === sender.characterId) return outcome(false, 'INVALID_PRIVATE_TARGET');
      if (this.friendPort?.canPrivateMessage && !(await this.friendPort.canPrivateMessage(sender.characterId, target.characterId))) return outcome(false, 'PRIVATE_BLOCKED');
      recipients = [sender.characterId, target.characterId];
    } else if (type === CHAT_TYPES.PARTY) {
      const party = this.getParty(sender.characterId); if (!party) return outcome(false, 'NOT_IN_PARTY'); recipients = [...party.members];
    } else if (type === CHAT_TYPES.KNIGHTS) {
      if (!this.clanPort?.resolveMember || !this.clanPort?.listOnlineRecipients) return outcome(false, 'CLAN_PORT_REQUIRED');
      const membership = await this.clanPort.resolveMember(sender.characterId); if (!membership?.clanId) return outcome(false, 'NOT_IN_CLAN');
      recipients = await this.clanPort.listOnlineRecipients(membership.clanId);
    }
    let delivered = 0;
    for (const characterId of new Set(recipients.map(String))) { const target = this.getSessionByCharacter(characterId); if (target?.connected) { this.sendPacket(target.sessionId, packet, { kind: 'chat', type, from: sender.characterId }); delivered++; } }
    return outcome(true, 'CHAT_SENT', { delivered, type });
  }

  async _selectPrivate(sender, targetName) {
    const target = this.sessionByName.get(keyName(targetName));
    if (!target?.connected || target.characterId === sender.characterId || (this.friendPort?.canPrivateMessage && !(await this.friendPort.canPrivateMessage(sender.characterId, target.characterId)))) {
      this.privateTargets.delete(sender.characterId); this.sendPacket(sender.sessionId, encodeChatTargetResult(null), { kind: 'chat-target', found: false }); return outcome(false, 'INVALID_PRIVATE_TARGET');
    }
    this.privateTargets.set(sender.characterId, target.characterId); this.sendPacket(sender.sessionId, encodeChatTargetResult(target.nameBytes), { kind: 'chat-target', found: true, target: target.characterId });
    return outcome(true, 'PRIVATE_TARGET_SELECTED', { target: target.characterId });
  }

  async _partyPacket(sender, decoded) {
    if (decoded.subopcode === PARTY_SUBOPCODES.CREATE) return this.inviteParty(sender.characterId, decoded.name.toString('latin1'), true);
    if (decoded.subopcode === PARTY_SUBOPCODES.INSERT) return this.inviteParty(sender.characterId, decoded.name.toString('latin1'), false);
    if (decoded.subopcode === PARTY_SUBOPCODES.PERMIT) return this.answerPartyInvite(sender.characterId, decoded.accepted);
    if (decoded.subopcode === PARTY_SUBOPCODES.REMOVE) { const target = this.sessionBySid.get(decoded.memberSid); return target ? this.removePartyMember(sender.characterId, target.characterId) : outcome(false, 'PARTY_MEMBER_NOT_FOUND'); }
    if (decoded.subopcode === PARTY_SUBOPCODES.DELETE) return this.deleteParty(sender.characterId);
    return outcome(false, 'UNSUPPORTED_PARTY_SUBOPCODE');
  }

  async disconnectSession(sessionId, { leaseExpired = false } = {}) {
    const s = this.sessions.get(String(sessionId)); if (!s) return outcome(false, 'SESSION_NOT_FOUND'); s.connected = false;
    if (this.friendPort?.sessionOffline) await this.friendPort.sessionOffline({ characterId: s.characterId, sessionId: s.sessionId });
    if (this.clanPort?.setOnlineState) this.clanPort.setOnlineState(s.characterId, false);
    await this._presence(s.characterId, false);
    this.sessions.delete(s.sessionId); this.sessionBySid.delete(s.sid); this.sessionByName.delete(keyName(s.name));
    if (!leaseExpired) return outcome(true, 'SESSION_DISCONNECTED_GRACE', { partyPreserved: this.partyByCharacter.has(s.characterId) });
    return this.expireCharacter(s.characterId);
  }

  async expireCharacter(characterId) {
    characterId = String(characterId); this.privateTargets.delete(characterId); for (const [k,v] of this.privateTargets) if (v === characterId) this.privateTargets.delete(k);
    if (this.clanPort?.clearInvitesForCharacter) this.clanPort.clearInvitesForCharacter(characterId);
    const pending = this.pendingInvites.get(characterId); if (pending) { this.pendingInvites.delete(characterId); const p = this.parties.get(pending.partyId); if (p) this._cleanupLeaderOnlyParty(p); }
    for (const [target, invite] of [...this.pendingInvites]) if (invite.inviterId === characterId) this.pendingInvites.delete(target);
    const party = this.getParty(characterId); let result = outcome(true, 'CHARACTER_EXPIRED');
    if (party) {
      if (party.leaderId === characterId) result = this._dissolveParty(party, 'LEADER_LEASE_EXPIRED');
      else {
        party.members = party.members.filter((id) => id !== characterId); party.version += 1; this.partyByCharacter.delete(characterId);
        if (party.members.length <= 1) result = this._dissolveParty(party, 'ONLY_LEADER_REMAINS');
      }
    }
    this.sessionByCharacter.delete(characterId); return result;
  }

  async friendAction(actorId, action, targetId) {
    if (!this.friendPort) return outcome(false, 'FRIEND_PORT_REQUIRED');
    const actor = this.getSessionByCharacter(actorId); if (!actor?.connected) return outcome(false, 'SESSION_NOT_FOUND');
    const map = { request: 'requestFriend', accept: 'acceptFriend', reject: 'rejectFriend', remove: 'removeFriend', block: 'block', unblock: 'unblock', list: 'listFriends' };
    const method = map[action]; if (!method || typeof this.friendPort[method] !== 'function') return outcome(false, 'UNSUPPORTED_FRIEND_ACTION');
    if (action === 'request') return this.friendPort[method]({ fromId: actor.characterId, toId: String(targetId) });
    if (action === 'accept' || action === 'reject') return this.friendPort[method]({ userId: actor.characterId, fromId: String(targetId) });
    if (action === 'remove') return this.friendPort[method]({ userId: actor.characterId, friendId: String(targetId) });
    if (action === 'block' || action === 'unblock') return this.friendPort[method]({ userId: actor.characterId, targetId: String(targetId) });
    return this.friendPort[method](actor.characterId);
  }

  async clanAction(actorId, action, payload = {}) {
    if (!this.clanPort) return outcome(false, 'CLAN_PORT_REQUIRED');
    const actor = this.getSessionByCharacter(actorId); if (!actor?.connected) return outcome(false, 'SESSION_NOT_FOUND');
    const allowed = new Set(['createClan','invite','acceptInvite','rejectInvite','leave','kick','disband','appointChief','appointViceChief','appointOfficer','punish','listMembers']);
    if (!allowed.has(action) || typeof this.clanPort[action] !== 'function') return outcome(false, 'UNSUPPORTED_CLAN_ACTION');
    return this.clanPort[action]({ ...payload, actorId: actor.characterId, creatorId: actor.characterId, characterId: actor.characterId });
  }

  async _presence(characterId, online) { if (!this.friendPort?.listFriends) return; const list = await this.friendPort.listFriends(characterId); const friends = list?.friends ?? []; for (const f of friends) { const s = this.getSessionByCharacter(f.userId); if (s?.connected) this.emitAction(s.sessionId, { type: 'friend-presence', characterId: String(characterId), online }); } }
}

Object.assign(SocialAuthority.prototype, partyOperations);
module.exports = { SocialAuthority };
