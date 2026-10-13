'use strict';

const {
  EQUIPMENT_SLOT_COUNT,
  INVENTORY_SLOT_COUNT,
  INN_SLOT_COUNT,
  CONTAINER_TYPES,
} = require('./constants');
const { fail } = require('./errors');

function emptyState(ownerId) {
  return {
    ownerId: String(ownerId),
    version: 0,
    equipment: Array(EQUIPMENT_SLOT_COUNT).fill(null),
    inventory: Array(INVENTORY_SLOT_COUNT).fill(null),
    inn: Array(INN_SLOT_COUNT).fill(null),
  };
}

function cloneState(state) {
  return {
    ownerId: state.ownerId,
    version: state.version,
    equipment: state.equipment.map(cloneItem),
    inventory: state.inventory.map(cloneItem),
    inn: state.inn.map(cloneItem),
  };
}

function cloneItem(item) {
  return item == null ? null : Object.freeze({ ...item });
}

function getContainer(state, type) {
  if (!Object.values(CONTAINER_TYPES).includes(type)) {
    fail('INVALID_CONTAINER', `Unknown container type: ${type}`);
  }
  return state[type];
}

function validatePosition(state, position) {
  if (!position || typeof position !== 'object') fail('INVALID_POSITION', 'Position is required.');
  const container = getContainer(state, position.container);
  const slot = Number(position.slot);
  if (!Number.isInteger(slot) || slot < 0 || slot >= container.length) {
    fail('INVALID_SLOT', `Slot ${position.slot} is invalid for ${position.container}.`);
  }
  return { container, slot };
}

function getItem(state, position) {
  const { container, slot } = validatePosition(state, position);
  return container[slot];
}

function setItem(state, position, item) {
  const { container, slot } = validatePosition(state, position);
  container[slot] = item;
}

function listSerials(state) {
  const serials = [];
  for (const type of Object.values(CONTAINER_TYPES)) {
    for (const item of state[type]) if (item) serials.push(item.serial);
  }
  return serials;
}

function assertNoLocalDuplicateSerials(state) {
  const seen = new Set();
  for (const serial of listSerials(state)) {
    if (seen.has(serial)) fail('DUPLICATE_SERIAL', `Duplicate serial inside owner state: ${serial}`, { serial });
    seen.add(serial);
  }
}

module.exports = {
  emptyState,
  cloneState,
  getContainer,
  validatePosition,
  getItem,
  setItem,
  listSerials,
  assertNoLocalDuplicateSerials,
};
