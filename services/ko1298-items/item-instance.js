'use strict';

const { fail } = require('./errors');

function normalizeSerial(serial) {
  if (typeof serial === 'bigint') serial = serial.toString();
  if (typeof serial === 'number') {
    if (!Number.isSafeInteger(serial) || serial < 0) {
      fail('INVALID_SERIAL', 'Numeric serials must be non-negative safe integers; use a decimal string for 64-bit values.');
    }
    serial = String(serial);
  }
  if (typeof serial !== 'string' || !/^\d+$/.test(serial)) {
    fail('INVALID_SERIAL', 'Serial must be an unsigned decimal string, bigint, or safe integer.');
  }
  return serial.replace(/^0+(?=\d)/, '');
}

function createItemInstance(template, { serial, quantity = 1, durability = undefined } = {}) {
  const normalizedSerial = normalizeSerial(serial);
  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty < 1) fail('INVALID_QUANTITY', 'Quantity must be a positive integer.');
  if (!template.stackable && qty !== 1) fail('NON_STACKABLE_QUANTITY', 'Non-stackable items must have quantity 1.');
  if (qty > template.maxStack) fail('STACK_LIMIT_EXCEEDED', `Quantity exceeds max stack ${template.maxStack}.`);

  const maxDurability = template.maxDurability == null ? null : Number(template.maxDurability);
  const resolvedDurability = durability == null ? maxDurability : Number(durability);
  if (resolvedDurability != null && (!Number.isInteger(resolvedDurability) || resolvedDurability < 0)) {
    fail('INVALID_DURABILITY', 'Durability must be a non-negative integer or null.');
  }

  return Object.freeze({
    templateId: template.id,
    serial: normalizedSerial,
    quantity: qty,
    durability: resolvedDurability,
  });
}

function withQuantity(item, quantity) {
  return Object.freeze({ ...item, quantity });
}

module.exports = { createItemInstance, normalizeSerial, withQuantity };
