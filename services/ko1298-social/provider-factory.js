'use strict';

function bindMethods(target, names) {
  const out = {};
  for (const name of names) {
    if (typeof target[name] !== 'function') throw new TypeError(`required provider method missing: ${name}`);
    out[name] = target[name].bind(target);
  }
  return out;
}

function createFriendRuntimePort({ repository, userDirectory = null, presence = null } = {}) {
  const { FriendsService, PresenceRegistry } = require('../ko1298-friends');
  if (!repository) throw new TypeError('P2-11 friend repository is required');
  const presenceRegistry = presence ?? new PresenceRegistry();
  const service = new FriendsService({ repository, userDirectory, presence: presenceRegistry });
  const whisper = service.createWs18QueryInterface();
  const actions = bindMethods(service, [
    'requestFriend', 'acceptFriend', 'rejectFriend', 'removeFriend', 'block', 'unblock', 'listFriends',
  ]);
  return Object.freeze({
    ...actions,
    canPrivateMessage: whisper.canPrivateMessage,
    isBlockedEitherWay: whisper.isBlockedEitherWay,
    async sessionOnline({ characterId, sessionId, meta = null }) {
      return presenceRegistry.login({ userId: String(characterId), sessionId: String(sessionId), meta });
    },
    async sessionOffline({ characterId, sessionId }) {
      return presenceRegistry.logout({ userId: String(characterId), sessionId: String(sessionId) });
    },
    service,
    presence: presenceRegistry,
  });
}

function createClanRuntimePort({ repository, clock } = {}) {
  const { ClanService, createClanChatDirectory } = require('../ko1298-clan/src');
  if (!repository) throw new TypeError('P2-11 clan repository is required');
  const service = new ClanService({ repository, ...(clock ? { clock } : {}) });
  const directory = createClanChatDirectory(service);
  const actions = bindMethods(service, [
    'createClan', 'invite', 'acceptInvite', 'rejectInvite', 'leave', 'kick', 'disband',
    'appointChief', 'appointViceChief', 'appointOfficer', 'punish', 'listMembers',
  ]);
  return Object.freeze({
    ...actions,
    resolveMember: directory.resolveMember,
    listOnlineRecipients: directory.listOnlineRecipients,
    setOnlineState: service.setOnlineState.bind(service),
    clearInvitesForCharacter: service.clearInvitesForCharacter.bind(service),
    service,
  });
}

module.exports = { createFriendRuntimePort, createClanRuntimePort };
