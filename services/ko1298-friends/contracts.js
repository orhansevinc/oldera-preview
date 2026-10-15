'use strict';

/**
 * Persistence port for the friends domain.
 *
 * A production adapter MUST make relationship mutations atomic. In particular,
 * addFriendship(), removeFriendship(), addBlock(), and deletePendingBetween()
 * must not expose half-written bidirectional state to concurrent requests.
 */
class FriendRepository {
  async getFriendIds(_userId) { throw new Error('NOT_IMPLEMENTED'); }
  async countFriends(_userId) { throw new Error('NOT_IMPLEMENTED'); }
  async areFriends(_leftId, _rightId) { throw new Error('NOT_IMPLEMENTED'); }
  async addFriendship(_leftId, _rightId) { throw new Error('NOT_IMPLEMENTED'); }
  async removeFriendship(_leftId, _rightId) { throw new Error('NOT_IMPLEMENTED'); }

  async hasPendingRequest(_fromId, _toId) { throw new Error('NOT_IMPLEMENTED'); }
  async createPendingRequest(_fromId, _toId) { throw new Error('NOT_IMPLEMENTED'); }
  async deletePendingRequest(_fromId, _toId) { throw new Error('NOT_IMPLEMENTED'); }
  async deletePendingBetween(_leftId, _rightId) { throw new Error('NOT_IMPLEMENTED'); }

  async isBlocked(_blockerId, _blockedId) { throw new Error('NOT_IMPLEMENTED'); }
  async addBlock(_blockerId, _blockedId) { throw new Error('NOT_IMPLEMENTED'); }
  async removeBlock(_blockerId, _blockedId) { throw new Error('NOT_IMPLEMENTED'); }
}

/** Character/account lookup port. Protocol/name resolution stays outside WS32. */
class UserDirectory {
  async exists(_userId) { throw new Error('NOT_IMPLEMENTED'); }
}

/** Presence port consumed by friend-list projection. */
class PresencePort {
  async getPresence(_userId) { throw new Error('NOT_IMPLEMENTED'); }
  async getPresenceMany(_userIds) { throw new Error('NOT_IMPLEMENTED'); }
}

module.exports = { FriendRepository, UserDirectory, PresencePort };
