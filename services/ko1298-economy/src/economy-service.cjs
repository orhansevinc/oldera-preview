'use strict';

const {
  DEFAULT_MAX_COIN_BALANCE,
  TRADE_STATUS,
  fail,
  normalizeId,
  assertCoinRange,
  checkedAddCoins,
  checkedSubtractCoins,
  checkedMultiplyCoins,
  positiveQuantity,
  nonNegativeCoin,
  isTradeActive,
  participantIds,
  assertParticipant,
  resetConfirmations,
} = require('./domain.cjs');
const { assertContract } = require('./contracts.cjs');

class EconomyService {
  constructor({
    coinRepository,
    inventoryPort,
    merchantPort,
    tradeRepository,
    transactionManager,
    maxCoins = DEFAULT_MAX_COIN_BALANCE,
    idFactory = () => `trade-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    clock = () => new Date(),
  }) {
    this.coinRepository = assertContract('coinRepository', coinRepository);
    this.inventoryPort = assertContract('inventoryPort', inventoryPort);
    this.merchantPort = assertContract('merchantPort', merchantPort);
    this.tradeRepository = assertContract('tradeRepository', tradeRepository);
    this.transactionManager = assertContract('transactionManager', transactionManager);
    this.maxCoins = assertCoinRange(maxCoins, BigInt(Number.MAX_SAFE_INTEGER), 'maxCoins');
    this.idFactory = idFactory;
    this.clock = clock;
  }

  async getCoinBalance(playerId) {
    const id = normalizeId(playerId, 'playerId');
    const balance = await this.coinRepository.getBalance(id, {});
    return assertCoinRange(balance, this.maxCoins, 'balance');
  }

  async buyFromNpc({ playerId, npcId, itemTemplateId, quantity }) {
    const player = normalizeId(playerId, 'playerId');
    const npc = normalizeId(npcId, 'npcId');
    const templateId = normalizeId(itemTemplateId, 'itemTemplateId');
    const qty = positiveQuantity(quantity);

    return this.transactionManager.run([`player:${player}`, `inventory:${player}`], async (tx) => {
      await this.merchantPort.assertInteraction({ playerId: player, npcId: npc, tx });
      const offer = await this.merchantPort.getOffer({ npcId: npc, itemTemplateId: templateId, tx });
      if (!offer || offer.npcSellPrice == null || offer.canBuy === false) {
        fail('ITEM_NOT_SOLD_BY_NPC', 'merchant does not sell this item', { npcId: npc, itemTemplateId: templateId });
      }

      const total = checkedMultiplyCoins(offer.npcSellPrice, qty, this.maxCoins, 'npcSellPrice');
      const balance = assertCoinRange(await this.coinRepository.getBalance(player, { tx }), this.maxCoins, 'balance');
      const nextBalance = checkedSubtractCoins(balance, total, this.maxCoins, 'balance');

      const capacity = await this.inventoryPort.canReceiveNpcPurchase({
        playerId: player,
        itemTemplateId: templateId,
        quantity: qty,
        tx,
      });
      if (!capacity || capacity.ok !== true) {
        fail('INVENTORY_CAPACITY', 'inventory cannot receive purchased item', { reason: capacity?.reason ?? 'unknown' });
      }

      await this.coinRepository.setBalance(player, nextBalance, { tx });
      const credited = await this.inventoryPort.addNpcPurchase({
        playerId: player,
        itemTemplateId: templateId,
        quantity: qty,
        sourceNpcId: npc,
        tx,
      });

      return {
        playerId: player,
        npcId: npc,
        itemTemplateId: templateId,
        quantity: qty,
        total,
        balance: nextBalance,
        itemResult: credited,
      };
    });
  }

  async sellToNpc({ playerId, npcId, itemSerial, quantity }) {
    const player = normalizeId(playerId, 'playerId');
    const npc = normalizeId(npcId, 'npcId');
    const serial = normalizeId(itemSerial, 'itemSerial');
    const qty = positiveQuantity(quantity);

    return this.transactionManager.run([`player:${player}`, `inventory:${player}`, `serial:${serial}`], async (tx) => {
      await this.merchantPort.assertInteraction({ playerId: player, npcId: npc, tx });
      const item = await this.#assertUniqueOwnedItem({ playerId: player, serial, quantity: qty, tx });
      const offer = await this.merchantPort.getOffer({ npcId: npc, itemTemplateId: String(item.templateId), tx });
      if (!offer || offer.npcBuyPrice == null || offer.canSell === false || item.sellable === false) {
        fail('ITEM_NOT_BUYABLE_BY_NPC', 'merchant cannot buy this item', { npcId: npc, itemTemplateId: item.templateId });
      }

      const total = checkedMultiplyCoins(offer.npcBuyPrice, qty, this.maxCoins, 'npcBuyPrice');
      const balance = assertCoinRange(await this.coinRepository.getBalance(player, { tx }), this.maxCoins, 'balance');
      const nextBalance = checkedAddCoins(balance, total, this.maxCoins, 'balance');

      await this.inventoryPort.removeOwnedItem({ playerId: player, itemSerial: serial, quantity: qty, tx });
      await this.coinRepository.setBalance(player, nextBalance, { tx });

      return {
        playerId: player,
        npcId: npc,
        itemSerial: serial,
        itemTemplateId: String(item.templateId),
        quantity: qty,
        total,
        balance: nextBalance,
      };
    });
  }

  async inviteTrade({ fromPlayerId, toPlayerId }) {
    const from = normalizeId(fromPlayerId, 'fromPlayerId');
    const to = normalizeId(toPlayerId, 'toPlayerId');
    if (from === to) fail('SELF_TRADE', 'cannot trade with self');

    return this.transactionManager.run([`player:${from}`, `player:${to}`], async (tx) => {
      await this.#assertNoActiveTrade(from, tx);
      await this.#assertNoActiveTrade(to, tx);

      const trade = {
        id: normalizeId(this.idFactory(), 'tradeId'),
        inviterId: from,
        inviteeId: to,
        status: TRADE_STATUS.PENDING,
        offers: {
          [from]: { coins: 0n, items: [] },
          [to]: { coins: 0n, items: [] },
        },
        confirmations: { [from]: false, [to]: false },
        createdAt: this.clock().toISOString(),
        updatedAt: this.clock().toISOString(),
        completedAt: null,
        cancelReason: null,
      };
      await this.tradeRepository.create(trade, { tx });
      return cloneTrade(trade);
    });
  }

  async acceptTrade({ tradeId, playerId }) {
    const tradeKey = normalizeId(tradeId, 'tradeId');
    const player = normalizeId(playerId, 'playerId');
    return this.transactionManager.run([`trade:${tradeKey}`, `player:${player}`], async (tx) => {
      const trade = await this.#getTrade(tradeKey, tx);
      if (trade.status !== TRADE_STATUS.PENDING) fail('TRADE_NOT_PENDING', 'trade is not awaiting acceptance');
      if (trade.inviteeId !== player) fail('ONLY_INVITEE_CAN_ACCEPT', 'only invitee can accept trade');
      trade.status = TRADE_STATUS.OPEN;
      this.#touch(trade);
      await this.tradeRepository.save(trade, { tx });
      return cloneTrade(trade);
    });
  }

  async rejectTrade({ tradeId, playerId }) {
    const tradeKey = normalizeId(tradeId, 'tradeId');
    const player = normalizeId(playerId, 'playerId');
    return this.transactionManager.run([`trade:${tradeKey}`, `player:${player}`], async (tx) => {
      const trade = await this.#getTrade(tradeKey, tx);
      if (trade.status !== TRADE_STATUS.PENDING) fail('TRADE_NOT_PENDING', 'trade is not awaiting acceptance');
      if (trade.inviteeId !== player) fail('ONLY_INVITEE_CAN_REJECT', 'only invitee can reject trade');
      trade.status = TRADE_STATUS.REJECTED;
      trade.cancelReason = 'rejected';
      this.#touch(trade);
      await this.tradeRepository.save(trade, { tx });
      return cloneTrade(trade);
    });
  }

  async stageTradeItem({ tradeId, playerId, itemSerial, quantity }) {
    const tradeKey = normalizeId(tradeId, 'tradeId');
    const player = normalizeId(playerId, 'playerId');
    const serial = normalizeId(itemSerial, 'itemSerial');
    const qty = positiveQuantity(quantity);

    return this.transactionManager.run(
      [`trade:${tradeKey}`, `player:${player}`, `inventory:${player}`, `serial:${serial}`],
      async (tx) => {
        const trade = await this.#getOpenTradeForPlayer(tradeKey, player, tx);
        await this.#assertUniqueOwnedItem({ playerId: player, serial, quantity: qty, tx });

        const everyItem = participantIds(trade).flatMap((participant) => trade.offers[participant].items);
        if (everyItem.some((entry) => entry.serial === serial)) {
          fail('DUPLICATE_TRADE_SERIAL', 'item serial is already staged in this trade', { serial });
        }

        trade.offers[player].items.push({ serial, quantity: qty });
        resetConfirmations(trade);
        this.#touch(trade);
        await this.tradeRepository.save(trade, { tx });
        return cloneTrade(trade);
      },
    );
  }

  async unstageTradeItem({ tradeId, playerId, itemSerial }) {
    const tradeKey = normalizeId(tradeId, 'tradeId');
    const player = normalizeId(playerId, 'playerId');
    const serial = normalizeId(itemSerial, 'itemSerial');
    return this.transactionManager.run([`trade:${tradeKey}`, `player:${player}`], async (tx) => {
      const trade = await this.#getOpenTradeForPlayer(tradeKey, player, tx);
      const before = trade.offers[player].items.length;
      trade.offers[player].items = trade.offers[player].items.filter((entry) => entry.serial !== serial);
      if (trade.offers[player].items.length === before) fail('ITEM_NOT_STAGED', 'item is not staged in this trade', { serial });
      resetConfirmations(trade);
      this.#touch(trade);
      await this.tradeRepository.save(trade, { tx });
      return cloneTrade(trade);
    });
  }

  async stageTradeCoin({ tradeId, playerId, amount }) {
    const tradeKey = normalizeId(tradeId, 'tradeId');
    const player = normalizeId(playerId, 'playerId');
    const coins = nonNegativeCoin(amount, this.maxCoins, 'tradeCoins');

    return this.transactionManager.run([`trade:${tradeKey}`, `player:${player}`], async (tx) => {
      const trade = await this.#getOpenTradeForPlayer(tradeKey, player, tx);
      const balance = assertCoinRange(await this.coinRepository.getBalance(player, { tx }), this.maxCoins, 'balance');
      if (coins > balance) fail('INSUFFICIENT_COINS', 'cannot stage more coins than current balance', { balance: String(balance), requested: String(coins) });
      trade.offers[player].coins = coins;
      resetConfirmations(trade);
      this.#touch(trade);
      await this.tradeRepository.save(trade, { tx });
      return cloneTrade(trade);
    });
  }

  async confirmTrade({ tradeId, playerId }) {
    const tradeKey = normalizeId(tradeId, 'tradeId');
    const player = normalizeId(playerId, 'playerId');

    // Participant IDs are immutable after invite creation. Read them once only to
    // derive the complete lock set, then re-read and validate the trade in the tx.
    const snapshot = await this.#getTrade(tradeKey, undefined);
    const lockKeys = [
      `trade:${tradeKey}`,
      ...participantIds(snapshot).flatMap((id) => [`player:${id}`, `inventory:${id}`]),
    ];

    return this.transactionManager.run(lockKeys, async (tx) => {
      const trade = await this.#getOpenTradeForPlayer(tradeKey, player, tx);
      if (trade.inviterId !== snapshot.inviterId || trade.inviteeId !== snapshot.inviteeId) {
        fail('TRADE_IDENTITY_CHANGED', 'trade participants changed unexpectedly');
      }

      trade.confirmations[player] = true;
      this.#touch(trade);
      await this.tradeRepository.save(trade, { tx });

      if (!participantIds(trade).every((id) => trade.confirmations[id] === true)) {
        return { completed: false, trade: cloneTrade(trade) };
      }

      return this.#finalizeTrade(trade, tx);
    });
  }

  async cancelTrade({ tradeId, playerId, reason = 'cancelled' }) {
    const tradeKey = normalizeId(tradeId, 'tradeId');
    const player = normalizeId(playerId, 'playerId');
    return this.transactionManager.run([`trade:${tradeKey}`, `player:${player}`], async (tx) => {
      const trade = await this.#getTrade(tradeKey, tx);
      assertParticipant(trade, player);
      if (!isTradeActive(trade.status)) fail('TRADE_NOT_ACTIVE', 'trade is not active');
      trade.status = TRADE_STATUS.CANCELLED;
      trade.cancelReason = String(reason || 'cancelled');
      resetConfirmations(trade);
      this.#touch(trade);
      await this.tradeRepository.save(trade, { tx });
      return cloneTrade(trade);
    });
  }

  async handleDisconnect(playerId) {
    const player = normalizeId(playerId, 'playerId');
    const snapshot = await this.tradeRepository.findActiveByPlayer(player, {});
    if (!snapshot) return null;

    const lockKeys = [
      `trade:${snapshot.id}`,
      ...participantIds(snapshot).map((id) => `player:${id}`),
    ];
    return this.transactionManager.run(lockKeys, async (tx) => {
      const trade = await this.#getTrade(snapshot.id, tx);
      assertParticipant(trade, player);
      if (!isTradeActive(trade.status)) return null;
      trade.status = TRADE_STATUS.CANCELLED;
      trade.cancelReason = `disconnect:${player}`;
      resetConfirmations(trade);
      this.#touch(trade);
      await this.tradeRepository.save(trade, { tx });
      return cloneTrade(trade);
    });
  }

  async #finalizeTrade(trade, tx) {
    const [leftId, rightId] = participantIds(trade);
    const leftOffer = trade.offers[leftId];
    const rightOffer = trade.offers[rightId];

    const stagedSerials = [...leftOffer.items, ...rightOffer.items].map((entry) => entry.serial);
    if (new Set(stagedSerials).size !== stagedSerials.length) {
      fail('DUPLICATE_TRADE_SERIAL', 'same serial cannot appear more than once in a trade');
    }

    const leftCoins = nonNegativeCoin(leftOffer.coins, this.maxCoins, 'leftTradeCoins');
    const rightCoins = nonNegativeCoin(rightOffer.coins, this.maxCoins, 'rightTradeCoins');
    const leftBalance = assertCoinRange(await this.coinRepository.getBalance(leftId, { tx }), this.maxCoins, 'leftBalance');
    const rightBalance = assertCoinRange(await this.coinRepository.getBalance(rightId, { tx }), this.maxCoins, 'rightBalance');

    const leftAfterDebit = checkedSubtractCoins(leftBalance, leftCoins, this.maxCoins, 'leftBalance');
    const rightAfterDebit = checkedSubtractCoins(rightBalance, rightCoins, this.maxCoins, 'rightBalance');
    const leftFinal = checkedAddCoins(leftAfterDebit, rightCoins, this.maxCoins, 'leftBalance');
    const rightFinal = checkedAddCoins(rightAfterDebit, leftCoins, this.maxCoins, 'rightBalance');

    const leftItems = await this.#validateTradeItems(leftId, leftOffer.items, tx);
    const rightItems = await this.#validateTradeItems(rightId, rightOffer.items, tx);

    const leftCapacity = await this.inventoryPort.canReceiveTrade({
      playerId: leftId,
      incoming: rightItems,
      outgoing: leftItems,
      tx,
    });
    if (!leftCapacity || leftCapacity.ok !== true) {
      fail('INVENTORY_CAPACITY', 'left participant cannot receive trade items', { playerId: leftId, reason: leftCapacity?.reason ?? 'unknown' });
    }

    const rightCapacity = await this.inventoryPort.canReceiveTrade({
      playerId: rightId,
      incoming: leftItems,
      outgoing: rightItems,
      tx,
    });
    if (!rightCapacity || rightCapacity.ok !== true) {
      fail('INVENTORY_CAPACITY', 'right participant cannot receive trade items', { playerId: rightId, reason: rightCapacity?.reason ?? 'unknown' });
    }

    for (const item of leftItems) {
      await this.inventoryPort.transferItem({
        fromPlayerId: leftId,
        toPlayerId: rightId,
        itemSerial: item.serial,
        quantity: item.quantity,
        tx,
      });
    }
    for (const item of rightItems) {
      await this.inventoryPort.transferItem({
        fromPlayerId: rightId,
        toPlayerId: leftId,
        itemSerial: item.serial,
        quantity: item.quantity,
        tx,
      });
    }

    await this.coinRepository.setBalance(leftId, leftFinal, { tx });
    await this.coinRepository.setBalance(rightId, rightFinal, { tx });

    trade.status = TRADE_STATUS.COMPLETED;
    trade.completedAt = this.clock().toISOString();
    this.#touch(trade);
    await this.tradeRepository.save(trade, { tx });

    return {
      completed: true,
      trade: cloneTrade(trade),
      balances: { [leftId]: leftFinal, [rightId]: rightFinal },
    };
  }

  async #validateTradeItems(playerId, stagedItems, tx) {
    const validated = [];
    for (const staged of stagedItems) {
      const item = await this.#assertUniqueOwnedItem({
        playerId,
        serial: staged.serial,
        quantity: staged.quantity,
        tx,
      });
      if (item.tradeable === false) fail('ITEM_NOT_TRADEABLE', 'item cannot be traded', { serial: staged.serial });
      validated.push({ ...item, serial: staged.serial, quantity: staged.quantity });
    }
    return validated;
  }

  async #assertUniqueOwnedItem({ playerId, serial, quantity, tx }) {
    const occurrences = Number(await this.inventoryPort.countSerial({ itemSerial: serial, tx }));
    if (!Number.isSafeInteger(occurrences) || occurrences !== 1) {
      fail('INVALID_ITEM_SERIAL', 'item serial must exist exactly once', { serial, occurrences });
    }
    const item = await this.inventoryPort.getOwnedItem({ playerId, itemSerial: serial, tx });
    if (!item) fail('ITEM_NOT_OWNED', 'item does not belong to player', { playerId, serial });
    if (positiveQuantity(item.quantity, 'ownedQuantity') < quantity) {
      fail('INSUFFICIENT_ITEM_QUANTITY', 'not enough item quantity', { serial, owned: item.quantity, requested: quantity });
    }
    return item;
  }

  async #assertNoActiveTrade(playerId, tx) {
    const existing = await this.tradeRepository.findActiveByPlayer(playerId, { tx });
    if (existing) fail('PLAYER_ALREADY_TRADING', 'player already has an active trade', { playerId, tradeId: existing.id });
  }

  async #getTrade(tradeId, tx) {
    const trade = await this.tradeRepository.get(tradeId, { tx });
    if (!trade) fail('TRADE_NOT_FOUND', 'trade not found', { tradeId });
    return trade;
  }

  async #getOpenTradeForPlayer(tradeId, playerId, tx) {
    const trade = await this.#getTrade(tradeId, tx);
    assertParticipant(trade, playerId);
    if (trade.status !== TRADE_STATUS.OPEN) fail('TRADE_NOT_OPEN', 'trade is not open', { tradeId, status: trade.status });
    return trade;
  }

  #touch(trade) {
    trade.updatedAt = this.clock().toISOString();
  }
}

function cloneTrade(trade) {
  return structuredClone(trade);
}

module.exports = { EconomyService };
