'use strict';

const { FriendRepository } = require('./contracts');

function id(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new TypeError('user id is required');
  return normalized;
}

function pairKey(a, b) {
  const left = id(a);
  const right = id(b);
  return left < right ? `${left}\u0000${right}` : `${right}\u0000${left}`;
}

function directedKey(from, to) {
  return `${id(from)}\u0000${id(to)}`;
}

class MemoryFriendRepository extends FriendRepository {
  constructor() {
    super();
    this.friendships = new Set();
    this.pending = new Set();
    this.blocks = new Set();
  }

  async getFriendIds(userId) {
    const user = id(userId);
    const result = [];
    for (const key of this.friendships) {
      const [left, right] = key.split('\u0000');
      if (left === user) result.push(right);
      else if (right === user) result.push(left);
    }
    result.sort();
    return result;
  }

  async countFriends(userId) {
    return (await this.getFriendIds(userId)).length;
  }

  async areFriends(leftId, rightId) {
    return this.friendships.has(pairKey(leftId, rightId));
  }

  async addFriendship(leftId, rightId) {
    const key = pairKey(leftId, rightId);
    if (this.friendships.has(key)) return false;
    this.friendships.add(key);
    return true;
  }

  async removeFriendship(leftId, rightId) {
    return this.friendships.delete(pairKey(leftId, rightId));
  }

  async hasPendingRequest(fromId, toId) {
    return this.pending.has(directedKey(fromId, toId));
  }

  async createPendingRequest(fromId, toId) {
    const key = directedKey(fromId, toId);
    if (this.pending.has(key)) return false;
    this.pending.add(key);
    return true;
  }

  async deletePendingRequest(fromId, toId) {
    return this.pending.delete(directedKey(fromId, toId));
  }

  async deletePendingBetween(leftId, rightId) {
    const a = this.pending.delete(directedKey(leftId, rightId));
    const b = this.pending.delete(directedKey(rightId, leftId));
    return a || b;
  }

  async isBlocked(blockerId, blockedId) {
    return this.blocks.has(directedKey(blockerId, blockedId));
  }

  async addBlock(blockerId, blockedId) {
    const key = directedKey(blockerId, blockedId);
    if (this.blocks.has(key)) return false;
    this.blocks.add(key);
    return true;
  }

  async removeBlock(blockerId, blockedId) {
    return this.blocks.delete(directedKey(blockerId, blockedId));
  }
}

module.exports = { MemoryFriendRepository };
