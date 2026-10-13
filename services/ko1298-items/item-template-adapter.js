'use strict';

const { LEGACY_STACK_LIMIT } = require('./constants');
const { fail } = require('./errors');

class ItemTemplateRegistry {
  constructor(adapter) {
    if (!adapter || typeof adapter.get !== 'function') {
      fail('INVALID_TEMPLATE_ADAPTER', 'Template adapter must expose get(itemId).');
    }
    this.adapter = adapter;
  }

  async get(itemId) {
    const raw = await this.adapter.get(itemId);
    if (!raw) fail('ITEM_TEMPLATE_NOT_FOUND', `Unknown item template: ${itemId}`);

    const template = {
      id: Number(raw.id ?? raw.Num ?? itemId),
      name: String(raw.name ?? raw.strName ?? `item-${itemId}`),
      stackable: Boolean(raw.stackable ?? raw.countable ?? raw.Countable),
      maxStack: Number(raw.maxStack ?? LEGACY_STACK_LIMIT),
      maxDurability: raw.maxDurability ?? raw.Duration ?? raw.duration ?? null,
      allowedEquipmentSlots: normalizeSlots(raw.allowedEquipmentSlots),
      raw,
    };

    if (!Number.isInteger(template.id) || template.id <= 0) {
      fail('INVALID_ITEM_TEMPLATE', 'Template id must be a positive integer.', { itemId });
    }
    if (!Number.isInteger(template.maxStack) || template.maxStack < 1) {
      fail('INVALID_ITEM_TEMPLATE', 'maxStack must be a positive integer.', { itemId });
    }
    if (!template.stackable) template.maxStack = 1;
    return template;
  }
}

class Legacy1298TableAdapter {
  constructor({ getRow, slotResolver = () => [] }) {
    if (typeof getRow !== 'function') fail('INVALID_TABLE_ADAPTER', 'getRow must be a function.');
    if (typeof slotResolver !== 'function') fail('INVALID_TABLE_ADAPTER', 'slotResolver must be a function.');
    this.getRow = getRow;
    this.slotResolver = slotResolver;
  }

  async get(itemId) {
    const row = await this.getRow(itemId);
    if (!row) return null;
    return {
      id: row.Num ?? row.id ?? itemId,
      name: row.strName ?? row.name,
      countable: row.Countable ?? row.countable ?? false,
      maxStack: row.maxStack ?? LEGACY_STACK_LIMIT,
      maxDurability: row.Duration ?? row.duration ?? null,
      allowedEquipmentSlots: this.slotResolver(row),
      sourceRow: row,
    };
  }
}

function normalizeSlots(slots) {
  if (slots == null) return [];
  if (!Array.isArray(slots)) fail('INVALID_ITEM_TEMPLATE', 'allowedEquipmentSlots must be an array.');
  const normalized = [...new Set(slots.map(Number))];
  for (const slot of normalized) {
    if (!Number.isInteger(slot) || slot < 0 || slot > 13) {
      fail('INVALID_ITEM_TEMPLATE', 'Equipment slot must be between 0 and 13.', { slot });
    }
  }
  return normalized;
}

module.exports = { ItemTemplateRegistry, Legacy1298TableAdapter };
