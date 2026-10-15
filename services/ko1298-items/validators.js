'use strict';

const { CONTAINER_TYPES } = require('./constants');
const { iterateItems } = require('./inventory-state');

async function validateInventoryState(state, templates) {
  const issues = [];
  const serials = new Map();
  if (!state || typeof state !== 'object') return [{ code: 'INVALID_STATE' }];
  for (const type of Object.values(CONTAINER_TYPES)) {
    if (!Array.isArray(state[type])) { issues.push({ code: 'INVALID_CONTAINER_SHAPE', container: type }); continue; }
  }
  for (const entry of iterateItems(state)) {
    const item = entry.item;
    if (!item || typeof item !== 'object') { issues.push({ code: 'INVALID_ITEM_SHAPE', ...entry }); continue; }
    if (!/^\d+$/.test(String(item.serial))) issues.push({ code: 'INVALID_SERIAL', serial: item.serial, container: entry.container, slot: entry.slot });
    if (serials.has(item.serial)) issues.push({ code: 'DUPLICATE_SERIAL', serial: item.serial, locations: [serials.get(item.serial), { container: entry.container, slot: entry.slot }] });
    else serials.set(item.serial, { container: entry.container, slot: entry.slot });
    let template;
    try { template = await templates.get(item.templateId); } catch (error) { issues.push({ code: 'ORPHANED_ITEM_TEMPLATE', serial: item.serial, templateId: item.templateId }); continue; }
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > template.maxStack) issues.push({ code: 'INVALID_QUANTITY', serial: item.serial, quantity: item.quantity });
    if (!template.stackable && item.quantity !== 1) issues.push({ code: 'NON_STACKABLE_QUANTITY', serial: item.serial, quantity: item.quantity });
    if (item.durability != null && (item.durability < 0 || (template.maxDurability != null && item.durability > template.maxDurability))) issues.push({ code: 'INVALID_DURABILITY', serial: item.serial, durability: item.durability });
    if (entry.container === CONTAINER_TYPES.EQUIPMENT && !template.allowedEquipmentSlots.includes(entry.slot)) issues.push({ code: 'INVALID_EQUIP_PLACEMENT', serial: item.serial, slot: entry.slot });
  }
  return issues;
}

async function findOrphanedItems(state, templates) {
  const issues = await validateInventoryState(state, templates);
  return issues.filter(x => x.code === 'ORPHANED_ITEM_TEMPLATE');
}

module.exports = { validateInventoryState, findOrphanedItems };
