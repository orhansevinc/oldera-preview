import { fail } from './errors.js';

export const KO1298_CHANCE_SCALE = 10_000;
export const KO1298_GROUP_SIZE = 30;

const ARROW_MIN = 391010000;
const ARROW_MAX = 392010000;

function requirePositiveInteger(value, field) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail('INVALID_1298_DROP_DATA', `${field} must be a positive safe integer.`, { field, value });
  }
  return value;
}

function requireChance(value, field) {
  if (!Number.isSafeInteger(value) || value < 0 || value > KO1298_CHANCE_SCALE) {
    fail('INVALID_1298_DROP_DATA', `${field} must be an integer from 0 to 10000.`, {
      field,
      value
    });
  }
  return value;
}

function rejectDuplicate(seen, key, code, details) {
  if (seen.has(key)) {
    fail(code, 'Duplicate verified 1298 drop data key.', details);
  }
  seen.add(key);
}

export class Verified1298DropTableAdapter {
  #monsterMappings = new Map();
  #dropTables = new Map();
  #itemGroups = new Map();
  #productionResolver;

  constructor({
    monsterMappings = [],
    dropTables = [],
    itemGroups = [],
    productionResolver = null,
    provenance
  } = {}) {
    if (
      provenance?.classification !== 'verified-1298' ||
      !Array.isArray(provenance.sourceRefs) ||
      provenance.sourceRefs.length === 0
    ) {
      fail(
        'INVALID_DROP_PROVENANCE',
        'Verified 1298 adapter requires verified-1298 provenance and sourceRefs.'
      );
    }

    this.provenance = Object.freeze({
      ...provenance,
      sourceRefs: Object.freeze([...provenance.sourceRefs])
    });
    this.#productionResolver = productionResolver;

    const monsterSeen = new Set();
    for (const row of monsterMappings) {
      requirePositiveInteger(row.monsterTemplateId, 'monsterTemplateId');
      requirePositiveInteger(row.dropTableKey, 'dropTableKey');
      const moneyBase = row.moneyBase ?? 0;
      if (!Number.isSafeInteger(moneyBase) || moneyBase < 0) {
        fail('INVALID_1298_DROP_DATA', 'moneyBase must be a non-negative safe integer.', { row });
      }
      rejectDuplicate(
        monsterSeen,
        row.monsterTemplateId,
        'DUPLICATE_MONSTER_DROP_MAPPING',
        { monsterTemplateId: row.monsterTemplateId }
      );
      this.#monsterMappings.set(row.monsterTemplateId, Object.freeze({
        dropTableKey: row.dropTableKey,
        moneyBase
      }));
    }

    const tableSeen = new Set();
    for (const row of dropTables) {
      requirePositiveInteger(row.dropTableKey, 'dropTableKey');
      rejectDuplicate(tableSeen, row.dropTableKey, 'DUPLICATE_DROP_TABLE', {
        dropTableKey: row.dropTableKey
      });
      if (!Array.isArray(row.slots) || row.slots.length !== 5) {
        fail('INVALID_1298_DROP_DATA', 'K_MONSTER_ITEM requires exactly 5 slots.', {
          dropTableKey: row.dropTableKey
        });
      }

      const slots = row.slots.map((slot, index) => {
        const itemCode = slot?.itemCode ?? 0;
        if (!Number.isSafeInteger(itemCode) || itemCode < 0) {
          fail('INVALID_1298_DROP_DATA', 'itemCode must be a non-negative safe integer.', {
            dropTableKey: row.dropTableKey,
            index,
            itemCode
          });
        }
        return Object.freeze({
          itemCode,
          chance: requireChance(slot?.chance ?? 0, `slots[${index}].chance`)
        });
      });

      this.#dropTables.set(row.dropTableKey, Object.freeze({
        dropTableKey: row.dropTableKey,
        slots: Object.freeze(slots)
      }));
    }

    const groupSeen = new Set();
    for (const row of itemGroups) {
      requirePositiveInteger(row.groupId, 'groupId');
      rejectDuplicate(groupSeen, row.groupId, 'DUPLICATE_ITEM_GROUP', { groupId: row.groupId });
      if (!Array.isArray(row.itemIds) || row.itemIds.length !== KO1298_GROUP_SIZE) {
        fail('INVALID_1298_DROP_DATA', 'MAKE_ITEM_GROUP requires exactly 30 item ids.', {
          groupId: row.groupId
        });
      }
      const itemIds = row.itemIds.map((itemId, index) => {
        if (!Number.isSafeInteger(itemId) || itemId < 0) {
          fail('INVALID_1298_DROP_DATA', 'Group item id must be a non-negative safe integer.', {
            groupId: row.groupId,
            index,
            itemId
          });
        }
        return itemId;
      });
      this.#itemGroups.set(row.groupId, Object.freeze(itemIds));
    }

    for (const mapping of this.#monsterMappings.values()) {
      if (!this.#dropTables.has(mapping.dropTableKey)) {
        fail('MISSING_1298_DROP_TABLE', 'Monster mapping references a missing K_MONSTER_ITEM row.', {
          dropTableKey: mapping.dropTableKey
        });
      }
    }

    for (const table of this.#dropTables.values()) {
      const first = table.slots[0];
      const second = table.slots[1];
      if (first.itemCode >= 100 && !this.#itemGroups.has(first.itemCode)) {
        fail('MISSING_1298_ITEM_GROUP', 'First K_MONSTER_ITEM slot references a missing MAKE_ITEM_GROUP.', {
          dropTableKey: table.dropTableKey,
          groupId: first.itemCode
        });
      }
      if (second.itemCode > 0 && !this.#itemGroups.has(second.itemCode)) {
        fail('MISSING_1298_ITEM_GROUP', 'Second K_MONSTER_ITEM slot references a missing MAKE_ITEM_GROUP.', {
          dropTableKey: table.dropTableKey,
          groupId: second.itemCode
        });
      }
    }
  }

  async findForMob(monsterTemplateId) {
    const mapping = this.#monsterMappings.get(monsterTemplateId);
    if (!mapping) return null;
    const row = this.#dropTables.get(mapping.dropTableKey);
    return Object.freeze({
      model: 'ko1298-verified',
      id: `K_MONSTER_ITEM:${mapping.dropTableKey}`,
      dropTableKey: mapping.dropTableKey,
      moneyBase: mapping.moneyBase,
      slots: row.slots,
      groups: this.#itemGroups,
      productionResolver: this.#productionResolver,
      provenance: this.provenance
    });
  }
}

export async function rollVerified1298DropTable(table, rng) {
  if (!table || table.model !== 'ko1298-verified') {
    fail('INVALID_1298_DROP_TABLE', 'Expected ko1298-verified table.');
  }
  if (!rng || typeof rng.nextIntInclusive !== 'function') {
    fail('INVALID_RNG', 'A RNG implementing nextIntInclusive(min, max) is required.');
  }

  const rewards = [];

  if (table.moneyBase > 0) {
    const percent = rng.nextIntInclusive(70, 100);
    let quantity = Math.floor((table.moneyBase * percent) / 100);
    if (quantity > 32767) quantity = 32000;
    if (quantity > 0) rewards.push(Object.freeze({ kind: 'coin', quantity }));
  }

  for (let index = 0; index < table.slots.length; index += 1) {
    const slot = table.slots[index];
    if (slot.itemCode === 0 || slot.chance === 0) continue;
    if (rng.nextIntInclusive(1, KO1298_CHANCE_SCALE) > slot.chance) continue;

    let itemId;
    let quantity = 1;

    if (index === 0 && slot.itemCode < 100) {
      if (typeof table.productionResolver !== 'function') {
        fail(
          'VERIFIED_PRODUCTION_RESOLVER_REQUIRED',
          '1298 ItemProdution slot requires a verified resolver.',
          { dropTableKey: table.dropTableKey, itemCode: slot.itemCode }
        );
      }
      const resolved = await table.productionResolver({
        itemCode: slot.itemCode,
        rng,
        table,
        slotIndex: index
      });
      if (!resolved) continue;
      itemId = resolved.itemId;
      quantity = resolved.quantity ?? 1;
    } else if (index <= 1) {
      const group = table.groups.get(slot.itemCode);
      if (!group) {
        fail('MISSING_1298_ITEM_GROUP', 'Drop slot references missing MAKE_ITEM_GROUP.', {
          dropTableKey: table.dropTableKey,
          slotIndex: index,
          groupId: slot.itemCode
        });
      }
      const randomSlot = rng.nextIntInclusive(0, 10000) % KO1298_GROUP_SIZE;
      itemId = group[randomSlot];
      if (itemId === 0) continue;
    } else {
      itemId = slot.itemCode;
      quantity = itemId >= ARROW_MIN && itemId < ARROW_MAX ? 20 : 1;
    }

    if (
      !Number.isSafeInteger(itemId) || itemId <= 0 ||
      !Number.isSafeInteger(quantity) || quantity <= 0
    ) {
      fail('INVALID_1298_DROP_RESULT', 'Verified resolver produced invalid item reward.', {
        itemId,
        quantity
      });
    }

    rewards.push(Object.freeze({ kind: 'item', itemId, quantity }));
  }

  return Object.freeze(rewards);
}
