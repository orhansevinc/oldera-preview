'use strict';

const { EQUIPMENT_SLOT_COUNT, INVENTORY_SLOT_COUNT, INN_SLOT_COUNT, CONTAINER_TYPES } = require('./constants');
const { fail } = require('./errors');

function emptyState(ownerId) {
  return { ownerId: String(ownerId), version: 0, equipment: Array(EQUIPMENT_SLOT_COUNT).fill(null), inventory: Array(INVENTORY_SLOT_COUNT).fill(null), inn: Array(INN_SLOT_COUNT).fill(null) };
}

function cloneState(state) {
  return { ownerId: String(state.ownerId), version: Number(state.version ?? 0), equipment: cloneContainer(state.equipment), inventory: cloneContainer(state.inventory), inn: cloneContainer(state.inn) };
}
function cloneContainer(value) { return value.map(item => item == null ? null : Object.freeze({ ...item, metadata: item.metadata ? Object.freeze({ ...item.metadata }) : undefined })); }

function getContainer(state, type) {
  if (!Object.values(CONTAINER_TYPES).includes(type)) fail('INVALID_CONTAINER', `Unknown container type: ${type}`);
  return state[type];
}
function validatePosition(state, position) {
  if (!position || typeof position !== 'object') fail('INVALID_POSITION', 'Position is required.');
  const container = getContainer(state, position.container);
  const slot = Number(position.slot);
  if (!Number.isInteger(slot) || slot < 0 || slot >= container.length) fail('INVALID_SLOT', `Slot ${position.slot} is invalid for ${position.container}.`);
  return { container, slot };
}
function getItem(state, position) { const { container, slot } = validatePosition(state, position); return container[slot]; }
function setItem(state, position, item) { const { container, slot } = validatePosition(state, position); container[slot] = item; }

function *iterateItems(state, types = Object.values(CONTAINER_TYPES)) {
  for (const type of types) {
    const container = getContainer(state, type);
    for (let slot = 0; slot < container.length; slot++) if (container[slot]) yield { container: type, slot, item: container[slot] };
  }
}
function listSerials(state) { return [...iterateItems(state)].map(x => x.item.serial); }
function assertNoLocalDuplicateSerials(state) {
  const seen = new Map();
  for (const entry of iterateItems(state)) {
    if (seen.has(entry.item.serial)) fail('DUPLICATE_SERIAL', `Duplicate serial inside owner state: ${entry.item.serial}`, { serial: entry.item.serial, first: seen.get(entry.item.serial), second: { container: entry.container, slot: entry.slot } });
    seen.set(entry.item.serial, { container: entry.container, slot: entry.slot });
  }
}
function findBySerial(state, serial) { return [...iterateItems(state)].find(x => x.item.serial === String(serial)) ?? null; }

module.exports = { emptyState, cloneState, getContainer, validatePosition, getItem, setItem, iterateItems, listSerials, assertNoLocalDuplicateSerials, findBySerial };
