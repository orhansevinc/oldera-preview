'use strict';

const {
  OPCODES,
  CHAT_TYPES,
  PARTY_SUBOPCODES,
  LIMITS,
  PARTY_RESULT,
} = require('./constants');
const {
  ProtocolError,
  ensureBuffer,
  decodeClientPacket,
  encodeChatPacket,
  encodeChatTargetResult,
  encodePartyPermit,
  encodePartyInsertFailure,
  encodePartyMemberInsert,
  encodePartyRemove,
  encodePartyDelete,
} = require('./protocol');

function legacyString(bytes) {
  return ensureBuffer(bytes).toString('latin1');
}

function keyName(name) {
  return String(name).toLocaleLowerCase('en-US');
}

function outcome(ok, code, extra = {}) {
  return { ok, code, ...extra };
}

class SocialService {
  constructor(options = {}) {
    this.sessions = new Map();
    this.sessionsBySid = new Map();
    this.sessionsByName = new Map();
    this.privateTargets = new Map();
    this.parties = new Map();
    this.pendingInvites = new Map();
    this.nextPartyId = 1;

    this.send = options.send ?? (() => {});
    this.nearbyRecipients = options.nearbyRecipients ?? ((session) => [session.sessionId]);
    this.allowChat = options.allowChat ?? (() => true);
    this.canPartyTogether = options.canPartyTogether ?? (() => true);
  }

  registerSession(input) {
    if (!input || typeof input !== 'object') throw new TypeError('session is required');
    const sessionId = String(input.sessionId ?? '');
    const name = String(input.name ?? '');
    const nameBytes = ensureBuffer(input.nameBytes ?? name, 'session.name');
    const sid = input.sid;

    if (!sessionId) throw new TypeError('sessionId is required');
    if (!Number.isInteger(sid) || sid < -0x8000 || sid > 0x7fff) throw new TypeError('sid must fit int16');
    if (!name || nameBytes.length < 1 || nameBytes.length > LIMITS.MAX_NAME_BYTES) {
      throw new TypeError('name must be 1..30 legacy bytes');
    }
    if (this.sessions.has(sessionId)) throw new Error('duplicate sessionId');
    if (this.sessionsBySid.has(sid)) throw new Error('duplicate sid');
    if (this.sessionsByName.has(keyName(name))) throw new Error('duplicate character name');

    const session = {
      sessionId,
      sid,
      name,
      nameBytes,
      nation: input.nation ?? 0,
      level: input.level ?? 1,
      classId: input.classId ?? 0,
      maxHp: input.maxHp ?? 0,
      hp: input.hp ?? 0,
      maxMp: input.maxMp ?? 0,
      mp: input.mp ?? 0,
      partyId: null,
      connected: true,
      context: input.context,
    };

    this.sessions.set(sessionId, session);
    this.sessionsBySid.set(sid, session);
    this.sessionsByName.set(keyName(name), session);
    return session;
  }

  getSession(sessionId) {
    return this.sessions.get(String(sessionId)) ?? null;
  }

  getPartyForSession(sessionId) {
    const session = this.getSession(sessionId);
    if (!session || session.partyId == null) return null;
    return this.parties.get(session.partyId) ?? null;
  }

  handlePacket(sessionId, packet) {
    const sender = this.getSession(sessionId);
    if (!sender || !sender.connected) return outcome(false, 'SESSION_NOT_FOUND');

    let decoded;
    try {
      decoded = decodeClientPacket(packet);
    } catch (error) {
      if (error instanceof ProtocolError) return outcome(false, error.code);
      throw error;
    }

    if (decoded.opcode === OPCODES.CHAT) return this._handleChat(sender, decoded.type, decoded.message);
    if (decoded.opcode === OPCODES.CHAT_TARGET) return this._selectPrivateTarget(sender, legacyString(decoded.name));
    if (decoded.opcode === OPCODES.PARTY) return this._handleParty(sender, decoded);
    return outcome(false, 'UNSUPPORTED_OPCODE');
  }

  _handleChat(sender, type, message) {
    if (![CHAT_TYPES.GENERAL, CHAT_TYPES.PRIVATE, CHAT_TYPES.PARTY].includes(type)) {
      return outcome(false, 'UNSUPPORTED_CHAT_TYPE');
    }

    const allowed = this.allowChat(sender, { type, message: Buffer.from(message) });
    if (!allowed) return outcome(false, 'FLOOD_REJECTED');

    const text = Buffer.concat([sender.nameBytes, Buffer.from(' : ', 'ascii'), message]);
    const packet = encodeChatPacket({ type, nation: sender.nation, sid: sender.sid, text });

    if (type === CHAT_TYPES.GENERAL) {
      const recipients = new Set([sender.sessionId]);
      const nearby = this.nearbyRecipients(sender) ?? [];
      for (const id of nearby) recipients.add(String(id));
      let delivered = 0;
      for (const id of recipients) {
        if (this._deliver(id, packet, { kind: 'chat', type: 'general', from: sender.sessionId })) delivered++;
      }
      return outcome(true, 'GENERAL_CHAT_SENT', { delivered });
    }

    if (type === CHAT_TYPES.PRIVATE) {
      const targetId = this.privateTargets.get(sender.sessionId);
      const target = targetId ? this.getSession(targetId) : null;
      if (!target || !target.connected || target.sessionId === sender.sessionId) {
        return outcome(false, 'INVALID_PRIVATE_TARGET');
      }
      let delivered = 0;
      if (this._deliver(target.sessionId, packet, { kind: 'chat', type: 'private', from: sender.sessionId })) delivered++;
      if (this._deliver(sender.sessionId, packet, { kind: 'chat', type: 'private', from: sender.sessionId })) delivered++;
      return outcome(true, 'PRIVATE_CHAT_SENT', { delivered });
    }

    const party = this.getPartyForSession(sender.sessionId);
    if (!party) return outcome(false, 'NOT_IN_PARTY');
    let delivered = 0;
    for (const memberId of party.members) {
      if (this._deliver(memberId, packet, { kind: 'chat', type: 'party', from: sender.sessionId, partyId: party.id })) {
        delivered++;
      }
    }
    return outcome(true, 'PARTY_CHAT_SENT', { delivered });
  }

  _selectPrivateTarget(sender, targetName) {
    const target = this.sessionsByName.get(keyName(targetName));
    if (!target || !target.connected || target.sessionId === sender.sessionId) {
      this.privateTargets.delete(sender.sessionId);
      this._deliver(sender.sessionId, encodeChatTargetResult(null), { kind: 'chat-target', found: false });
      return outcome(false, 'INVALID_PRIVATE_TARGET');
    }

    this.privateTargets.set(sender.sessionId, target.sessionId);
    this._deliver(sender.sessionId, encodeChatTargetResult(target.nameBytes), {
      kind: 'chat-target',
      found: true,
      target: target.sessionId,
    });
    return outcome(true, 'PRIVATE_TARGET_SELECTED', { target: target.sessionId });
  }

  _handleParty(sender, decoded) {
    if (decoded.subopcode === PARTY_SUBOPCODES.CREATE) {
      return this._requestParty(sender, legacyString(decoded.name), true);
    }
    if (decoded.subopcode === PARTY_SUBOPCODES.INSERT) {
      return this._requestParty(sender, legacyString(decoded.name), false);
    }
    if (decoded.subopcode === PARTY_SUBOPCODES.PERMIT) {
      return this._answerInvite(sender, decoded.accepted);
    }
    if (decoded.subopcode === PARTY_SUBOPCODES.REMOVE) {
      return this._removePartyMember(sender, decoded.memberSid);
    }
    if (decoded.subopcode === PARTY_SUBOPCODES.DELETE) {
      return this._deleteParty(sender);
    }
    return outcome(false, 'UNSUPPORTED_PARTY_SUBOPCODE');
  }

  _requestParty(inviter, targetName, create) {
    const target = this.sessionsByName.get(keyName(targetName));
    if (!target || !target.connected || target.sessionId === inviter.sessionId) {
      this._partyFailure(inviter, PARTY_RESULT.GENERIC_FAILURE, 'invalid-target');
      return outcome(false, 'INVALID_PARTY_TARGET');
    }
    if (target.partyId != null || this.pendingInvites.has(target.sessionId)) {
      this._partyFailure(inviter, PARTY_RESULT.GENERIC_FAILURE, 'target-busy');
      return outcome(false, 'PARTY_TARGET_BUSY');
    }
    if (inviter.nation && target.nation && inviter.nation !== target.nation) {
      this._partyFailure(inviter, PARTY_RESULT.NATION_MISMATCH, 'nation-mismatch');
      return outcome(false, 'PARTY_NATION_MISMATCH');
    }

    const compatibility = this.canPartyTogether(inviter, target);
    if (compatibility !== true) {
      const code = Number.isInteger(compatibility) ? compatibility : PARTY_RESULT.GENERIC_FAILURE;
      this._partyFailure(inviter, code, 'compatibility-rejected');
      return outcome(false, 'PARTY_COMPATIBILITY_REJECTED');
    }

    let party;
    if (create) {
      if (inviter.partyId != null) {
        this._partyFailure(inviter, PARTY_RESULT.GENERIC_FAILURE, 'already-in-party');
        return outcome(false, 'ALREADY_IN_PARTY');
      }
      party = this._createParty(inviter);
    } else {
      party = this.getPartyForSession(inviter.sessionId);
      if (!party) {
        this._partyFailure(inviter, PARTY_RESULT.GENERIC_FAILURE, 'no-party');
        return outcome(false, 'NOT_IN_PARTY');
      }
      if (party.leaderId !== inviter.sessionId) {
        this._partyFailure(inviter, PARTY_RESULT.GENERIC_FAILURE, 'not-leader');
        return outcome(false, 'NOT_PARTY_LEADER');
      }
    }

    const pendingForParty = this._pendingCount(party.id);
    if (party.members.length + pendingForParty >= LIMITS.MAX_PARTY_MEMBERS) {
      if (create) this._dissolveParty(party, { notify: false });
      this._partyFailure(inviter, PARTY_RESULT.GENERIC_FAILURE, 'party-full');
      return outcome(false, 'PARTY_FULL');
    }

    this.pendingInvites.set(target.sessionId, {
      partyId: party.id,
      inviterId: inviter.sessionId,
      createdParty: create,
    });
    this._deliver(target.sessionId, encodePartyPermit({ leaderSid: inviter.sid, leaderName: inviter.nameBytes }), {
      kind: 'party',
      action: 'permit',
      inviter: inviter.sessionId,
      partyId: party.id,
    });
    return outcome(true, create ? 'PARTY_CREATED_INVITE_SENT' : 'PARTY_INVITE_SENT', { partyId: party.id });
  }

  _answerInvite(invitee, accepted) {
    const pending = this.pendingInvites.get(invitee.sessionId);
    if (!pending) return outcome(false, 'NO_PENDING_PARTY_INVITE');
    const party = this.parties.get(pending.partyId);
    const inviter = this.getSession(pending.inviterId);

    if (!party || !inviter || !inviter.connected || party.leaderId !== inviter.sessionId) {
      this.pendingInvites.delete(invitee.sessionId);
      return outcome(false, 'STALE_PARTY_INVITE');
    }

    if (!accepted) {
      this._cancelInvite(invitee.sessionId, true);
      return outcome(true, 'PARTY_INVITE_REJECTED');
    }

    if (invitee.partyId != null || party.members.length >= LIMITS.MAX_PARTY_MEMBERS) {
      this._cancelInvite(invitee.sessionId, true);
      return outcome(false, 'PARTY_FULL_OR_BUSY');
    }

    this.pendingInvites.delete(invitee.sessionId);
    const existingIds = [...party.members];
    invitee.partyId = party.id;
    party.members.push(invitee.sessionId);

    for (const existingId of existingIds) {
      const existing = this.getSession(existingId);
      if (existing) {
        this._deliver(invitee.sessionId, encodePartyMemberInsert(existing), {
          kind: 'party',
          action: 'insert-existing',
          partyId: party.id,
          member: existing.sessionId,
        });
      }
    }

    const newMemberPacket = encodePartyMemberInsert(invitee);
    for (const memberId of party.members) {
      this._deliver(memberId, newMemberPacket, {
        kind: 'party',
        action: 'insert',
        partyId: party.id,
        member: invitee.sessionId,
      });
    }

    return outcome(true, 'PARTY_INVITE_ACCEPTED', { partyId: party.id, size: party.members.length });
  }

  _removePartyMember(requester, memberSid) {
    const party = this.getPartyForSession(requester.sessionId);
    if (!party) return outcome(false, 'NOT_IN_PARTY');
    const target = this.sessionsBySid.get(memberSid);
    if (!target || target.partyId !== party.id) return outcome(false, 'PARTY_MEMBER_NOT_FOUND');

    if (target.sessionId !== requester.sessionId && party.leaderId !== requester.sessionId) {
      return outcome(false, 'NOT_PARTY_LEADER');
    }

    if (target.sessionId === party.leaderId) {
      this._dissolveParty(party, { notify: true });
      return outcome(true, 'PARTY_DELETED');
    }

    const removePacket = encodePartyRemove(target.sid);
    for (const memberId of party.members) {
      this._deliver(memberId, removePacket, {
        kind: 'party',
        action: 'remove',
        partyId: party.id,
        member: target.sessionId,
      });
    }

    party.members = party.members.filter((id) => id !== target.sessionId);
    target.partyId = null;

    if (party.members.length <= 1) {
      this._dissolveParty(party, { notify: true });
      return outcome(true, 'PARTY_MEMBER_REMOVED_AND_PARTY_DELETED');
    }
    return outcome(true, 'PARTY_MEMBER_REMOVED', { size: party.members.length });
  }

  _deleteParty(requester) {
    const party = this.getPartyForSession(requester.sessionId);
    if (!party) return outcome(false, 'NOT_IN_PARTY');
    if (party.leaderId !== requester.sessionId) return outcome(false, 'NOT_PARTY_LEADER');
    this._dissolveParty(party, { notify: true });
    return outcome(true, 'PARTY_DELETED');
  }

  disconnect(sessionId) {
    const session = this.getSession(sessionId);
    if (!session) return outcome(false, 'SESSION_NOT_FOUND');
    session.connected = false;

    if (this.pendingInvites.has(session.sessionId)) this._cancelInvite(session.sessionId, true);

    const party = this.getPartyForSession(session.sessionId);
    if (party) {
      if (party.leaderId === session.sessionId) {
        this._dissolveParty(party, { notify: true });
      } else {
        this._removePartyMember(session, session.sid);
      }
    }

    this.privateTargets.delete(session.sessionId);
    for (const [sourceId, targetId] of this.privateTargets.entries()) {
      if (targetId === session.sessionId) this.privateTargets.delete(sourceId);
    }

    this.sessions.delete(session.sessionId);
    this.sessionsBySid.delete(session.sid);
    this.sessionsByName.delete(keyName(session.name));
    return outcome(true, 'SESSION_DISCONNECTED');
  }

  _createParty(leader) {
    const party = { id: this.nextPartyId++, leaderId: leader.sessionId, members: [leader.sessionId] };
    this.parties.set(party.id, party);
    leader.partyId = party.id;
    return party;
  }

  _cancelInvite(inviteeId, notifyInviter) {
    const pending = this.pendingInvites.get(inviteeId);
    if (!pending) return;
    this.pendingInvites.delete(inviteeId);
    const party = this.parties.get(pending.partyId);
    const inviter = this.getSession(pending.inviterId);
    if (notifyInviter && inviter) this._partyFailure(inviter, PARTY_RESULT.GENERIC_FAILURE, 'invite-rejected');

    if (party && pending.createdParty && party.members.length === 1 && this._pendingCount(party.id) === 0) {
      this._dissolveParty(party, { notify: false });
    }
  }

  _dissolveParty(party, { notify }) {
    if (!party || !this.parties.has(party.id)) return;
    const packet = encodePartyDelete();
    for (const memberId of party.members) {
      const member = this.getSession(memberId);
      if (member) {
        member.partyId = null;
        if (notify) this._deliver(memberId, packet, { kind: 'party', action: 'delete', partyId: party.id });
      }
    }
    for (const [inviteeId, pending] of this.pendingInvites.entries()) {
      if (pending.partyId === party.id) this.pendingInvites.delete(inviteeId);
    }
    this.parties.delete(party.id);
  }

  _pendingCount(partyId) {
    let count = 0;
    for (const pending of this.pendingInvites.values()) if (pending.partyId === partyId) count++;
    return count;
  }

  _partyFailure(session, code, reason) {
    this._deliver(session.sessionId, encodePartyInsertFailure(code), {
      kind: 'party',
      action: 'failure',
      code,
      reason,
    });
  }

  _deliver(sessionId, packet, meta) {
    const session = this.getSession(sessionId);
    if (!session || !session.connected) return false;
    this.send(session, Buffer.from(packet), meta);
    return true;
  }
}

module.exports = { SocialService };
