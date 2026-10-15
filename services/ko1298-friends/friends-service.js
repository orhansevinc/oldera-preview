'use strict';

// OpenKO 1.298 source: CUser::FriendReport rejects usercount >= 30.
// Therefore 29 is the largest source-verified list size accepted by that path.
const MAX_REPORTED_FRIENDS_1298 = 29;

function normalizeId(value, label) {
  const normalized = String(value ?? '').trim();
  if (!normalized) return { ok: false, code: 'INVALID_USER_ID', field: label };
  return { ok: true, value: normalized };
}

function outcome(ok, code, extra = {}) {
  return { ok, code, ...extra };
}

class FriendsService {
  constructor(options = {}) {
    if (!options.repository) throw new TypeError('repository is required');
    this.repository = options.repository;
    this.userDirectory = options.userDirectory ?? null;
    this.presence = options.presence ?? null;
    this.friendLimit = options.friendLimit ?? MAX_REPORTED_FRIENDS_1298;

    if (!Number.isInteger(this.friendLimit) || this.friendLimit < 1 || this.friendLimit > MAX_REPORTED_FRIENDS_1298) {
      throw new RangeError(`friendLimit must be 1..${MAX_REPORTED_FRIENDS_1298}`);
    }
  }

  _pair(leftId, rightId) {
    const left = normalizeId(leftId, 'leftId');
    if (!left.ok) return left;
    const right = normalizeId(rightId, 'rightId');
    if (!right.ok) return right;
    if (left.value === right.value) return outcome(false, 'SELF_RELATION_NOT_ALLOWED');
    return outcome(true, 'VALID', { leftId: left.value, rightId: right.value });
  }

  async _exists(userId) {
    if (!this.userDirectory) return true;
    return Boolean(await this.userDirectory.exists(userId));
  }

  async _blockedEitherWay(leftId, rightId) {
    return (await this.repository.isBlocked(leftId, rightId)) ||
      (await this.repository.isBlocked(rightId, leftId));
  }

  async _limitState(userId) {
    const count = await this.repository.countFriends(userId);
    return { count, full: count >= this.friendLimit };
  }

  async requestFriend({ fromId, toId }) {
    const pair = this._pair(fromId, toId);
    if (!pair.ok) return pair;
    const { leftId: from, rightId: to } = pair;

    if (!(await this._exists(to))) return outcome(false, 'TARGET_NOT_FOUND');
    if (await this._blockedEitherWay(from, to)) return outcome(false, 'BLOCKED_RELATION');
    if (await this.repository.areFriends(from, to)) return outcome(false, 'ALREADY_FRIENDS');
    if (await this.repository.hasPendingRequest(from, to)) return outcome(false, 'DUPLICATE_REQUEST');
    if (await this.repository.hasPendingRequest(to, from)) return outcome(false, 'INVERSE_REQUEST_PENDING');

    const [senderLimit, targetLimit] = await Promise.all([this._limitState(from), this._limitState(to)]);
    if (senderLimit.full) return outcome(false, 'FRIEND_LIMIT_REACHED', { userId: from, count: senderLimit.count });
    if (targetLimit.full) return outcome(false, 'FRIEND_LIMIT_REACHED', { userId: to, count: targetLimit.count });

    const created = await this.repository.createPendingRequest(from, to);
    return created ? outcome(true, 'FRIEND_REQUEST_CREATED') : outcome(false, 'DUPLICATE_REQUEST');
  }

  async acceptFriend({ userId, fromId }) {
    const pair = this._pair(userId, fromId);
    if (!pair.ok) return pair;
    const { leftId: recipient, rightId: sender } = pair;

    if (!(await this.repository.hasPendingRequest(sender, recipient))) {
      return outcome(false, 'FRIEND_REQUEST_NOT_FOUND');
    }
    if (await this._blockedEitherWay(recipient, sender)) {
      await this.repository.deletePendingBetween(recipient, sender);
      return outcome(false, 'BLOCKED_RELATION');
    }
    if (await this.repository.areFriends(recipient, sender)) {
      await this.repository.deletePendingBetween(recipient, sender);
      return outcome(false, 'ALREADY_FRIENDS');
    }

    const [recipientLimit, senderLimit] = await Promise.all([
      this._limitState(recipient),
      this._limitState(sender),
    ]);
    if (recipientLimit.full) return outcome(false, 'FRIEND_LIMIT_REACHED', { userId: recipient, count: recipientLimit.count });
    if (senderLimit.full) return outcome(false, 'FRIEND_LIMIT_REACHED', { userId: sender, count: senderLimit.count });

    const added = await this.repository.addFriendship(recipient, sender);
    await this.repository.deletePendingBetween(recipient, sender);
    return added ? outcome(true, 'FRIEND_REQUEST_ACCEPTED') : outcome(false, 'ALREADY_FRIENDS');
  }

  async rejectFriend({ userId, fromId }) {
    const pair = this._pair(userId, fromId);
    if (!pair.ok) return pair;
    const deleted = await this.repository.deletePendingRequest(pair.rightId, pair.leftId);
    return deleted ? outcome(true, 'FRIEND_REQUEST_REJECTED') : outcome(false, 'FRIEND_REQUEST_NOT_FOUND');
  }

  async removeFriend({ userId, friendId }) {
    const pair = this._pair(userId, friendId);
    if (!pair.ok) return pair;
    const removed = await this.repository.removeFriendship(pair.leftId, pair.rightId);
    return removed ? outcome(true, 'FRIEND_REMOVED') : outcome(false, 'FRIEND_NOT_FOUND');
  }

  async block({ userId, targetId }) {
    const pair = this._pair(userId, targetId);
    if (!pair.ok) return pair;
    const { leftId: blocker, rightId: blocked } = pair;
    if (!(await this._exists(blocked))) return outcome(false, 'TARGET_NOT_FOUND');

    const created = await this.repository.addBlock(blocker, blocked);
    if (!created) return outcome(false, 'ALREADY_BLOCKED');

    // Blocking severs the social relationship and cancels requests in both directions.
    await this.repository.removeFriendship(blocker, blocked);
    await this.repository.deletePendingBetween(blocker, blocked);
    return outcome(true, 'USER_BLOCKED');
  }

  async unblock({ userId, targetId }) {
    const pair = this._pair(userId, targetId);
    if (!pair.ok) return pair;
    const removed = await this.repository.removeBlock(pair.leftId, pair.rightId);
    return removed ? outcome(true, 'USER_UNBLOCKED') : outcome(false, 'BLOCK_NOT_FOUND');
  }

  async listFriends(userId) {
    const normalized = normalizeId(userId, 'userId');
    if (!normalized.ok) return normalized;
    const friendIds = await this.repository.getFriendIds(normalized.value);
    let presence = new Map();
    if (this.presence) presence = await this.presence.getPresenceMany(friendIds);

    return outcome(true, 'FRIEND_LIST', {
      friends: friendIds.map((friendId) => ({
        userId: friendId,
        online: presence.get(friendId)?.online ?? false,
      })),
      limit: this.friendLimit,
    });
  }

  createWs18QueryInterface() {
    return {
      isBlockedEitherWay: async (leftId, rightId) => {
        const pair = this._pair(leftId, rightId);
        if (!pair.ok) return true;
        return this._blockedEitherWay(pair.leftId, pair.rightId);
      },
      canPrivateMessage: async (fromId, toId) => {
        const pair = this._pair(fromId, toId);
        if (!pair.ok) return outcome(false, pair.code);
        const blocked = await this._blockedEitherWay(pair.leftId, pair.rightId);
        return blocked ? outcome(false, 'BLOCKED_RELATION') : outcome(true, 'PRIVATE_MESSAGE_ALLOWED');
      },
    };
  }
}

module.exports = { FriendsService, MAX_REPORTED_FRIENDS_1298 };
