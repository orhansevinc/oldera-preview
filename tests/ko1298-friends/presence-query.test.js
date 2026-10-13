'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  FriendsService,
  MemoryFriendRepository,
  PresenceRegistry,
} = require('../../services/ko1298-friends');

test('presence remains online until the last session logs out and emits edge updates only', async () => {
  const changes = [];
  const presence = new PresenceRegistry({ onChange: (event) => changes.push(event) });

  await presence.login({ userId: 'a', sessionId: 'one' });
  await presence.login({ userId: 'a', sessionId: 'two' });
  assert.deepEqual(await presence.getPresence('a'), { userId: 'a', online: true, sessionCount: 2 });

  await presence.logout({ userId: 'a', sessionId: 'one' });
  assert.equal((await presence.getPresence('a')).online, true);
  await presence.logout({ userId: 'a', sessionId: 'two' });
  assert.equal((await presence.getPresence('a')).online, false);

  assert.deepEqual(changes, [
    { userId: 'a', online: true },
    { userId: 'a', online: false },
  ]);
});

test('WS18 query interface keeps whisper open to non-friends but enforces block either way', async () => {
  const repository = new MemoryFriendRepository();
  const service = new FriendsService({ repository });
  const query = service.createWs18QueryInterface();

  assert.deepEqual(await query.canPrivateMessage('a', 'b'), { ok: true, code: 'PRIVATE_MESSAGE_ALLOWED' });
  await service.block({ userId: 'a', targetId: 'b' });
  assert.deepEqual(await query.canPrivateMessage('a', 'b'), { ok: false, code: 'BLOCKED_RELATION' });
  assert.deepEqual(await query.canPrivateMessage('b', 'a'), { ok: false, code: 'BLOCKED_RELATION' });
  assert.equal(await query.isBlockedEitherWay('a', 'b'), true);
});
