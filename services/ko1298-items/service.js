'use strict';

const { CONTAINER_TYPES } = require('./constants');
const { createItemInstance, withQuantity } = require('./item-instance');
const { getItem, setItem, validatePosition } = require('./inventory-state');
const { fail } = require('./errors');

class ItemDomainService {
  constructor({ repository, templates }) {
    if (!repository || typeof repository.transact !== 'function') fail('INVALID_REPOSITORY', 'Repository must expose transact(ownerId, work).');
    if (!templates || typeof templates.get !== 'function') fail('INVALID_TEMPLATE_REGISTRY', 'Template registry must expose get(itemId).');
    this.repository = repository;
    this.templates = templates;
  }

  async createItem(ownerId, destination, itemInput) {
    const template = await this.templates.get(itemInput.templateId);
    const item = createItemInstance(template, itemInput);
    return this.repository.transact(ownerId, async state => {
      this._assertDestinationCompatible(state, destination, template);
      if (getItem(state, destination)) fail('SLOT_OCCUPIED', 'Destination slot is occupied.');
      setItem(state, destination, item);
      return item;
    });
  }

  async move(ownerId, from, to, options = {}) {
    if (samePosition(from, to)) return this.repository.read(ownerId);
    return this.repository.transact(ownerId, async state => {
      validatePosition(state, from);
      validatePosition(state, to);
      const source = getItem(state, from);
      if (!source) fail('SOURCE_EMPTY', 'Source slot is empty.');

      const sourceTemplate = await this.templates.get(source.templateId);
      this._assertDestinationCompatible(state, to, sourceTemplate);
      const target = getItem(state, to);
      const requested = options.quantity == null ? source.quantity : Number(options.quantity);
      if (!Number.isInteger(requested) || requested < 1 || requested > source.quantity) {
        fail('INVALID_QUANTITY', 'Move quantity must be within the source stack.');
      }

      if (!sourceTemplate.stackable && requested !== 1) {
        fail('NON_STACKABLE_QUANTITY', 'Non-stackable items cannot be partially moved.');
      }

      if (target && target.templateId === source.templateId && sourceTemplate.stackable) {
        const capacity = sourceTemplate.maxStack - target.quantity;
        if (capacity <= 0) fail('STACK_FULL', 'Target stack is full.');
        const moved = Math.min(requested, capacity);
        setItem(state, to, withQuantity(target, target.quantity + moved));
        const left = source.quantity - moved;
        setItem(state, from, left > 0 ? withQuantity(source, left) : null);
        return { movedQuantity: moved, merged: true };
      }

      if (target) {
        if (requested !== source.quantity) fail('PARTIAL_SWAP_NOT_ALLOWED', 'Partial stacks cannot swap with an occupied slot.');
        const targetTemplate = await this.templates.get(target.templateId);
        this._assertDestinationCompatible(state, from, targetTemplate);
        setItem(state, from, target);
        setItem(state, to, source);
        return { movedQuantity: source.quantity, swapped: true };
      }

      if (requested === source.quantity) {
        setItem(state, from, null);
        setItem(state, to, source);
        return { movedQuantity: requested, moved: true };
      }

      if (!sourceTemplate.stackable) fail('PARTIAL_MOVE_NOT_ALLOWED', 'Only stackable items can be split.');
      if (options.splitSerial == null) {
        fail('SPLIT_SERIAL_REQUIRED', 'Moving part of a stack into an empty slot requires a new unique splitSerial.');
      }
      const splitItem = createItemInstance(sourceTemplate, {
        serial: options.splitSerial,
        quantity: requested,
        durability: source.durability,
      });
      setItem(state, from, withQuantity(source, source.quantity - requested));
      setItem(state, to, splitItem);
      return { movedQuantity: requested, split: true, serial: splitItem.serial };
    });
  }

  async equip(ownerId, inventorySlot, equipmentSlot) {
    return this.move(
      ownerId,
      { container: CONTAINER_TYPES.INVENTORY, slot: inventorySlot },
      { container: CONTAINER_TYPES.EQUIPMENT, slot: equipmentSlot },
    );
  }

  async unequip(ownerId, equipmentSlot, inventorySlot) {
    return this.move(
      ownerId,
      { container: CONTAINER_TYPES.EQUIPMENT, slot: equipmentSlot },
      { container: CONTAINER_TYPES.INVENTORY, slot: inventorySlot },
    );
  }

  async moveToInn(ownerId, from, innSlot, options = {}) {
    return this.move(ownerId, from, { container: CONTAINER_TYPES.INN, slot: innSlot }, options);
  }

  async moveFromInn(ownerId, innSlot, to, options = {}) {
    return this.move(ownerId, { container: CONTAINER_TYPES.INN, slot: innSlot }, to, options);
  }

  _assertDestinationCompatible(state, destination, template) {
    validatePosition(state, destination);
    if (destination.container !== CONTAINER_TYPES.EQUIPMENT) return;
    if (!template.allowedEquipmentSlots.includes(Number(destination.slot))) {
      fail('ITEM_NOT_EQUIPPABLE_HERE', `Item ${template.id} cannot be equipped in slot ${destination.slot}.`, {
        itemId: template.id,
        slot: destination.slot,
      });
    }
  }
}

function samePosition(a, b) {
  return a && b && a.container === b.container && Number(a.slot) === Number(b.slot);
}

module.exports = { ItemDomainService };
