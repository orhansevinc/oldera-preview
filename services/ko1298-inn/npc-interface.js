'use strict';

const { fail } = require('./errors');

function createInnHostessHandler({ service, resolveAccountId, resolveCharacterId } = {}) {
  if (!service || typeof service.open !== 'function') fail('INVALID_INN_SERVICE', 'Inn service with open(accountId) is required.');
  const accountResolver = resolveAccountId || (session => session?.accountId);
  const characterResolver = resolveCharacterId || (session => session?.characterId);

  return async function innHostessInteraction({ session, npc } = {}) {
    const accountId = Number(await accountResolver(session));
    const characterId = Number(await characterResolver(session));
    if (!Number.isInteger(accountId) || accountId <= 0) fail('ACCOUNT_CONTEXT_REQUIRED', 'Inn Hostess interaction requires an authenticated account.');
    if (!Number.isInteger(characterId) || characterId <= 0) fail('CHARACTER_CONTEXT_REQUIRED', 'Inn Hostess interaction requires a selected character.');

    const storage = await service.open(accountId);
    return {
      kind: 'inn-storage',
      interface: 'inn',
      accountId,
      characterId,
      npc,
      storage,
    };
  };
}

module.exports = { createInnHostessHandler };
