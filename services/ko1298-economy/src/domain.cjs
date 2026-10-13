'use strict';

const DEFAULT_MAX_COIN_BALANCE = 2_100_000_000n;

const TRADE_STATUS = Object.freeze({
  PENDING: 'pending',
  OPEN: 'open',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled',
  COMPLETED: 'completed',
});

class EconomyError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'EconomyError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new EconomyError(code, message, details);
}

function normalizeId(value, fieldName) {
  const normalized = String(value ?? '').trim();
  if (!normalized) fail('INVALID_ID', `${fieldName} is required`, { fieldName });
  return normalized;
}

function toCoin(value, fieldName = 'coins') {
  let amount;
  try {
    amount = typeof value === 'bigint' ? value : BigInt(value);
  } catch {
    fail('INVALID_COIN_AMOUNT', `${fieldName} must be an integer`, { fieldName, value });
  }
  return amount;
}

function assertCoinRange(value, maxCoins, fieldName = 'coins') {
  const amount = toCoin(value, fieldName);
  if (amount < 0n) fail('NEGATIVE_COIN', `${fieldName} cannot be negative`, { fieldName, amount: String(amount) });
  if (amount > maxCoins) fail('COIN_OVERFLOW', `${fieldName} exceeds coin cap`, { fieldName, amount: String(amount), maxCoins: String(maxCoins) });
  return amount;
}

function checkedAddCoins(left, right, maxCoins, fieldName = 'coins') {
  const result = toCoin(left, fieldName) + toCoin(right, fieldName);
  return assertCoinRange(result, maxCoins, fieldName);
}

function checkedSubtractCoins(left, right, maxCoins, fieldName = 'coins') {
  const a = assertCoinRange(left, maxCoins, fieldName);
  const b = assertCoinRange(right, maxCoins, fieldName);
  if (b > a) fail('INSUFFICIENT_COINS', 'insufficient coin balance', { balance: String(a), required: String(b) });
  return a - b;
}

function checkedMultiplyCoins(unitPrice, quantity, maxCoins, fieldName = 'price') {
  const unit = assertCoinRange(unitPrice, maxCoins, fieldName);
  const qty = positiveQuantity(quantity);
  const total = unit * BigInt(qty);
  return assertCoinRange(total, maxCoins, 'transactionTotal');
}

function positiveQuantity(value, fieldName = 'quantity') {
  const quantity = Number(value);
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    fail('INVALID_QUANTITY', `${fieldName} must be a positive safe integer`, { fieldName, value });
  }
  return quantity;
}

function nonNegativeCoin(value, maxCoins, fieldName = 'coins') {
  return assertCoinRange(value, maxCoins, fieldName);
}

function isTradeActive(status) {
  return status === TRADE_STATUS.PENDING || status === TRADE_STATUS.OPEN;
}

function participantIds(trade) {
  return [trade.inviterId, trade.inviteeId];
}

function assertParticipant(trade, playerId) {
  const id = normalizeId(playerId, 'playerId');
  if (!participantIds(trade).includes(id)) {
    fail('NOT_TRADE_PARTICIPANT', 'player is not part of this trade', { tradeId: trade.id, playerId: id });
  }
  return id;
}

function otherParticipant(trade, playerId) {
  const id = assertParticipant(trade, playerId);
  return trade.inviterId === id ? trade.inviteeId : trade.inviterId;
}

function resetConfirmations(trade) {
  trade.confirmations[trade.inviterId] = false;
  trade.confirmations[trade.inviteeId] = false;
}

module.exports = {
  DEFAULT_MAX_COIN_BALANCE,
  TRADE_STATUS,
  EconomyError,
  fail,
  normalizeId,
  toCoin,
  assertCoinRange,
  checkedAddCoins,
  checkedSubtractCoins,
  checkedMultiplyCoins,
  positiveQuantity,
  nonNegativeCoin,
  isTradeActive,
  participantIds,
  assertParticipant,
  otherParticipant,
  resetConfirmations,
};
