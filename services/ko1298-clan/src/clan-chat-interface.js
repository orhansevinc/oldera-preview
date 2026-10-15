'use strict';

/**
 * Read-only interface intended for WS18 clan chat integration.
 *
 * WS18 remains the owner of chat transport/protocol. It can use this adapter to
 * resolve a sender's clan and the online recipient set without importing clan
 * persistence internals or modifying WS21 state.
 */
function createClanChatDirectory(clanService) {
  if (!clanService) throw new TypeError('clanService is required.');

  return Object.freeze({
    async resolveMember(characterId) {
      return clanService.getClanContextForCharacter(characterId);
    },

    async listOnlineRecipients(clanId) {
      return clanService.listOnlineMemberIds(clanId);
    },
  });
}

module.exports = { createClanChatDirectory };
