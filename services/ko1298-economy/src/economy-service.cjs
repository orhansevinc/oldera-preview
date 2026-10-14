'use strict';

const {
  DEFAULT_MAX_COIN_BALANCE,
  TRADE_STATUS,
  ESCROW_STATE,
  fail,
  normalizeId,
  normalizeReason,
  assertCoinRange,
  checkedAddCoins,
  checkedSubtractCoins,
  checkedMultiplyCoins,
  positiveQuantity,
  positiveDurationMs,
  nonNegativeCoin,
  isTradeActive,
  participantIds,
  assertParticipant,
  resetConfirmations,
} = require('./domain.cjs');
const { assertContract } = require('./contracts.cjs');

const NOOP_AUDIT = Object.freeze({ append: async () => {} });

class EconomyService {
  constructor({
    coinRepository,
    inventoryPort,
    merchantPort,
    tradeRepository,
    transactionManager,
    auditPort = NOOP_AUDIT,
    maxCoins = DEFAULT_MAX_COIN_BALANCE,
    tradeTimeoutMs = 120_000,
    idFactory = () => `trade-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    clock = () => new Date(),
  }) {
    this.coinRepository = assertContract('coinRepository', coinRepository);
    this.inventoryPort = assertContract('inventoryPort', inventoryPort);
    this.merchantPort = assertContract('merchantPort', merchantPort);
    this.tradeRepository = assertContract('tradeRepository', tradeRepository);
    this.transactionManager = assertContract('transactionManager', transactionManager);
    this.auditPort = assertContract('auditPort', auditPort);
    this.maxCoins = assertCoinRange(maxCoins, BigInt(Number.MAX_SAFE_INTEGER), 'maxCoins');
    this.tradeTimeoutMs = positiveDurationMs(tradeTimeoutMs, 'tradeTimeoutMs');
    this.idFactory = idFactory;
    this.clock = clock;
  }

  async getCoinBalance(playerId) {
    const id = normalizeId(playerId, 'playerId');
    const balance = await this.coinRepository.getBalance(id, {});
    return assertCoinRange(balance, this.maxCoins, 'balance');
  }

  async getReservations(playerId) {
    const player = normalizeId(playerId, 'playerId');
    const trade = await this.tradeRepository.findActiveByPlayer(player, {});
    if (!trade || !isTradeActive(trade.status)) return { tradeId: null, coins: 0n, items: [] };
    const expiresAt = Date.parse(trade.expiresAt ?? '');
    if (Number.isFinite(expiresAt) && this.#now().getTime() >= expiresAt) {
      return { tradeId: null, coins: 0n, items: [] };
    }
    const offer = trade.offers?.[player] ?? { coins: 0n, items: [] };
    return {
      tradeId: trade.id,
      status: trade.status,
      expiresAt: trade.expiresAt ?? null,
      coins: nonNegativeCoin(offer.coins ?? 0n, this.maxCoins, 'reservedCoins'),
      items: (offer.items ?? []).map((entry) => ({
        serial: normalizeId(entry.serial, 'itemSerial'),
        quantity: positiveQuantity(entry.quantity),
      })),
    };
  }

  async addCoins({ playerId, amount, reason, metadata = {} }) {
    const player = normalizeId(playerId, 'playerId');
    const delta = nonNegativeCoin(amount, this.maxCoins, 'amount');
    const transactionReason = normalizeReason(reason);
    return this.transactionManager.run([`player:${player}`], async (tx) => {
      const balance = assertCoinRange(await this.coinRepository.getBalance(player, { tx }), this.maxCoins, 'balance');
      const nextBalance = checkedAddCoins(balance, delta, this.maxCoins, 'balance');
      await this.coinRepository.setBalance(player, nextBalance, { tx, reason: transactionReason, metadata });
      await this.#audit('coin.credit', { playerId: player, amount: delta, balance: nextBalance, reason: transactionReason, metadata }, tx);
      return nextBalance;
    });
  }

  async removeCoins({ playerId, amount, reason, metadata = {} }) {
    const player = normalizeId(playerId, 'playerId');
    const delta = nonNegativeCoin(amount, this.maxCoins, 'amount');
    const transactionReason = normalizeReason(reason);
    return this.transactionManager.run([`player:${player}`], async (tx) => {
      const balance = assertCoinRange(await this.coinRepository.getBalance(player, { tx }), this.maxCoins, 'balance');
      const reservation = await this.#reservationForPlayer(player, tx);
      this.#assertSpendable(balance, reservation.coins, delta, player);
      const nextBalance = checkedSubtractCoins(balance, delta, this.maxCoins, 'balance');
      await this.coinRepository.setBalance(player, nextBalance, { tx, reason: transactionReason, metadata });
      await this.#audit('coin.debit', { playerId: player, amount: delta, balance: nextBalance, reason: transactionReason, metadata }, tx);
      return nextBalance;
    });
  }

  async buyFromNpc({ playerId, npcId, itemTemplateId, quantity, clientUnitPrice = null }) {
    const player = normalizeId(playerId, 'playerId');
    const npc = normalizeId(npcId, 'npcId');
    const templateId = normalizeId(itemTemplateId, 'itemTemplateId');
    const qty = positiveQuantity(quantity);

    return this.transactionManager.run([`player:${player}`, `inventory:${player}`], async (tx) => {
      const merchantContext = await this.merchantPort.assertInteraction({ playerId: player, npcId: npc, tx });
      const offer = await this.merchantPort.getOffer({ npcId: npc, itemTemplateId: templateId, merchantContext, tx });
      if (!offer || offer.npcSellPrice == null || offer.canBuy === false) {
        fail('ITEM_NOT_SOLD_BY_NPC', 'merchant does not sell this item', { npcId: npc, itemTemplateId: templateId });
      }

      const canonicalUnitPrice = assertCoinRange(offer.npcSellPrice, this.maxCoins, 'npcSellPrice');
      this.#assertClientPrice(clientUnitPrice, canonicalUnitPrice, 'buy');
      const total = checkedMultiplyCoins(canonicalUnitPrice, qty, this.maxCoins, 'npcSellPrice');
      const balance = assertCoinRange(await this.coinRepository.getBalance(player, { tx }), this.maxCoins, 'balance');
      const reservation = await this.#reservationForPlayer(player, tx);
      this.#assertSpendable(balance, reservation.coins, total, player);
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

      await this.coinRepository.setBalance(player, nextBalance, {
        tx,
        reason: 'merchant.buy',
        metadata: { npcId: npc, itemTemplateId: templateId, quantity: qty },
      });
      const credited = await this.inventoryPort.addNpcPurchase({
        playerId: player,
        itemTemplateId: templateId,
        quantity: qty,
        sourceNpcId: npc,
        tx,
      });
      await this.#audit('merchant.buy', {
        playerId: player,
        npcId: npc,
        itemTemplateId: templateId,
        quantity: qty,
        unitPrice: canonicalUnitPrice,
        total,
        balance: nextBalance,
      }, tx);

      return {
        playerId: player,
        npcId: npc,
        itemTemplateId: templateId,
        quantity: qty,
        unitPrice: canonicalUnitPrice,
        total,
        balance: nextBalance,
        itemResult: credited,
      };
    });
  }

  async sellToNpc({ playerId, npcId, itemSerial, quantity, clientUnitPrice = null }) {
    const player = normalizeId(playerId, 'playerId');
    const npc = normalizeId(npcId, 'npcId');
    const serial = normalizeId(itemSerial, 'itemSerial');
    const qty = positiveQuantity(quantity);

    return this.transactionManager.run([`player:${player}`, `inventory:${player}`, `serial:${serial}`], async (tx) => {
      const merchantContext = await this.merchantPort.assertInteraction({ playerId: player, npcId: npc, tx });
      const item = await this.#assertUniqueOwnedItem({ playerId: player, serial, quantity: qty, tx });
      const reservation = await this.#reservationForPlayer(player, tx);
      const reservedQty = reservation.items.find((entry) => entry.serial === serial)?.quantity ?? 0;
      if (positiveQuantity(item.quantity, 'ownedQuantity') - reservedQty < qty) {
        fail('ITEM_RESERVED', 'item quantity is reserved by an active trade', { serial, reservedQty, requested: qty });
      }

      const offer = await this.merchantPort.getOffer({
        npcId: npc,
        itemTemplateId: String(item.templateId),
        merchantContext,
        tx,
      });
      if (!offer || offer.npcBuyPrice == null || offer.canSell === false || item.sellable === false) {
        fail('ITEM_NOT_BUYABLE_BY_NPC', 'merchant cannot buy this item', { npcId: npc, itemTemplateId: item.templateId });
      }

      const canonicalUnitPrice = assertCoinRange(offer.npcBuyPrice, this.maxCoins, 'npcBuyPrice');
      this.#assertClientPrice(clientUnitPrice, canonicalUnitPrice, 'sell');
      const total = checkedMultiplyCoins(canonicalUnitPrice, qty, this.maxCoins, 'npcBuyPrice');
      const balance = assertCoinRange(await this.coinRepository.getBalance(player, { tx }), this.maxCoins, 'balance');
      const nextBalance = checkedAddCoins(balance, total, this.maxCoins, 'balance');

      await this.inventoryPort.removeOwnedItem({ playerId: player, itemSerial: serial, quantity: qty, tx });
      await this.coinRepository.setBalance(player, nextBalance, {
        tx,
        reason: 'merchant.sell',
        metadata: { npcId: npc, itemSerial: serial, itemTemplateId: String(item.templateId), quantity: qty },
      });
      await this.#audit('merchant.sell', {
        playerId: player,
        npcId: npc,
        itemSerial: serial,
        itemTemplateId: String(item.templateId),
        quantity: qty,
        unitPrice: canonicalUnitPrice,
        total,
        balance: nextBalance,
      }, tx);

      return {
        playerId: player,
        npcId: npc,
        itemSerial: serial,
        itemTemplateId: String(item.templateId),
        quantity: qty,
        unitPrice: canonicalUnitPrice,
        total,
        balance: nextBalance,
      };
    });
  }

  async inviteTrade({ fromPlayerId, toPlayerId }) {
    const from = normalizeId(fromPlayerId, 'fromPlayerId');
    const to = normalizeId(toPlayerId, 'toPlayerId');
    if (from === to) fail('SELF_TRADE', 'cannot trade with self');

    await this.#expireActiveTradeForPlayer(from);
    await this.#expireActiveTradeForPlayer(to);
    return this.transactionManager.run([`player:${from}`, `player:${to}`], async (tx) => {
      await this.#assertNoActiveTrade(from, tx);
      await this.#assertNoActiveTrade(to, tx);
      const now = this.#now();
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
        escrow: { mode: 'logical-reservation', state: ESCROW_STATE.INVITED },
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + this.tradeTimeoutMs).toISOString(),
        completedAt: null,
        cancelReason: null,
      };
      await this.tradeRepository.create(trade, { tx });
      await this.#audit('trade.invited', { tradeId: trade.id, fromPlayerId: from, toPlayerId: to, expiresAt: trade.expiresAt }, tx);
      return cloneTrade(trade);
    });
  }

  async acceptTrade({ tradeId, playerId }) {
    const tradeKey = normalizeId(tradeId, 'tradeId');
    await this.#guardNotExpired(tradeKey);
    const player = normalizeId(playerId, 'playerId');
    return this.transactionManager.run([`trade:${tradeKey}`, `player:${player}`], async (tx) => {
      const trade = await this.#getTrade(tradeKey, tx);
      if (trade.status !== TRADE_STATUS.PENDING) fail('TRADE_NOT_PENDING', 'trade is not awaiting acceptance');
      if (trade.inviteeId !== player) fail('ONLY_INVITEE_CAN_ACCEPT', 'only invitee can accept trade');
      trade.status = TRADE_STATUS.OPEN;
      trade.escrow = { mode: 'logical-reservation', state: ESCROW_STATE.HOLDING };
      this.#touch(trade);
      await this.tradeRepository.save(trade, { tx });
      await this.#audit('trade.accepted', { tradeId: trade.id, playerId: player }, tx);
      return cloneTrade(trade);
    });
  }

  async rejectTrade({ tradeId, playerId }) {
    const tradeKey = normalizeId(tradeId, 'tradeId');
    await this.#guardNotExpired(tradeKey);
    const player = normalizeId(playerId, 'playerId');
    return this.transactionManager.run([`trade:${tradeKey}`, `player:${player}`], async (tx) => {
      const trade = await this.#getTrade(tradeKey, tx);
      if (trade.status !== TRADE_STATUS.PENDING) fail('TRADE_NOT_PENDING', 'trade is not awaiting acceptance');
      if (trade.inviteeId !== player) fail('ONLY_INVITEE_CAN_REJECT', 'only invitee can reject trade');
      trade.status = TRADE_STATUS.REJECTED;
      trade.cancelReason = 'rejected';
      trade.escrow = { mode: 'logical-reservation', state: ESCROW_STATE.RELEASED };
      this.#touch(trade);
      await this.tradeRepository.save(trade, { tx });
      await this.#audit('trade.rejected', { tradeId: trade.id, playerId: player }, tx);
      return cloneTrade(trade);
    });
  }

  async stageTradeItem({ tradeId, playerId, itemSerial, quantity }) {
    const tradeKey = normalizeId(tradeId, 'tradeId');
    await this.#guardNotExpired(tradeKey);
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
        await this.#audit('trade.item_reserved', { tradeId: trade.id, playerId: player, itemSerial: serial, quantity: qty }, tx);
        return cloneTrade(trade);
      },
    );
  }

  async unstageTradeItem({ tradeId, playerId, itemSerial }) {
    const tradeKey = normalizeId(tradeId, 'tradeId');
    await this.#guardNotExpired(tradeKey);
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
      await this.#audit('trade.item_unreserved', { tradeId: trade.id, playerId: player, itemSerial: serial }, tx);
      return cloneTrade(trade);
    });
  }

  async stageTradeCoin({ tradeId, playerId, amount }) {
    const tradeKey = normalizeId(tradeId, 'tradeId');
    await this.#guardNotExpired(tradeKey);
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
      await this.#audit('trade.coin_reserved', { tradeId: trade.id, playerId: player, amount: coins }, tx);
      return cloneTrade(trade);
    });
  }

  async confirmTrade({ tradeId, playerId }) {
    const tradeKey = normalizeId(tradeId, 'tradeId');
    await this.#guardNotExpired(tradeKey);
    const player = normalizeId(playerId, 'playerId');

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
      await this.#audit('trade.confirmed', { tradeId: trade.id, playerId: player }, tx);

      if (!participantIds(trade).every((id) => trade.confirmations[id] === true)) {
        return { completed: false, trade: cloneTrade(trade) };
      }

      return this.#finalizeTrade(trade, tx);
    });
  }

  async cancelTrade({ tradeId, playerId, reason = 'cancelled' }) {
    const tradeKey = normalizeId(tradeId, 'tradeId');
    const player = normalizeId(playerId, 'playerId');
    const cancelReason = normalizeReason(reason, 'cancelReason');
    return this.transactionManager.run([`trade:${tradeKey}`, `player:${player}`], async (tx) => {
      const trade = await this.#getTrade(tradeKey, tx);
      assertParticipant(trade, player);
      if (!isTradeActive(trade.status)) fail('TRADE_NOT_ACTIVE', 'trade is not active');
      trade.status = TRADE_STATUS.CANCELLED;
      trade.cancelReason = cancelReason;
      trade.escrow = { mode: 'logical-reservation', state: ESCROW_STATE.RELEASED };
      resetConfirmations(trade);
      this.#touch(trade);
      await this.tradeRepository.save(trade, { tx });
      await this.#audit('trade.cancelled', { tradeId: trade.id, playerId: player, reason: cancelReason }, tx);
      return cloneTrade(trade);
    });
  }

  async expireTrade({ tradeId }) {
    const tradeKey = normalizeId(tradeId, 'tradeId');
    const snapshot = await this.#getTrade(tradeKey, undefined);
    if (!isTradeActive(snapshot.status)) return { expired: false, trade: cloneTrade(snapshot) };
    const lockKeys = [`trade:${tradeKey}`, ...participantIds(snapshot).map((id) => `player:${id}`)];
    return this.transactionManager.run(lockKeys, async (tx) => {
      const trade = await this.#getTrade(tradeKey, tx);
      if (!isTradeActive(trade.status)) return { expired: false, trade: cloneTrade(trade) };
      const expiresAt = Date.parse(trade.expiresAt ?? '');
      if (!Number.isFinite(expiresAt)) fail('INVALID_TRADE_EXPIRY', 'trade expiry is invalid', { tradeId: trade.id });
      if (this.#now().getTime() < expiresAt) return { expired: false, trade: cloneTrade(trade) };
      trade.status = TRADE_STATUS.CANCELLED;
      trade.cancelReason = 'timeout';
      trade.escrow = { mode: 'logical-reservation', state: ESCROW_STATE.RELEASED };
      resetConfirmations(trade);
      this.#touch(trade);
      await this.tradeRepository.save(trade, { tx });
      await this.#audit('trade.expired', { tradeId: trade.id, participants: participantIds(trade) }, tx);
      return { expired: true, trade: cloneTrade(trade) };
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
      trade.escrow = { mode: 'logical-reservation', state: ESCROW_STATE.RELEASED };
      resetConfirmations(trade);
      this.#touch(trade);
      await this.tradeRepository.save(trade, { tx });
      await this.#audit('trade.disconnect_cancelled', { tradeId: trade.id, playerId: player }, tx);
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

    const leftCapacity = await this.inventoryPort.canReceiveTrade({ playerId: leftId, incoming: rightItems, outgoing: leftItems, tx });
    if (!leftCapacity || leftCapacity.ok !== true) {
      fail('INVENTORY_CAPACITY', 'left participant cannot receive trade items', { playerId: leftId, reason: leftCapacity?.reason ?? 'unknown' });
    }
    const rightCapacity = await this.inventoryPort.canReceiveTrade({ playerId: rightId, incoming: leftItems, outgoing: rightItems, tx });
    if (!rightCapacity || rightCapacity.ok !== true) {
      fail('INVENTORY_CAPACITY', 'right participant cannot receive trade items', { playerId: rightId, reason: rightCapacity?.reason ?? 'unknown' });
    }

    for (const item of leftItems) {
      await this.inventoryPort.transferItem({ fromPlayerId: leftId, toPlayerId: rightId, itemSerial: item.serial, quantity: item.quantity, tx });
    }
    for (const item of rightItems) {
      await this.inventoryPort.transferItem({ fromPlayerId: rightId, toPlayerId: leftId, itemSerial: item.serial, quantity: item.quantity, tx });
    }

    await this.coinRepository.setBalance(leftId, leftFinal, {
      tx,
      reason: 'trade.swap',
      metadata: { tradeId: trade.id, counterpartyId: rightId },
    });
    await this.coinRepository.setBalance(rightId, rightFinal, {
      tx,
      reason: 'trade.swap',
      metadata: { tradeId: trade.id, counterpartyId: leftId },
    });

    trade.status = TRADE_STATUS.COMPLETED;
    trade.escrow = { mode: 'logical-reservation', state: ESCROW_STATE.COMMITTED };
    trade.completedAt = this.#now().toISOString();
    this.#touch(trade);
    await this.tradeRepository.save(trade, { tx });
    await this.#audit('trade.completed', {
      tradeId: trade.id,
      participants: participantIds(trade),
      coinTransfers: { [leftId]: leftCoins, [rightId]: rightCoins },
      itemSerials: stagedSerials,
    }, tx);

    return { completed: true, trade: cloneTrade(trade), balances: { [leftId]: leftFinal, [rightId]: rightFinal } };
  }

  async #validateTradeItems(playerId, stagedItems, tx) {
    const validated = [];
    for (const staged of stagedItems) {
      const item = await this.#assertUniqueOwnedItem({ playerId, serial: staged.serial, quantity: staged.quantity, tx });
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

  async #reservationForPlayer(playerId, tx) {
    const trade = await this.tradeRepository.findActiveByPlayer(playerId, { tx });
    if (!trade || !isTradeActive(trade.status)) return { coins: 0n, items: [] };
    const expiresAt = Date.parse(trade.expiresAt ?? '');
    if (Number.isFinite(expiresAt) && this.#now().getTime() >= expiresAt) return { coins: 0n, items: [] };
    const offer = trade.offers?.[playerId] ?? { coins: 0n, items: [] };
    return {
      coins: nonNegativeCoin(offer.coins ?? 0n, this.maxCoins, 'reservedCoins'),
      items: (offer.items ?? []).map((entry) => ({ serial: entry.serial, quantity: positiveQuantity(entry.quantity) })),
    };
  }

  #assertSpendable(balance, reserved, requested, playerId) {
    const safeBalance = assertCoinRange(balance, this.maxCoins, 'balance');
    const safeReserved = nonNegativeCoin(reserved, this.maxCoins, 'reservedCoins');
    const spend = nonNegativeCoin(requested, this.maxCoins, 'requestedCoins');
    if (spend > safeBalance) {
      fail('INSUFFICIENT_COINS', 'insufficient coin balance', { balance: String(safeBalance), required: String(spend) });
    }
    const available = safeReserved > safeBalance ? 0n : safeBalance - safeReserved;
    if (spend > available) {
      fail('COIN_RESERVED', 'coin amount is reserved by an active trade', {
        playerId,
        balance: String(safeBalance),
        reserved: String(safeReserved),
        available: String(available),
        requested: String(spend),
      });
    }
  }

  #assertClientPrice(clientUnitPrice, canonicalUnitPrice, operation) {
    if (clientUnitPrice == null) return;
    const client = assertCoinRange(clientUnitPrice, this.maxCoins, 'clientUnitPrice');
    if (client !== canonicalUnitPrice) {
      fail('PRICE_MISMATCH', 'client price does not match canonical merchant price', {
        operation,
        clientUnitPrice: String(client),
        canonicalUnitPrice: String(canonicalUnitPrice),
      });
    }
  }

  async #guardNotExpired(tradeId) {
    const result = await this.expireTrade({ tradeId });
    if (result.expired) fail('TRADE_TIMEOUT', 'trade has expired', { tradeId });
  }

  async #expireActiveTradeForPlayer(playerId) {
    const existing = await this.tradeRepository.findActiveByPlayer(playerId, {});
    if (!existing || !isTradeActive(existing.status)) return;
    const expiresAt = Date.parse(existing.expiresAt ?? '');
    if (Number.isFinite(expiresAt) && this.#now().getTime() >= expiresAt) {
      await this.expireTrade({ tradeId: existing.id });
    }
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

  async #audit(type, payload, tx) {
    await this.auditPort.append({ type, at: this.#now().toISOString(), ...payload }, { tx });
  }

  #touch(trade) {
    trade.updatedAt = this.#now().toISOString();
  }

  #now() {
    const value = this.clock();
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) throw new TypeError('clock must return a valid date');
    return date;
  }
}

function cloneTrade(trade) {
  return structuredClone(trade);
}

module.exports = { EconomyService };
