'use strict';

const REQUIRED_METHODS = Object.freeze({
  coinRepository: ['getBalance', 'setBalance'],
  inventoryPort: [
    'canReceiveNpcPurchase',
    'addNpcPurchase',
    'getOwnedItem',
    'removeOwnedItem',
    'countSerial',
    'canReceiveTrade',
    'transferItem',
  ],
  merchantPort: ['assertInteraction', 'getOffer'],
  tradeRepository: ['create', 'get', 'save', 'findActiveByPlayer'],
  transactionManager: ['run'],
  auditPort: ['append'],
});

function assertContract(name, value) {
  if (!value || typeof value !== 'object') {
    throw new TypeError(`${name} is required`);
  }
  for (const method of REQUIRED_METHODS[name] ?? []) {
    if (typeof value[method] !== 'function') {
      throw new TypeError(`${name}.${method} must be a function`);
    }
  }
  return value;
}

module.exports = { REQUIRED_METHODS, assertContract };
