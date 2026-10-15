'use strict';

class P208Error extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'P208Error';
    this.code = code;
    this.details = details;
  }
}

const CLIENT_AUTHORITY_FIELDS = Object.freeze([
  'price', 'unitPrice', 'totalPrice', 'resultingGold', 'gold',
  'drop', 'dropRoll', 'dropResult',
  'repairCost', 'durabilityCost',
  'upgradeChance', 'upgradeRate', 'upgradeResult', 'success'
]);

function fail(code, message, details) { throw new P208Error(code, message, details); }
function required(value, name) {
  const v = String(value ?? '').trim();
  if (!v) fail('INVALID_REQUEST', `${name} is required`, { field: name });
  return v;
}
function quantity(value) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) fail('INVALID_QUANTITY', 'quantity must be a positive safe integer');
  return n;
}
function rejectClientAuthority(command) {
  for (const field of CLIENT_AUTHORITY_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(command ?? {}, field)) {
      fail('CLIENT_AUTHORITY_REJECTED', `${field} is server-authoritative`, { field });
    }
  }
}
function verified(value, label) {
  if (!value || value.verified !== true || typeof value.source !== 'string' || !value.source.trim()) {
    fail('UNVERIFIED_GAME_RULE', `${label} must come from a source-backed resolver`);
  }
  return value;
}
function need(port, method) {
  if (!port || typeof port[method] !== 'function') fail('MISSING_PORT', `${method} port is required`);
  return port[method].bind(port);
}
function lockKeys(...values) { return [...new Set(values.filter(Boolean).map(String))].sort(); }

class ItemEconomyAuthority {
  constructor(ports = {}) {
    this.tx = ports.transactionManager;
    this.items = ports.items;
    this.coins = ports.coins;
    this.npc = ports.npc;
    this.merchantRules = ports.merchantRules;
    this.repairRules = ports.repairRules;
    this.upgradeRules = ports.upgradeRules;
    this.loot = ports.loot;
    this.lootOwnership = ports.lootOwnership;
    this.trade = ports.trade;
    this.playerMerchant = ports.playerMerchant;
    this.equipmentRules = ports.equipmentRules;
    this.itemUseRules = ports.itemUseRules;
    this.effects = ports.effects;
    need(this.tx, 'runOnce');
  }

  async #run(kind, operationId, keys, work) {
    const id = required(operationId, 'operationId');
    if (id.length > 256) fail('INVALID_REQUEST', 'operationId is too long');
    return this.tx.runOnce({ operationId: id, kind, lockKeys: lockKeys(...keys) }, work);
  }

  async merchantBuy(command) {
    rejectClientAuthority(command);
    const characterId = required(command.characterId, 'characterId');
    const merchantId = required(command.merchantId, 'merchantId');
    const itemTemplateId = required(command.itemTemplateId, 'itemTemplateId');
    const qty = quantity(command.quantity);
    return this.#run('merchant.buy', command.operationId, [`character:${characterId}`, `merchant:${merchantId}`], async tx => {
      await need(this.npc, 'assertInteraction')(tx, { characterId, npcId: merchantId, action: 'merchant.buy' });
      const quote = verified(await need(this.merchantRules, 'quoteBuy')(tx, { characterId, merchantId, itemTemplateId, quantity: qty }), 'merchant buy quote');
      await need(this.coins, 'debit')(tx, characterId, quote.totalGold, { reason: 'merchant.buy', operationId: command.operationId });
      const grant = await need(this.items, 'grantTemplate')(tx, { characterId, itemTemplateId: quote.itemTemplateId, quantity: quote.quantity, source: quote.source });
      return { kind: 'merchant.buy', characterId, merchantId, totalGold: String(quote.totalGold), grant };
    });
  }

  async merchantSell(command) {
    rejectClientAuthority(command);
    const characterId = required(command.characterId, 'characterId');
    const merchantId = required(command.merchantId, 'merchantId');
    const serial = required(command.serial, 'serial');
    const qty = quantity(command.quantity);
    return this.#run('merchant.sell', command.operationId, [`character:${characterId}`, `item:${serial}`, `merchant:${merchantId}`], async tx => {
      await need(this.npc, 'assertInteraction')(tx, { characterId, npcId: merchantId, action: 'merchant.sell' });
      const item = await need(this.items, 'lockOwned')(tx, { characterId, serial, quantity: qty });
      const quote = verified(await need(this.merchantRules, 'quoteSell')(tx, { characterId, merchantId, item, quantity: qty }), 'merchant sell quote');
      await need(this.items, 'removeOwned')(tx, { characterId, serial, quantity: qty, reason: 'merchant.sell' });
      await need(this.coins, 'credit')(tx, characterId, quote.totalGold, { reason: 'merchant.sell', operationId: command.operationId });
      return { kind: 'merchant.sell', characterId, merchantId, serial, quantity: qty, totalGold: String(quote.totalGold) };
    });
  }

  async repair(command) {
    rejectClientAuthority(command);
    const characterId = required(command.characterId, 'characterId');
    const npcId = required(command.npcId, 'npcId');
    const serial = required(command.serial, 'serial');
    return this.#run('item.repair', command.operationId, [`character:${characterId}`, `item:${serial}`, `npc:${npcId}`], async tx => {
      await need(this.npc, 'assertInteraction')(tx, { characterId, npcId, action: 'item.repair' });
      const item = await need(this.items, 'lockOwned')(tx, { characterId, serial });
      const quote = verified(await need(this.repairRules, 'quote')(tx, { characterId, npcId, item }), 'repair quote');
      await need(this.coins, 'debit')(tx, characterId, quote.totalGold, { reason: 'item.repair', operationId: command.operationId });
      await need(this.items, 'setDurability')(tx, { characterId, serial, durability: quote.targetDurability, source: quote.source });
      return { kind: 'item.repair', characterId, serial, totalGold: String(quote.totalGold), durability: quote.targetDurability };
    });
  }

  async upgrade(command) {
    rejectClientAuthority(command);
    const characterId = required(command.characterId, 'characterId');
    const anvilId = required(command.anvilId, 'anvilId');
    const serial = required(command.serial, 'serial');
    return this.#run('item.upgrade', command.operationId, [`character:${characterId}`, `item:${serial}`, `anvil:${anvilId}`], async tx => {
      await need(this.npc, 'assertInteraction')(tx, { characterId, npcId: anvilId, action: 'item.upgrade' });
      const item = await need(this.items, 'lockOwned')(tx, { characterId, serial });
      const resolution = verified(await need(this.upgradeRules, 'resolveAndRoll')(tx, {
        characterId, anvilId, item, materialSerials: command.materialSerials ?? [], operationId: command.operationId
      }), 'upgrade resolution');
      await need(this.coins, 'debit')(tx, characterId, resolution.coinCost, { reason: 'item.upgrade', operationId: command.operationId });
      await need(this.items, 'consumeRequirements')(tx, { characterId, requirements: resolution.materials, reason: 'item.upgrade' });
      const result = await need(this.items, 'applyUpgradeOutcome')(tx, { characterId, serial, resolution });
      return { kind: 'item.upgrade', characterId, serial, outcome: resolution.outcome, result, source: resolution.source };
    });
  }

  async innTransfer(command) {
    rejectClientAuthority(command);
    const characterId = required(command.characterId, 'characterId');
    const accountId = required(command.accountId, 'accountId');
    const innNpcId = required(command.innNpcId, 'innNpcId');
    const serial = required(command.serial, 'serial');
    if (!['deposit', 'withdraw'].includes(command.direction)) fail('INVALID_REQUEST', 'direction must be deposit or withdraw');
    return this.#run(`inn.${command.direction}`, command.operationId, [`account:${accountId}`, `character:${characterId}`, `item:${serial}`], async tx => {
      await need(this.npc, 'assertInteraction')(tx, { characterId, npcId: innNpcId, action: `inn.${command.direction}` });
      const moved = await need(this.items, 'moveInn')(tx, { accountId, characterId, serial, direction: command.direction, target: command.target });
      return { kind: `inn.${command.direction}`, accountId, characterId, serial, moved };
    });
  }

  async lootPickup(command) {
    rejectClientAuthority(command);
    const characterId = required(command.characterId, 'characterId');
    const lootId = required(command.lootId, 'lootId');
    return this.#run('loot.pickup', command.operationId ?? `loot-claim:${lootId}`, [`character:${characterId}`, `loot:${lootId}`], async tx => {
      const loot = await need(this.loot, 'lockClaim')(tx, { lootId });
      await need(this.lootOwnership, 'assertClaim')(tx, { characterId, loot });
      let grant;
      if (loot.kind === 'coin') {
        await need(this.coins, 'credit')(tx, characterId, loot.amount, { reason: 'loot.pickup', operationId: command.operationId ?? `loot-claim:${lootId}` });
        grant = { kind: 'coin', amount: String(loot.amount) };
      } else {
        grant = await need(this.items, 'grantTemplate')(tx, { characterId, itemTemplateId: loot.itemTemplateId, quantity: loot.quantity, serial: loot.serial, source: loot.source });
      }
      await need(this.loot, 'markClaimed')(tx, { lootId, characterId });
      return { kind: 'loot.pickup', lootId, characterId, grant };
    });
  }

  async tradeCommit(command) {
    rejectClientAuthority(command);
    const tradeId = required(command.tradeId, 'tradeId');
    return this.#run('trade.commit', command.operationId, [`trade:${tradeId}`], async tx => {
      const trade = await need(this.trade, 'lockConfirmed')(tx, { tradeId });
      const participants = [...trade.participantIds].map(String).sort();
      const moved = await need(this.items, 'swapTradeOffers')(tx, { trade });
      const coins = await need(this.coins, 'settleTrade')(tx, { trade });
      await need(this.trade, 'markCommitted')(tx, { tradeId, participants, moved, coins });
      return { kind: 'trade.commit', tradeId, participants, moved, coins };
    });
  }

  async playerMerchantCommit(command) {
    rejectClientAuthority(command);
    const listingId = required(command.listingId, 'listingId');
    const buyerCharacterId = required(command.buyerCharacterId, 'buyerCharacterId');
    return this.#run('player-merchant.commit', command.operationId, [`listing:${listingId}`, `character:${buyerCharacterId}`], async tx => {
      const sale = verified(await need(this.playerMerchant, 'lockSale')(tx, { listingId, buyerCharacterId }), 'player merchant sale');
      await need(this.coins, 'debit')(tx, buyerCharacterId, sale.totalGold, { reason: 'player-merchant.buy', operationId: command.operationId });
      await need(this.items, 'transferPlayerMerchant')(tx, { sale, buyerCharacterId });
      await need(this.coins, 'credit')(tx, sale.sellerCharacterId, sale.totalGold, { reason: 'player-merchant.sell', operationId: command.operationId });
      await need(this.playerMerchant, 'markCommitted')(tx, { listingId, buyerCharacterId });
      return { kind: 'player-merchant.commit', listingId, buyerCharacterId, sellerCharacterId: sale.sellerCharacterId, totalGold: String(sale.totalGold) };
    });
  }

  async equip(command) {
    rejectClientAuthority(command);
    const characterId = required(command.characterId, 'characterId');
    const serial = required(command.serial, 'serial');
    return this.#run('item.equip', command.operationId, [`character:${characterId}`, `item:${serial}`], async tx => {
      const item = await need(this.items, 'lockOwned')(tx, { characterId, serial });
      const rule = verified(await need(this.equipmentRules, 'resolveEquip')(tx, { characterId, item, requestedSlot: command.slot }), 'equipment rule');
      const equipment = await need(this.items, 'equip')(tx, { characterId, serial, slot: rule.slot, rule });
      return { kind: 'item.equip', characterId, serial, equipment, combatProjection: rule.combatProjection ?? null, source: rule.source };
    });
  }

  async useItem(command) {
    rejectClientAuthority(command);
    const characterId = required(command.characterId, 'characterId');
    const serial = required(command.serial, 'serial');
    return this.#run('item.use', command.operationId, [`character:${characterId}`, `item:${serial}`], async tx => {
      const item = await need(this.items, 'lockOwned')(tx, { characterId, serial });
      const rule = verified(await need(this.itemUseRules, 'resolveUse')(tx, { characterId, item, targetId: command.targetId ?? null }), 'item use rule');
      await need(this.items, 'consumeOwned')(tx, { characterId, serial, quantity: rule.consumeQuantity, reason: 'item.use' });
      const effect = await need(this.effects, 'apply')(tx, { characterId, targetId: command.targetId ?? characterId, effect: rule.effect, source: rule.source });
      return { kind: 'item.use', characterId, serial, effect, source: rule.source };
    });
  }
}

module.exports = { P208Error, ItemEconomyAuthority, rejectClientAuthority, verified };
