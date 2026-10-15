'use strict';

const {
  INN_PAGE_COUNT,
  INN_SLOTS_PER_PAGE,
  INN_SLOT_COUNT,
  INVENTORY_SLOT_COUNT,
  LEGACY_STACK_LIMIT,
} = require('./constants');
const { assertPositiveId, assertInventorySlot, assertInnPosition } = require('./model');
const { fail } = require('./errors');

class InnStorageService {
  constructor({ repository, items }) {
    if (!repository || typeof repository.transact !== 'function' || typeof repository.readInn !== 'function') {
      fail('INVALID_REPOSITORY', 'Repository must expose transact({accountId, characterId, signal}, work) and readInn(accountId).');
    }
    if (!items || typeof items.getTemplate !== 'function' || typeof items.withQuantity !== 'function' || typeof items.createSplit !== 'function') {
      fail('INVALID_ITEM_PORT', 'Item port must expose getTemplate, withQuantity and createSplit.');
    }
    this.repository = repository;
    this.items = items;
  }

  async open(accountId) {
    const id = assertPositiveId(accountId, 'accountId');
    const state = await this.repository.readInn(id);
    return {
      accountId: id,
      patch: 1298,
      pageCount: INN_PAGE_COUNT,
      slotsPerPage: INN_SLOTS_PER_PAGE,
      totalSlots: INN_SLOT_COUNT,
      pages: Array.from({ length: INN_PAGE_COUNT }, (_, page) => ({
        page,
        slots: state.inn
          .slice(page * INN_SLOTS_PER_PAGE, (page + 1) * INN_SLOTS_PER_PAGE)
          .map(item => item == null ? null : { ...item }),
      })),
      version: state.version,
    };
  }

  async getPage(accountId, page) {
    const snapshot = await this.open(accountId);
    const p = Number(page);
    if (!Number.isInteger(p) || p < 0 || p >= INN_PAGE_COUNT) fail('INVALID_INN_PAGE', `Inn page must be in 0..${INN_PAGE_COUNT - 1}.`, { page });
    return snapshot.pages[p];
  }

  async deposit({ accountId, characterId, inventorySlot, innPage, innSlot, quantity = null, splitSerial = null, signal = null }) {
    return this._transfer({
      accountId,
      characterId,
      source: { kind: 'inventory', slot: inventorySlot },
      destination: { kind: 'inn', page: innPage, slot: innSlot },
      quantity,
      splitSerial,
      signal,
    });
  }

  async withdraw({ accountId, characterId, innPage, innSlot, inventorySlot, quantity = null, splitSerial = null, signal = null }) {
    return this._transfer({
      accountId,
      characterId,
      source: { kind: 'inn', page: innPage, slot: innSlot },
      destination: { kind: 'inventory', slot: inventorySlot },
      quantity,
      splitSerial,
      signal,
    });
  }

  async _transfer({ accountId, characterId, source, destination, quantity, splitSerial, signal }) {
    const aid = assertPositiveId(accountId, 'accountId');
    const cid = assertPositiveId(characterId, 'characterId');
    const sourcePos = normalizePosition(source);
    const destinationPos = normalizePosition(destination);

    return this.repository.transact({ accountId: aid, characterId: cid, signal }, async state => {
      const character = state.characters[String(cid)];
      if (!character) fail('ITEM_OWNERSHIP_MISMATCH', 'Character does not belong to account.', { accountId: aid, characterId: cid });

      const sourceContainer = sourcePos.kind === 'inventory' ? character.inventory : state.inn;
      const destinationContainer = destinationPos.kind === 'inventory' ? character.inventory : state.inn;
      const sourceIndex = sourcePos.kind === 'inventory' ? sourcePos.slot : sourcePos.flatSlot;
      const destinationIndex = destinationPos.kind === 'inventory' ? destinationPos.slot : destinationPos.flatSlot;

      const sourceItem = sourceContainer[sourceIndex];
      if (!sourceItem) fail('SOURCE_EMPTY', 'Source slot is empty.', { source: sourcePos });

      const template = await this.items.getTemplate(sourceItem.templateId);
      const stackable = Boolean(template.stackable);
      const maxStack = normalizeMaxStack(template.maxStack, stackable);
      const requested = quantity == null ? Number(sourceItem.quantity) : Number(quantity);

      if (!Number.isInteger(requested) || requested < 1 || requested > Number(sourceItem.quantity)) {
        fail('INVALID_QUANTITY', 'Transfer quantity must be an integer within the source stack.', {
          requested,
          sourceQuantity: sourceItem.quantity,
        });
      }
      if (!stackable && (requested !== 1 || Number(sourceItem.quantity) !== 1)) {
        fail('NON_STACKABLE_QUANTITY', 'Non-stackable item instances must transfer as quantity 1.');
      }

      const targetItem = destinationContainer[destinationIndex];
      if (targetItem) {
        if (!stackable || Number(targetItem.templateId) !== Number(sourceItem.templateId)) {
          fail('DESTINATION_OCCUPIED', 'Destination slot contains a different or non-stackable item.', { destination: destinationPos });
        }
        const targetTemplate = await this.items.getTemplate(targetItem.templateId);
        if (!targetTemplate.stackable) fail('DESTINATION_OCCUPIED', 'Destination item is not stackable.', { destination: destinationPos });
        const targetMax = normalizeMaxStack(targetTemplate.maxStack, true);
        if (Number(targetItem.quantity) + requested > targetMax) {
          fail('STACK_CAPACITY_EXCEEDED', 'Destination stack cannot accept the requested quantity.', {
            requested,
            targetQuantity: targetItem.quantity,
            maxStack: targetMax,
          });
        }

        destinationContainer[destinationIndex] = this.items.withQuantity(targetItem, Number(targetItem.quantity) + requested);
        const remaining = Number(sourceItem.quantity) - requested;
        sourceContainer[sourceIndex] = remaining === 0 ? null : this.items.withQuantity(sourceItem, remaining);
        return {
          accountId: aid,
          characterId: cid,
          movedQuantity: requested,
          merged: true,
          sourceSerial: Number(sourceItem.serial),
          targetSerial: Number(targetItem.serial),
        };
      }

      if (requested === Number(sourceItem.quantity)) {
        sourceContainer[sourceIndex] = null;
        destinationContainer[destinationIndex] = sourceItem;
        return {
          accountId: aid,
          characterId: cid,
          movedQuantity: requested,
          moved: true,
          serial: Number(sourceItem.serial),
        };
      }

      if (!stackable) fail('PARTIAL_MOVE_NOT_ALLOWED', 'Only stackable items can be split.');
      const serial = Number(splitSerial);
      if (!Number.isInteger(serial) || serial <= 0) {
        fail('SPLIT_SERIAL_REQUIRED', 'A positive unique splitSerial is required when splitting into an empty slot.');
      }
      const splitItem = this.items.createSplit(template, sourceItem, requested, serial);
      if (Number(splitItem.serial) !== serial || Number(splitItem.quantity) !== requested || Number(splitItem.templateId) !== Number(sourceItem.templateId)) {
        fail('INVALID_SPLIT_ITEM', 'Item port returned an invalid split item.', { splitItem });
      }
      sourceContainer[sourceIndex] = this.items.withQuantity(sourceItem, Number(sourceItem.quantity) - requested);
      destinationContainer[destinationIndex] = splitItem;
      return {
        accountId: aid,
        characterId: cid,
        movedQuantity: requested,
        split: true,
        serial,
        sourceSerial: Number(sourceItem.serial),
      };
    });
  }
}

function normalizePosition(position) {
  if (!position || (position.kind !== 'inventory' && position.kind !== 'inn')) fail('INVALID_POSITION', 'Position must be inventory or inn.');
  if (position.kind === 'inventory') return { kind: 'inventory', slot: assertInventorySlot(position.slot) };
  const inn = assertInnPosition(position.page, position.slot);
  return { kind: 'inn', ...inn };
}

function normalizeMaxStack(value, stackable) {
  if (!stackable) return 1;
  const max = value == null ? LEGACY_STACK_LIMIT : Number(value);
  if (!Number.isInteger(max) || max < 1) fail('INVALID_ITEM_TEMPLATE', 'Stackable item template must define a positive maxStack.');
  return max;
}

module.exports = {
  InnStorageService,
  normalizePosition,
  constants: {
    INN_PAGE_COUNT,
    INN_SLOTS_PER_PAGE,
    INN_SLOT_COUNT,
    INVENTORY_SLOT_COUNT,
  },
};
