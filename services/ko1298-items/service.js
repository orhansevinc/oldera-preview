'use strict';

const { CONTAINER_TYPES, EQUIPMENT_SLOTS, HAND_POLICY } = require('./constants');
const { createItemInstance, withQuantity, withDurability } = require('./item-instance');
const { getItem, setItem, validatePosition, findBySerial, cloneState } = require('./inventory-state');
const { calculateCarriedWeight, buildEquipmentSnapshot, buildCombatItemSnapshot } = require('./projections');
const { validateInventoryState, findOrphanedItems } = require('./validators');
const { fail } = require('./errors');

class ItemDomainService {
  constructor({ repository, templates, characterContext = null, serialGenerator = null }) {
    if (!repository || typeof repository.transact !== 'function') fail('INVALID_REPOSITORY', 'Repository must expose transact(ownerId, work).');
    if (!templates || typeof templates.get !== 'function') fail('INVALID_TEMPLATE_REGISTRY', 'Template registry must expose get(itemId).');
    this.repository = repository; this.templates = templates; this.characterContext = characterContext; this.serialGenerator = serialGenerator;
  }

  async createItem(ownerId, destination, itemInput, options = {}) {
    const template = await this.templates.get(itemInput.templateId);
    const serial = itemInput.serial ?? await this._nextSerial({ ownerId, templateId: template.id, reason: options.reason ?? 'create-item' });
    const item = createItemInstance(template, { ...itemInput, serial });
    return this.repository.transact(ownerId, async state => {
      await this._assertDestinationCompatible(ownerId, state, destination, template);
      if (getItem(state, destination)) fail('SLOT_OCCUPIED', 'Destination slot is occupied.');
      await this._assertWeightAfterInsert(ownerId, state, template, item.quantity, destination);
      setItem(state, destination, item);
      return item;
    }, { ...options, event: options.event ?? { type: 'ITEM_CREATED', templateId: template.id, serial: item.serial, destination } });
  }

  async move(ownerId, from, to, options = {}) {
    if (samePosition(from, to)) return this.repository.read(ownerId);
    return this.repository.transact(ownerId, async state => this._moveInDraft(ownerId, state, from, to, options), { ...options, event: options.event ?? { type: 'ITEM_MOVED', from, to } });
  }

  async _moveInDraft(ownerId, state, from, to, options = {}) {
    validatePosition(state, from); validatePosition(state, to);
    const source = getItem(state, from); if (!source) fail('SOURCE_EMPTY', 'Source slot is empty.');
    const sourceTemplate = await this.templates.get(source.templateId);
    await this._assertDestinationCompatible(ownerId, state, to, sourceTemplate, { movingFrom: from });
    const target = getItem(state, to);
    const carriedWeightBefore = await calculateCarriedWeight(state, this.templates);
    const requested = options.quantity == null ? source.quantity : Number(options.quantity);
    if (!Number.isInteger(requested) || requested < 1 || requested > source.quantity) fail('INVALID_QUANTITY', 'Move quantity must be within the source stack.');
    if (!sourceTemplate.stackable && requested !== 1) fail('NON_STACKABLE_QUANTITY', 'Non-stackable items cannot be partially moved.');

    if (target && target.templateId === source.templateId && sourceTemplate.stackable) {
      const capacity = sourceTemplate.maxStack - target.quantity;
      if (capacity <= 0) fail('STACK_FULL', 'Target stack is full.');
      const moved = Math.min(requested, capacity);
      setItem(state, to, withQuantity(target, target.quantity + moved));
      const left = source.quantity - moved; setItem(state, from, left > 0 ? withQuantity(source, left) : null);
      await this._assertMoveWeight(ownerId, state, carriedWeightBefore);
      return { movedQuantity: moved, merged: true, sourceRemainder: left };
    }
    if (target) {
      if (requested !== source.quantity) fail('PARTIAL_SWAP_NOT_ALLOWED', 'Partial stacks cannot swap with an occupied slot.');
      const targetTemplate = await this.templates.get(target.templateId);
      await this._assertDestinationCompatible(ownerId, state, from, targetTemplate, { movingFrom: to });
      setItem(state, from, target); setItem(state, to, source); await this._assertMoveWeight(ownerId, state, carriedWeightBefore); return { movedQuantity: source.quantity, swapped: true };
    }
    if (requested === source.quantity) { setItem(state, from, null); setItem(state, to, source); await this._assertMoveWeight(ownerId, state, carriedWeightBefore); return { movedQuantity: requested, moved: true }; }
    if (!sourceTemplate.stackable) fail('PARTIAL_MOVE_NOT_ALLOWED', 'Only stackable items can be split.');
    let splitSerial = options.splitSerial;
    if (splitSerial == null) {
      if (!this.serialGenerator) fail('SPLIT_SERIAL_REQUIRED', 'Moving part of a stack into an empty slot requires splitSerial or a configured serial generator.');
      splitSerial = await this._nextSerial({ ownerId, templateId: sourceTemplate.id, reason: 'stack-split' });
    }
    const splitItem = createItemInstance(sourceTemplate, { serial: splitSerial, quantity: requested, durability: source.durability });
    setItem(state, from, withQuantity(source, source.quantity - requested)); setItem(state, to, splitItem);
    await this._assertMoveWeight(ownerId, state, carriedWeightBefore);
    return { movedQuantity: requested, split: true, serial: splitItem.serial };
  }

  async equip(ownerId, inventorySlot, equipmentSlot, options = {}) { return this.move(ownerId, { container: CONTAINER_TYPES.INVENTORY, slot: inventorySlot }, { container: CONTAINER_TYPES.EQUIPMENT, slot: equipmentSlot }, { ...options, event: { type: 'ITEM_EQUIPPED', inventorySlot, equipmentSlot } }); }
  async unequip(ownerId, equipmentSlot, inventorySlot, options = {}) { return this.move(ownerId, { container: CONTAINER_TYPES.EQUIPMENT, slot: equipmentSlot }, { container: CONTAINER_TYPES.INVENTORY, slot: inventorySlot }, { ...options, event: { type: 'ITEM_UNEQUIPPED', equipmentSlot, inventorySlot } }); }
  async moveToInn(ownerId, from, innSlot, options = {}) { return this.move(ownerId, from, { container: CONTAINER_TYPES.INN, slot: innSlot }, { ...options, event: { type: 'INN_TRANSFER_OUT', from, innSlot } }); }
  async moveFromInn(ownerId, innSlot, to, options = {}) { return this.move(ownerId, { container: CONTAINER_TYPES.INN, slot: innSlot }, to, { ...options, event: { type: 'INN_TRANSFER_IN', innSlot, to } }); }

  async applyDurability(ownerId, position, delta, options = {}) {
    return this.repository.transact(ownerId, async state => { const item = getItem(state, position); if (!item) fail('SOURCE_EMPTY', 'Durability target is empty.'); const template = await this.templates.get(item.templateId); if (template.maxDurability == null) fail('ITEM_HAS_NO_DURABILITY', 'Item has no durability.'); const next = Math.max(0, Math.min(template.maxDurability, item.durability + Number(delta))); const updated = withDurability(item, next, template.maxDurability); setItem(state, position, updated); return updated; }, { ...options, event: { type: 'ITEM_DURABILITY_CHANGED', position, delta } });
  }

  async getEquipmentModifierSnapshot(ownerId) { return buildEquipmentSnapshot(await this.repository.read(ownerId), this.templates); }
  async getCombatItemSnapshot(ownerId) { return buildCombatItemSnapshot(await this.repository.read(ownerId), this.templates); }
  async getCarriedWeight(ownerId) { return calculateCarriedWeight(await this.repository.read(ownerId), this.templates); }
  async getOwnedItem(ownerId, itemSerial, { tx = null } = {}) { const state = tx ?? await this.repository.read(ownerId); const found = findBySerial(state, itemSerial); return found ? { ...found, item: { ...found.item } } : null; }
  async countSerial(itemSerial) { if (typeof this.repository.countSerial !== 'function') fail('SERIAL_COUNT_PORT_REQUIRED', 'Repository must expose authoritative countSerial(serial).'); return this.repository.countSerial(itemSerial); }
  async generateSerial(context) { return this._nextSerial(context); }

  async canReceiveBatch(ownerId, { incoming = [], outgoing = [], tx = null } = {}) {
    const state = cloneState(tx ?? await this.repository.read(ownerId));
    try {
      for (const out of outgoing) {
        const found = findBySerial(state, out.itemSerial ?? out.serial); if (!found) fail('ITEM_NOT_OWNED', 'Outgoing trade item is not owned.');
        if (found.container === CONTAINER_TYPES.EQUIPMENT) fail('EQUIPPED_ITEM_MUTATION_REQUIRES_UNEQUIP', 'Equipped items cannot be traded directly.');
        const quantity = Number(out.quantity ?? found.item.quantity); if (!Number.isInteger(quantity) || quantity < 1 || quantity > found.item.quantity) fail('INVALID_QUANTITY', 'Outgoing quantity is invalid.');
        setItem(state, found, quantity === found.item.quantity ? null : withQuantity(found.item, found.item.quantity - quantity));
      }
      let mockSerial = 9900000000000000000n;
      for (const incomingItem of incoming) {
        const template = await this.templates.get(incomingItem.templateId ?? incomingItem.itemTemplateId);
        const quantity = Number(incomingItem.quantity ?? 1); if (!Number.isInteger(quantity) || quantity < 1) fail('INVALID_QUANTITY', 'Incoming quantity is invalid.');
        await this._assertWeightAfterInsert(ownerId, state, template, quantity, { container: CONTAINER_TYPES.INVENTORY, slot: 0 }, { ignoreSlot: true });
        if (!this._hasInsertionCapacity(state, template, quantity)) fail('INVENTORY_FULL', 'Incoming trade items do not fit inventory.');
        let remaining = quantity;
        if (template.stackable) for (let i = 0; i < state.inventory.length && remaining > 0; i++) { const item = state.inventory[i]; if (!item || item.templateId !== template.id || item.quantity >= template.maxStack) continue; const moved = Math.min(remaining, template.maxStack - item.quantity); state.inventory[i] = withQuantity(item, item.quantity + moved); remaining -= moved; }
        while (remaining > 0) { const slot = state.inventory.findIndex(x => x == null); if (slot < 0) fail('INVENTORY_FULL', 'Incoming trade items do not fit inventory.'); const amount = Math.min(remaining, template.maxStack); state.inventory[slot] = Object.freeze({ templateId: template.id, serial: String(mockSerial++), quantity: amount, durability: template.maxDurability, broken: false }); remaining -= amount; }
      }
      return { ok: true };
    } catch (error) {
      if (error instanceof require('./errors').ItemDomainError) return { ok: false, reason: error.code, details: error.details };
      throw error;
    }
  }

  async transferBetweenDrafts({ fromOwnerId, toOwnerId, itemSerial, quantity = 1, toSlot = null, drafts }) {
    const from = drafts.get(String(fromOwnerId)); const to = drafts.get(String(toOwnerId));
    if (!from || !to) fail('EXTERNAL_TRANSACTION_REQUIRED', 'Both player item drafts are required for an external trade transaction.');
    const removed = await this._removeBySerialFromDraft(from, itemSerial, quantity, { splitReason: 'trade-escrow' });
    return this._insertExistingIntoDraft(toOwnerId, to, removed.item, { preferredSlot: toSlot });
  }

  async canPickup(ownerId, { templateId, quantity = 1 }) { const state = await this.repository.read(ownerId); const template = await this.templates.get(templateId); try { await this._assertWeightAfterInsert(ownerId, state, template, quantity, { container: CONTAINER_TYPES.INVENTORY, slot: 0 }, { ignoreSlot: true }); } catch (error) { if (error.code === 'MAX_WEIGHT_EXCEEDED') return { ok: false, reason: error.code }; throw error; } return { ok: this._hasInsertionCapacity(state, template, quantity), reason: this._hasInsertionCapacity(state, template, quantity) ? null : 'INVENTORY_FULL' }; }

  async insertFromMerchant(ownerId, { templateId, quantity = 1, serial = null, idempotencyKey, tx = null, sourceNpcId = null }) {
    if (tx) return this._insertIntoDraft(ownerId, tx, { templateId, quantity, serial, source: { kind: 'merchant-buy', sourceNpcId } });
    const template = await this.templates.get(templateId); return this.repository.transact(ownerId, state => this._insertIntoDraft(ownerId, state, { templateId, quantity, serial, source: { kind: 'merchant-buy', sourceNpcId }, template }), { idempotencyKey, event: { type: 'MERCHANT_BUY_INSERT', templateId, quantity, sourceNpcId } });
  }
  async removeForMerchant(ownerId, { itemSerial, quantity = 1, idempotencyKey, tx = null }) { if (tx) return this._removeBySerialFromDraft(tx, itemSerial, quantity); return this.repository.transact(ownerId, state => this._removeBySerialFromDraft(state, itemSerial, quantity), { idempotencyKey, event: { type: 'MERCHANT_SELL_REMOVE', itemSerial, quantity } }); }
  async insertFromLoot(ownerId, { templateId, quantity = 1, serial = null, idempotencyKey, source = null, tx = null }) { if (tx) return this._insertIntoDraft(ownerId, tx, { templateId, quantity, serial, source: { kind: 'loot', ...source } }); return this.repository.transact(ownerId, state => this._insertIntoDraft(ownerId, state, { templateId, quantity, serial, source: { kind: 'loot', ...source } }), { idempotencyKey, event: { type: 'LOOT_INSERT', templateId, quantity, source } }); }

  async transferTradeEscrow({ fromOwnerId, toOwnerId, itemSerial, quantity = 1, toSlot = null, idempotencyKey, signal }) {
    if (typeof this.repository.transactMany !== 'function') fail('MULTI_OWNER_TRANSACTION_REQUIRED', 'Trade escrow requires a multi-owner transaction repository boundary.');
    return this.repository.transactMany([fromOwnerId, toOwnerId], drafts => this.transferBetweenDrafts({ fromOwnerId, toOwnerId, itemSerial, quantity, toSlot, drafts }), { idempotencyKey, signal, event: { type: 'PLAYER_TRADE_ESCROW_TRANSFER', fromOwnerId: String(fromOwnerId), toOwnerId: String(toOwnerId), itemSerial, quantity } });
  }

  async validateInventory(ownerId) { return validateInventoryState(await this.repository.read(ownerId), this.templates); }
  async findOrphanedItems(ownerId) { return findOrphanedItems(await this.repository.read(ownerId), this.templates); }
  async saveSnapshot(ownerId) { return this.repository.exportSnapshot ? this.repository.exportSnapshot(ownerId) : this.repository.read(ownerId); }
  async loadSnapshot(ownerId, snapshot, options = {}) { if (!this.repository.importSnapshot) fail('SNAPSHOT_IMPORT_UNSUPPORTED', 'Repository does not support snapshot import.'); const issues = await validateInventoryState(snapshot, this.templates); if (issues.length) fail('CORRUPT_INVENTORY_SNAPSHOT', 'Snapshot failed inventory validation.', { issues }); return this.repository.importSnapshot(ownerId, snapshot, options); }

  async _insertIntoDraft(ownerId, state, input) {
    const template = input.template ?? await this.templates.get(input.templateId);
    const quantity = Number(input.quantity ?? 1);
    if (!Number.isInteger(quantity) || quantity < 1) fail('INVALID_QUANTITY', 'Quantity must be positive.');
    await this._assertWeightAfterInsert(ownerId, state, template, quantity, { container: CONTAINER_TYPES.INVENTORY, slot: 0 }, { ignoreSlot: true });
    let remaining = quantity; const touched = [];
    if (template.stackable) for (let i = 0; i < state.inventory.length && remaining > 0; i++) { const item = state.inventory[i]; if (!item || item.templateId !== template.id || item.quantity >= template.maxStack) continue; const moved = Math.min(remaining, template.maxStack - item.quantity); state.inventory[i] = withQuantity(item, item.quantity + moved); remaining -= moved; touched.push({ slot: i, quantity: moved, merged: true, serial: item.serial }); }
    while (remaining > 0) {
      const slot = state.inventory.findIndex(x => x == null); if (slot < 0) fail('INVENTORY_FULL', 'No inventory slot is available.'); const amount = Math.min(remaining, template.maxStack); const serial = input.serial != null && touched.length === 0 ? input.serial : await this._nextSerial({ ownerId, templateId: template.id, reason: input.source?.kind ?? 'insert' }); const item = createItemInstance(template, { serial, quantity: amount, metadata: { source: input.source } }); state.inventory[slot] = item; touched.push({ slot, quantity: amount, merged: false, serial: item.serial }); remaining -= amount; }
    return { insertedQuantity: quantity, placements: touched };
  }

  async _insertExistingIntoDraft(ownerId, state, item, { preferredSlot = null } = {}) {
    const template = await this.templates.get(item.templateId); await this._assertWeightAfterInsert(ownerId, state, template, item.quantity, { container: CONTAINER_TYPES.INVENTORY, slot: preferredSlot ?? 0 }, { ignoreSlot: true });
    if (preferredSlot != null) { const pos = { container: CONTAINER_TYPES.INVENTORY, slot: preferredSlot }; validatePosition(state, pos); if (getItem(state, pos)) fail('SLOT_OCCUPIED', 'Preferred trade destination is occupied.'); setItem(state, pos, item); return { slot: preferredSlot, serial: item.serial }; }
    const slot = state.inventory.findIndex(x => x == null); if (slot < 0) fail('INVENTORY_FULL', 'No inventory slot is available.'); state.inventory[slot] = item; return { slot, serial: item.serial };
  }

  async _removeBySerialFromDraft(state, itemSerial, quantity, { splitReason = 'remove' } = {}) {
    const found = findBySerial(state, itemSerial); if (!found) fail('ITEM_NOT_OWNED', `Item serial ${itemSerial} not found.`); if (found.container === CONTAINER_TYPES.EQUIPMENT) fail('EQUIPPED_ITEM_MUTATION_REQUIRES_UNEQUIP', 'Equipped items cannot be sold/traded directly.');
    const requested = Number(quantity); if (!Number.isInteger(requested) || requested < 1 || requested > found.item.quantity) fail('INVALID_QUANTITY', 'Removal quantity exceeds owned stack.');
    const template = await this.templates.get(found.item.templateId);
    if (requested === found.item.quantity) { setItem(state, found, null); return { item: found.item, removedQuantity: requested, consumed: true }; }
    if (!template.stackable) fail('PARTIAL_MOVE_NOT_ALLOWED', 'Non-stackable item cannot be partially removed.');
    const serial = await this._nextSerial({ ownerId: state.ownerId, templateId: template.id, reason: splitReason });
    const removedItem = createItemInstance(template, { serial, quantity: requested, durability: found.item.durability });
    setItem(state, found, withQuantity(found.item, found.item.quantity - requested)); return { item: removedItem, removedQuantity: requested, consumed: false };
  }

  _hasInsertionCapacity(state, template, quantity) {
    let capacity = state.inventory.filter(x => x == null).length * template.maxStack;
    if (template.stackable) for (const item of state.inventory) if (item?.templateId === template.id) capacity += Math.max(0, template.maxStack - item.quantity);
    return capacity >= quantity;
  }

  async _assertDestinationCompatible(ownerId, state, destination, template, { movingFrom = null } = {}) {
    validatePosition(state, destination); if (destination.container !== CONTAINER_TYPES.EQUIPMENT) return;
    if (!template.allowedEquipmentSlots.includes(Number(destination.slot))) fail('ITEM_NOT_EQUIPPABLE_HERE', `Item ${template.id} cannot be equipped in slot ${destination.slot}.`, { itemId: template.id, slot: destination.slot });
    await this._assertRequirements(ownerId, template);
    await this._assertHandConflicts(state, destination, template, movingFrom);
  }

  async _assertRequirements(ownerId, template) {
    const req = template.requirements; if (!req) return;
    if (!this.characterContext) { if (req.minLevel || req.classIds.length || req.raceIds.length || req.nationIds.length || Object.values(req.stats).some(Boolean)) fail('CHARACTER_CONTEXT_REQUIRED', 'Character context is required to validate item requirements.'); return; }
    const ctx = await (typeof this.characterContext === 'function' ? this.characterContext(ownerId) : this.characterContext.get(ownerId));
    if (!ctx) fail('CHARACTER_CONTEXT_REQUIRED', 'Character context was not found.');
    if (Number(ctx.level ?? 0) < req.minLevel) fail('LEVEL_REQUIREMENT_NOT_MET', 'Item level requirement not met.', { required: req.minLevel, actual: ctx.level });
    if (req.maxLevel != null && Number(ctx.level ?? 0) > req.maxLevel) fail('LEVEL_REQUIREMENT_NOT_MET', 'Item maximum level restriction not met.', { max: req.maxLevel, actual: ctx.level });
    if (req.classIds.length && !req.classIds.includes(Number(ctx.classId))) fail('CLASS_REQUIREMENT_NOT_MET', 'Item class requirement not met.', { allowed: req.classIds, actual: ctx.classId });
    if (req.raceIds.length && !req.raceIds.includes(Number(ctx.raceId))) fail('RACE_REQUIREMENT_NOT_MET', 'Item race requirement not met.', { allowed: req.raceIds, actual: ctx.raceId });
    if (req.nationIds.length && !req.nationIds.includes(Number(ctx.nationId))) fail('NATION_REQUIREMENT_NOT_MET', 'Item nation requirement not met.', { allowed: req.nationIds, actual: ctx.nationId });
    const stats = ctx.stats ?? {}; for (const [key, required] of Object.entries(req.stats)) if (Number(stats[key] ?? 0) < required) fail('STAT_REQUIREMENT_NOT_MET', `Item ${key} requirement not met.`, { stat: key, required, actual: stats[key] ?? 0 });
  }

  async _assertHandConflicts(state, destination, template, movingFrom) {
    const slot = Number(destination.slot); if (![EQUIPMENT_SLOTS.RIGHT_HAND, EQUIPMENT_SLOTS.LEFT_HAND].includes(slot)) return;
    const other = slot === EQUIPMENT_SLOTS.RIGHT_HAND ? EQUIPMENT_SLOTS.LEFT_HAND : EQUIPMENT_SLOTS.RIGHT_HAND;
    const otherItem = state.equipment[other];
    const movingFromOther = movingFrom?.container === CONTAINER_TYPES.EQUIPMENT && Number(movingFrom.slot) === other;
    if ([HAND_POLICY.TWO_HAND_RIGHT, HAND_POLICY.TWO_HAND_LEFT].includes(template.handPolicy) && otherItem && !movingFromOther) fail('TWO_HAND_CONFLICT', 'Two-hand item requires the opposite hand to be empty.');
    if (otherItem && !movingFromOther) {
      const otherTemplate = await this.templates.get(otherItem.templateId);
      if ([HAND_POLICY.TWO_HAND_RIGHT, HAND_POLICY.TWO_HAND_LEFT].includes(otherTemplate.handPolicy)) fail('TWO_HAND_CONFLICT', 'Opposite hand is occupied by a two-hand item.');
    }
  }

  async _assertMoveWeight(ownerId, state, beforeWeight) {
    if (!this.characterContext) return;
    const ctx = await (typeof this.characterContext === 'function' ? this.characterContext(ownerId) : this.characterContext.get(ownerId));
    if (!ctx || ctx.maxWeight == null) return;
    const afterWeight = await calculateCarriedWeight(state, this.templates);
    if (afterWeight > Number(ctx.maxWeight) && afterWeight > Number(beforeWeight)) {
      fail('MAX_WEIGHT_EXCEEDED', 'Inventory weight limit exceeded by move.', { beforeWeight, projectedWeight: afterWeight, maxWeight: Number(ctx.maxWeight) });
    }
  }

  async _assertWeightAfterInsert(ownerId, state, template, quantity, destination, { ignoreSlot = false } = {}) {
    if (destination.container === CONTAINER_TYPES.INN) return;
    if (!this.characterContext) return;
    const ctx = await (typeof this.characterContext === 'function' ? this.characterContext(ownerId) : this.characterContext.get(ownerId)); if (!ctx || ctx.maxWeight == null) return;
    const current = await calculateCarriedWeight(state, this.templates); const projected = current + template.weight * Number(quantity);
    if (projected > Number(ctx.maxWeight)) fail('MAX_WEIGHT_EXCEEDED', 'Inventory weight limit exceeded.', { currentWeight: current, itemWeight: template.weight * Number(quantity), projectedWeight: projected, maxWeight: Number(ctx.maxWeight), ignoreSlot });
  }

  async _nextSerial(context) { if (!this.serialGenerator) fail('SERIAL_GENERATOR_REQUIRED', 'A serial generator is required for this mutation.', context); const value = await (typeof this.serialGenerator === 'function' ? this.serialGenerator(context) : this.serialGenerator.next(context)); if (value == null) fail('SERIAL_GENERATOR_FAILED', 'Serial generator returned no value.', context); return value; }
}

function samePosition(a, b) { return a && b && a.container === b.container && Number(a.slot) === Number(b.slot); }

module.exports = { ItemDomainService };
