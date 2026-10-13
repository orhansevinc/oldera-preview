'use strict';

const {
  INVENTORY_SLOT_COUNT,
  INN_PAGE_COUNT,
  INN_SLOTS_PER_PAGE,
  INN_SLOT_COUNT,
} = require('./constants');
const { fail } = require('./errors');

function assertPositiveId(value, name) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) fail('INVALID_ID', `${name} must be a positive integer.`, { name, value });
  return id;
}

function assertInventorySlot(slot) {
  const value = Number(slot);
  if (!Number.isInteger(value) || value < 0 || value >= INVENTORY_SLOT_COUNT) {
    fail('INVALID_INVENTORY_SLOT', `Inventory slot must be in 0..${INVENTORY_SLOT_COUNT - 1}.`, { slot });
  }
  return value;
}

function assertInnPosition(page, slot) {
  const p = Number(page);
  const s = Number(slot);
  if (!Number.isInteger(p) || p < 0 || p >= INN_PAGE_COUNT) {
    fail('INVALID_INN_PAGE', `Inn page must be in 0..${INN_PAGE_COUNT - 1}.`, { page });
  }
  if (!Number.isInteger(s) || s < 0 || s >= INN_SLOTS_PER_PAGE) {
    fail('INVALID_INN_SLOT', `Inn slot must be in 0..${INN_SLOTS_PER_PAGE - 1}.`, { slot });
  }
  return { page: p, slot: s, flatSlot: p * INN_SLOTS_PER_PAGE + s };
}

function createEmptyInventory() {
  return Array.from({ length: INVENTORY_SLOT_COUNT }, () => null);
}

function createEmptyInn() {
  return Array.from({ length: INN_SLOT_COUNT }, () => null);
}

function cloneItem(item) {
  return item == null ? null : { ...item };
}

function cloneInventory(items) {
  if (!Array.isArray(items) || items.length !== INVENTORY_SLOT_COUNT) {
    fail('INVALID_INVENTORY_STATE', `Inventory must contain exactly ${INVENTORY_SLOT_COUNT} slots.`);
  }
  return items.map(cloneItem);
}

function cloneInn(items) {
  if (!Array.isArray(items) || items.length !== INN_SLOT_COUNT) {
    fail('INVALID_INN_STATE', `Inn must contain exactly ${INN_SLOT_COUNT} slots.`);
  }
  return items.map(cloneItem);
}

function validateItem(item) {
  if (item == null) return;
  if (!Number.isInteger(Number(item.templateId)) || Number(item.templateId) <= 0) fail('INVALID_ITEM', 'Item templateId must be positive.', { item });
  if (!Number.isInteger(Number(item.serial)) || Number(item.serial) <= 0) fail('INVALID_ITEM', 'Item serial must be positive.', { item });
  if (!Number.isInteger(Number(item.quantity)) || Number(item.quantity) <= 0) fail('INVALID_ITEM', 'Item quantity must be positive.', { item });
}

function listItems(state) {
  return [
    ...state.inn.filter(Boolean),
    ...Object.values(state.characters).flatMap(character => character.inventory.filter(Boolean)),
  ];
}

function assertNoDuplicateSerials(state) {
  const seen = new Map();
  for (const item of listItems(state)) {
    validateItem(item);
    const serial = String(item.serial);
    if (seen.has(serial)) fail('DUPLICATE_SERIAL', `Serial ${serial} occurs more than once in account state.`, { serial });
    seen.set(serial, true);
  }
}

function itemTotals(state) {
  const totals = new Map();
  for (const item of listItems(state)) {
    const key = String(item.templateId);
    totals.set(key, (totals.get(key) || 0) + Number(item.quantity));
  }
  return totals;
}

function assertConserved(before, after) {
  const a = itemTotals(before);
  const b = itemTotals(after);
  const keys = new Set([...a.keys(), ...b.keys()]);
  for (const key of keys) {
    if ((a.get(key) || 0) !== (b.get(key) || 0)) {
      fail('ITEM_CONSERVATION_VIOLATION', 'Transfer attempted to create or destroy item quantity.', {
        templateId: Number(key),
        before: a.get(key) || 0,
        after: b.get(key) || 0,
      });
    }
  }
}

function cloneState(state) {
  const characters = {};
  for (const [characterId, character] of Object.entries(state.characters || {})) {
    characters[characterId] = {
      characterId: Number(character.characterId),
      inventory: cloneInventory(character.inventory),
    };
  }
  return {
    accountId: Number(state.accountId),
    version: Number(state.version || 0),
    inn: cloneInn(state.inn),
    characters,
  };
}

function emptyState(accountId) {
  return {
    accountId: assertPositiveId(accountId, 'accountId'),
    version: 0,
    inn: createEmptyInn(),
    characters: {},
  };
}

module.exports = {
  assertPositiveId,
  assertInventorySlot,
  assertInnPosition,
  createEmptyInventory,
  createEmptyInn,
  cloneState,
  emptyState,
  validateItem,
  listItems,
  assertNoDuplicateSerials,
  assertConserved,
};
