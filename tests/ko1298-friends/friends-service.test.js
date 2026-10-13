'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  FriendsService,
  MemoryFriendRepository,
  PresenceRegistry,
  MAX_REPORTED_FRIENDS_1298,
} = require('../../services/ko1298-friends');

function directory(...ids) {
  const known = new Set(ids.map(String));
  return { exists: async (userId) => known.has(String(userId)) };
}

function fixture(options = {}) {
  const repository = options.repository ?? new MemoryFriendRepository();
  const presence = options.presence ?? new PresenceRegistry();
  const userDirectory = options.userDirectory ?? directory('a', 'b', 'c', 'd', ...Array.from({ length: 40 }, (_, i) => `u${i}`));
  const service = new FriendsService({ repository, presence, userDirectory, friendLimit: options.friendLimit });
  return { repository, presence, service };
}

test('rejects invalid, self, missing, duplicate and inverse friend requests', async () => {
  const { service } = fixture();

  assert.equal((await service.requestFriend({ fromId: '', toId: 'b' })).code, 'INVALID_USER_ID');
  assert.equal((await service.requestFriend({ fromId: 'a', toId: 'a' })).code, 'SELF_RELATION_NOT_ALLOWED');
  assert.equal((await service.requestFriend({ fromId: 'a', toId: 'missing' })).code, 'TARGET_NOT_FOUND');

  assert.deepEqual(await service.requestFriend({ fromId: 'a', toId: 'b' }), { ok: true, code: 'FRIEND_REQUEST_CREATED' });
  assert.equal((await service.requestFriend({ fromId: 'a', toId: 'b' })).code, 'DUPLICATE_REQUEST');
  assert.equal((await service.requestFriend({ fromId: 'b', toId: 'a' })).code, 'INVERSE_REQUEST_PENDING');
});

test('accept, reject and remove keep friendship symmetric', async () => {
  const { service, repository } = fixture();

  await service.requestFriend({ fromId: 'a', toId: 'b' });
  assert.equal((await service.acceptFriend({ userId: 'b', fromId: 'a' })).code, 'FRIEND_REQUEST_ACCEPTED');
  assert.equal(await repository.areFriends('a', 'b'), true);
  assert.equal(await repository.areFriends('b', 'a'), true);
  assert.equal((await service.acceptFriend({ userId: 'b', fromId: 'a' })).code, 'FRIEND_REQUEST_NOT_FOUND');

  assert.equal((await service.removeFriend({ userId: 'a', friendId: 'b' })).code, 'FRIEND_REMOVED');
  assert.equal(await repository.areFriends('a', 'b'), false);

  await service.requestFriend({ fromId: 'c', toId: 'd' });
  assert.equal((await service.rejectFriend({ userId: 'd', fromId: 'c' })).code, 'FRIEND_REQUEST_REJECTED');
  assert.equal((await service.acceptFriend({ userId: 'd', fromId: 'c' })).code, 'FRIEND_REQUEST_NOT_FOUND');
});

test('blocking severs friendship, cancels requests and denies both request directions', async () => {
  const { service, repository } = fixture();

  await service.requestFriend({ fromId: 'a', toId: 'b' });
  await service.acceptFriend({ userId: 'b', fromId: 'a' });
  assert.equal((await service.block({ userId: 'a', targetId: 'b' })).code, 'USER_BLOCKED');
  assert.equal(await repository.areFriends('a', 'b'), false);
  assert.equal((await service.requestFriend({ fromId: 'a', toId: 'b' })).code, 'BLOCKED_RELATION');
  assert.equal((await service.requestFriend({ fromId: 'b', toId: 'a' })).code, 'BLOCKED_RELATION');

  assert.equal((await service.unblock({ userId: 'a', targetId: 'b' })).code, 'USER_UNBLOCKED');
  assert.equal((await service.requestFriend({ fromId: 'b', toId: 'a' })).code, 'FRIEND_REQUEST_CREATED');
  assert.equal((await service.block({ userId: 'a', targetId: 'b' })).code, 'USER_BLOCKED');
  assert.equal(await repository.hasPendingRequest('b', 'a'), false);
});

test('default and configurable friend limits cannot exceed source-verified 1298 bound', async () => {
  const { service, repository } = fixture();
  assert.equal(service.friendLimit, MAX_REPORTED_FRIENDS_1298);
  assert.equal(MAX_REPORTED_FRIENDS_1298, 29);
  assert.throws(() => fixture({ friendLimit: 30 }), /friendLimit must be 1\.\.29/);

  for (let i = 0; i < MAX_REPORTED_FRIENDS_1298; i++) {
    await repository.addFriendship('a', `u${i}`);
  }
  const result = await service.requestFriend({ fromId: 'a', toId: 'b' });
  assert.equal(result.code, 'FRIEND_LIMIT_REACHED');
  assert.equal(result.userId, 'a');
  assert.equal(result.count, 29);
});

test('friend list projects online/offline presence', async () => {
  const { service, presence } = fixture();
  await service.requestFriend({ fromId: 'a', toId: 'b' });
  await service.acceptFriend({ userId: 'b', fromId: 'a' });

  let list = await service.listFriends('a');
  assert.deepEqual(list.friends, [{ userId: 'b', online: false }]);

  await presence.login({ userId: 'b', sessionId: 's1' });
  list = await service.listFriends('a');
  assert.deepEqual(list.friends, [{ userId: 'b', online: true }]);
});
