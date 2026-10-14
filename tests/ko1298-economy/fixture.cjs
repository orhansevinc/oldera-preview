'use strict';

const { EconomyService } = require('../../services/ko1298-economy/src/index.cjs');

function createFixture(options = {}) {
  const initial = {
    balances: new Map(),
    inventories: new Map(),
    trades: new Map(),
    offers: new Map(),
    merchants: new Map(),
    playerContexts: new Map(),
    capacities: new Map(),
    templates: new Map(),
    audit: [],
    nextSerial: 1,
  };
  const ref = { current: initial };
  let queue = Promise.resolve();
  let tradeSeq = 1;
  let failNextNpcCredit = false;
  let failNextTransfer = false;
  let nowMs = options.startTimeMs ?? 1_700_000_000_000;

  const stateFor = (tx) => tx?.state ?? ref.current;
  const inventoryOf = (state, playerId) => {
    if (!state.inventories.has(playerId)) state.inventories.set(playerId, []);
    return state.inventories.get(playerId);
  };
  const cloneItem = (item) => structuredClone(item);

  const transactionManager = {
    async run(_keys, work) {
      let release;
      const previous = queue;
      queue = new Promise((resolve) => { release = resolve; });
      await previous;
      const draft = structuredClone(ref.current);
      const tx = { state: draft };
      try {
        const result = await work(tx);
        ref.current = draft;
        return result;
      } finally {
        release();
      }
    },
  };

  const coinRepository = {
    async getBalance(playerId, { tx } = {}) {
      return stateFor(tx).balances.get(playerId) ?? 0n;
    },
    async setBalance(playerId, balance, { tx } = {}) {
      stateFor(tx).balances.set(playerId, BigInt(balance));
    },
  };

  const merchantPort = {
    async assertInteraction({ playerId, npcId, tx }) {
      const state = stateFor(tx);
      const merchant = state.merchants.get(npcId);
      if (!merchant) {
        const error = new Error('not a merchant');
        error.code = 'NOT_MERCHANT';
        throw error;
      }
      const context = state.playerContexts.get(playerId) ?? {};
      if (merchant.zoneId != null && context.zoneId != null && String(context.zoneId) !== String(merchant.zoneId)) {
        const error = new Error('wrong zone');
        error.code = 'WRONG_ZONE';
        throw error;
      }
      const distance = context.distances?.[npcId];
      if (merchant.maxDistance != null && distance != null && distance > merchant.maxDistance) {
        const error = new Error('merchant too far');
        error.code = 'TOO_FAR';
        throw error;
      }
      return structuredClone(merchant);
    },
    async getOffer({ npcId, itemTemplateId, tx }) {
      return stateFor(tx).offers.get(`${npcId}:${itemTemplateId}`) ?? null;
    },
  };

  const inventoryPort = {
    async canReceiveNpcPurchase({ playerId, itemTemplateId, quantity, tx }) {
      const state = stateFor(tx);
      const capacity = state.capacities.get(playerId) ?? 28;
      const inventory = inventoryOf(state, playerId);
      const template = state.templates.get(String(itemTemplateId));
      if (template?.stackable) {
        const maxStack = template.maxStack ?? 9999;
        const mergeRoom = inventory
          .filter((entry) => entry.templateId === String(itemTemplateId))
          .reduce((sum, entry) => sum + Math.max(0, maxStack - entry.quantity), 0);
        const remainder = Math.max(0, quantity - mergeRoom);
        const requiredSlots = Math.ceil(remainder / maxStack);
        return { ok: inventory.length + requiredSlots <= capacity, reason: 'full' };
      }
      return { ok: inventory.length + quantity <= capacity, reason: 'full' };
    },
    async addNpcPurchase({ playerId, itemTemplateId, quantity, tx }) {
      const state = stateFor(tx);
      const inventory = inventoryOf(state, playerId);
      const template = state.templates.get(String(itemTemplateId));
      const serials = [];
      let remaining = quantity;
      if (template?.stackable) {
        const maxStack = template.maxStack ?? 9999;
        for (const item of inventory) {
          if (item.templateId !== String(itemTemplateId) || item.quantity >= maxStack) continue;
          const moved = Math.min(maxStack - item.quantity, remaining);
          item.quantity += moved;
          remaining -= moved;
          if (remaining === 0) break;
        }
        while (remaining > 0) {
          const serial = `npc-${state.nextSerial++}`;
          const moved = Math.min(maxStack, remaining);
          inventory.push({ serial, templateId: String(itemTemplateId), quantity: moved, tradeable: true, sellable: true });
          serials.push(serial);
          remaining -= moved;
        }
      } else {
        const serial = `npc-${state.nextSerial++}`;
        inventory.push({
          serial,
          templateId: String(itemTemplateId),
          quantity,
          tradeable: template?.tradeable !== false,
          sellable: template?.sellable !== false,
        });
        serials.push(serial);
      }
      if (failNextNpcCredit) {
        failNextNpcCredit = false;
        throw new Error('injected inventory credit failure');
      }
      return { serials };
    },
    async getOwnedItem({ playerId, itemSerial, tx }) {
      const item = inventoryOf(stateFor(tx), playerId).find((entry) => entry.serial === itemSerial);
      return item ? cloneItem(item) : null;
    },
    async removeOwnedItem({ playerId, itemSerial, quantity, tx }) {
      const state = stateFor(tx);
      const inventory = inventoryOf(state, playerId);
      const index = inventory.findIndex((entry) => entry.serial === itemSerial);
      if (index < 0) throw new Error('missing item');
      const item = inventory[index];
      if (quantity > item.quantity) throw new Error('insufficient item');
      if (quantity === item.quantity) inventory.splice(index, 1);
      else item.quantity -= quantity;
    },
    async countSerial({ itemSerial, tx }) {
      const state = stateFor(tx);
      let count = 0;
      for (const inventory of state.inventories.values()) {
        count += inventory.filter((entry) => entry.serial === itemSerial).length;
      }
      return count;
    },
    async canReceiveTrade({ playerId, incoming, outgoing, tx }) {
      const state = stateFor(tx);
      const capacity = state.capacities.get(playerId) ?? 28;
      const current = inventoryOf(state, playerId);
      const freed = outgoing.filter((entry) => {
        const owned = current.find((item) => item.serial === entry.serial);
        return owned && owned.quantity === entry.quantity;
      }).length;
      return { ok: current.length - freed + incoming.length <= capacity, reason: 'full' };
    },
    async transferItem({ fromPlayerId, toPlayerId, itemSerial, quantity, tx }) {
      const state = stateFor(tx);
      const source = inventoryOf(state, fromPlayerId);
      const index = source.findIndex((entry) => entry.serial === itemSerial);
      if (index < 0) throw new Error('missing source item');
      const item = source[index];
      if (quantity > item.quantity) throw new Error('insufficient source quantity');
      if (quantity === item.quantity) {
        source.splice(index, 1);
        inventoryOf(state, toPlayerId).push(item);
      } else {
        item.quantity -= quantity;
        const splitSerial = `split-${state.nextSerial++}`;
        inventoryOf(state, toPlayerId).push({ ...item, serial: splitSerial, quantity });
      }
      if (failNextTransfer) {
        failNextTransfer = false;
        throw new Error('injected transfer failure');
      }
    },
  };

  const tradeRepository = {
    async create(trade, { tx } = {}) { stateFor(tx).trades.set(trade.id, structuredClone(trade)); },
    async get(tradeId, { tx } = {}) {
      const trade = stateFor(tx).trades.get(tradeId);
      return trade ? structuredClone(trade) : null;
    },
    async save(trade, { tx } = {}) { stateFor(tx).trades.set(trade.id, structuredClone(trade)); },
    async findActiveByPlayer(playerId, { tx } = {}) {
      for (const trade of stateFor(tx).trades.values()) {
        if ((trade.status === 'pending' || trade.status === 'open')
          && (trade.inviterId === playerId || trade.inviteeId === playerId)) {
          return structuredClone(trade);
        }
      }
      return null;
    },
  };

  const auditPort = {
    async append(event, { tx } = {}) { stateFor(tx).audit.push(structuredClone(event)); },
  };

  const service = new EconomyService({
    coinRepository,
    inventoryPort,
    merchantPort,
    tradeRepository,
    transactionManager,
    auditPort,
    maxCoins: options.maxCoins ?? 2_100_000_000n,
    tradeTimeoutMs: options.tradeTimeoutMs ?? 120_000,
    idFactory: () => `trade-${tradeSeq++}`,
    clock: () => new Date(nowMs),
  });

  const api = {
    service,
    ref,
    setBalance(playerId, amount) { ref.current.balances.set(String(playerId), BigInt(amount)); },
    getBalance(playerId) { return ref.current.balances.get(String(playerId)) ?? 0n; },
    setCapacity(playerId, slots) { ref.current.capacities.set(String(playerId), slots); },
    addMerchant(npcId, merchant = {}) {
      ref.current.merchants.set(String(npcId), {
        npcId: String(npcId),
        npcTemplateId: merchant.npcTemplateId == null ? null : String(merchant.npcTemplateId),
        zoneId: merchant.zoneId == null ? null : String(merchant.zoneId),
        sellingGroup: merchant.sellingGroup == null ? null : String(merchant.sellingGroup),
        maxDistance: merchant.maxDistance ?? null,
      });
    },
    setPlayerContext(playerId, context) {
      ref.current.playerContexts.set(String(playerId), structuredClone(context));
    },
    setOffer(npcId, templateId, offer) {
      ref.current.offers.set(`${npcId}:${templateId}`, {
        npcSellPrice: offer.npcSellPrice == null ? null : BigInt(offer.npcSellPrice),
        npcBuyPrice: offer.npcBuyPrice == null ? null : BigInt(offer.npcBuyPrice),
        canBuy: offer.canBuy,
        canSell: offer.canSell,
      });
    },
    setTemplate(templateId, template) { ref.current.templates.set(String(templateId), structuredClone(template)); },
    addItem(playerId, item) {
      const player = String(playerId);
      inventoryOf(ref.current, player).push({
        serial: String(item.serial),
        templateId: String(item.templateId),
        quantity: item.quantity ?? 1,
        tradeable: item.tradeable !== false,
        sellable: item.sellable !== false,
      });
    },
    getInventory(playerId) { return structuredClone(inventoryOf(ref.current, String(playerId))); },
    getTrade(tradeId) { return structuredClone(ref.current.trades.get(tradeId)); },
    getAudit() { return structuredClone(ref.current.audit); },
    advanceClock(ms) { nowMs += Number(ms); },
    injectNpcCreditFailure() { failNextNpcCredit = true; },
    injectTransferFailure() { failNextTransfer = true; },
  };

  return api;
}

module.exports = { createFixture };
