'use strict';

const { fail } = require('./errors');

function defaultResolveDraft(tx, ownerId) {
  if (!tx) return null;
  if (tx instanceof Map) return tx.get(String(ownerId)) ?? null;
  if (tx.itemDrafts instanceof Map) return tx.itemDrafts.get(String(ownerId)) ?? null;
  if (tx.items instanceof Map) return tx.items.get(String(ownerId)) ?? null;
  if (typeof tx.draftFor === 'function') return tx.draftFor(String(ownerId));
  return null;
}

function requireDraft(resolveDraft, tx, ownerId) {
  const draft = resolveDraft(tx, ownerId);
  if (!draft) fail('EXTERNAL_TRANSACTION_REQUIRED', `External item draft is required for ${ownerId}.`);
  return draft;
}

function createEconomyItemPort({ service, resolveDraft = defaultResolveDraft }) {
  if (!service) fail('INVALID_ITEM_SERVICE', 'ItemDomainService is required.');
  return Object.freeze({
    canReceiveNpcPurchase: async ({ playerId, itemTemplateId, quantity, tx }) => service.canReceiveBatch(playerId, { incoming: [{ templateId: itemTemplateId, quantity }], tx: resolveDraft(tx, playerId) }),
    addNpcPurchase: async ({ playerId, itemTemplateId, quantity, sourceNpcId, tx, serial = null }) => service.insertFromMerchant(playerId, { templateId: itemTemplateId, quantity, sourceNpcId, serial, tx: requireDraft(resolveDraft, tx, playerId) }),
    getOwnedItem: async ({ playerId, itemSerial, tx }) => service.getOwnedItem(playerId, itemSerial, { tx: resolveDraft(tx, playerId) }),
    removeOwnedItem: async ({ playerId, itemSerial, quantity, tx }) => service.removeForMerchant(playerId, { itemSerial, quantity, tx: requireDraft(resolveDraft, tx, playerId) }),
    countSerial: async ({ itemSerial }) => service.countSerial(itemSerial),
    canReceiveTrade: async ({ playerId, incoming = [], outgoing = [], tx }) => service.canReceiveBatch(playerId, { incoming, outgoing, tx: resolveDraft(tx, playerId) }),
    transferItem: async ({ fromPlayerId, toPlayerId, itemSerial, quantity = 1, toSlot = null, tx }) => service.transferBetweenDrafts({ fromOwnerId: fromPlayerId, toOwnerId: toPlayerId, itemSerial, quantity, toSlot, drafts: new Map([[String(fromPlayerId), requireDraft(resolveDraft, tx, fromPlayerId)], [String(toPlayerId), requireDraft(resolveDraft, tx, toPlayerId)]]) }),
  });
}

function createLootItemPort({ service, resolveDraft = defaultResolveDraft }) {
  if (!service) fail('INVALID_ITEM_SERVICE', 'ItemDomainService is required.');
  return Object.freeze({
    inventory: Object.freeze({ canAccept: async ({ characterId, itemId, quantity, tx }) => service.canReceiveBatch(characterId, { incoming: [{ templateId: itemId, quantity }], tx: resolveDraft(tx, characterId) }) }),
    serials: Object.freeze({ createForDrop: async ({ itemId, quantity, loot }) => service.generateSerial({ ownerId: loot?.ownerId ?? loot?.characterId ?? 'loot', templateId: itemId, quantity, reason: 'loot-drop' }) }),
    items: Object.freeze({ grant: async ({ characterId, itemId, quantity, serial, source, tx }) => service.insertFromLoot(characterId, { templateId: itemId, quantity, serial, source, tx: requireDraft(resolveDraft, tx, characterId) }) }),
  });
}

module.exports = { createEconomyItemPort, createLootItemPort, defaultResolveDraft };
