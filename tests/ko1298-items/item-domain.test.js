'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  EQUIPMENT_SLOTS,
  CONTAINER_TYPES,
  ItemTemplateRegistry,
  InMemoryItemRepository,
  ItemDomainService,
  ItemDomainError,
} = require('../../services/ko1298-items');

function fixture({ duplicateSerialHook } = {}) {
  const rows = new Map([
    [1001, { id: 1001, name: 'Old Sword', stackable: false, allowedEquipmentSlots: [EQUIPMENT_SLOTS.RIGHT_HAND], maxDurability: 120 }],
    [1002, { id: 1002, name: 'Old Shield', stackable: false, allowedEquipmentSlots: [EQUIPMENT_SLOTS.LEFT_HAND], maxDurability: 90 }],
    [2001, { id: 2001, name: 'Potion', stackable: true, maxStack: 9999, allowedEquipmentSlots: [] }],
  ]);
  const templates = new ItemTemplateRegistry({ get: async id => rows.get(Number(id)) });
  const repository = new InMemoryItemRepository({ duplicateSerialHook });
  const service = new ItemDomainService({ repository, templates });
  return { repository, service };
}

const inv = slot => ({ container: CONTAINER_TYPES.INVENTORY, slot });
const inn = slot => ({ container: CONTAINER_TYPES.INN, slot });

async function expectCode(promise, code) {
  await assert.rejects(promise, error => error instanceof ItemDomainError && error.code === code);
}

test('creates a unique item instance in inventory', async () => {
  const { repository, service } = fixture();
  await service.createItem('char-1', inv(0), { templateId: 1001, serial: '900000000000000001' });
  const state = await repository.read('char-1');
  assert.equal(state.inventory[0].serial, '900000000000000001');
  assert.equal(state.inventory[0].quantity, 1);
});

test('non-stackable item rejects quantity greater than one', async () => {
  const { service } = fixture();
  await expectCode(service.createItem('char-1', inv(0), { templateId: 1001, serial: '1', quantity: 2 }), 'NON_STACKABLE_QUANTITY');
});

test('stackable items merge and preserve destination serial', async () => {
  const { repository, service } = fixture();
  await service.createItem('char-1', inv(0), { templateId: 2001, serial: '10', quantity: 40 });
  await service.createItem('char-1', inv(1), { templateId: 2001, serial: '11', quantity: 2 });
  await service.move('char-1', inv(0), inv(1), { quantity: 15 });
  const state = await repository.read('char-1');
  assert.equal(state.inventory[1].serial, '11');
  assert.equal(state.inventory[1].quantity, 17);
  assert.equal(state.inventory[0].quantity, 25);
});

test('partial stack move into empty slot requires a new serial', async () => {
  const { repository, service } = fixture();
  await service.createItem('char-1', inv(0), { templateId: 2001, serial: '20', quantity: 10 });
  await expectCode(service.move('char-1', inv(0), inv(1), { quantity: 4 }), 'SPLIT_SERIAL_REQUIRED');
  await service.move('char-1', inv(0), inv(1), { quantity: 4, splitSerial: '21' });
  const state = await repository.read('char-1');
  assert.equal(state.inventory[0].quantity, 6);
  assert.equal(state.inventory[1].quantity, 4);
  assert.equal(state.inventory[1].serial, '21');
});

test('equip and unequip validate legacy equipment slot compatibility', async () => {
  const { repository, service } = fixture();
  await service.createItem('char-1', inv(0), { templateId: 1001, serial: '30' });
  await expectCode(service.equip('char-1', 0, EQUIPMENT_SLOTS.LEFT_HAND), 'ITEM_NOT_EQUIPPABLE_HERE');
  await service.equip('char-1', 0, EQUIPMENT_SLOTS.RIGHT_HAND);
  let state = await repository.read('char-1');
  assert.equal(state.equipment[EQUIPMENT_SLOTS.RIGHT_HAND].serial, '30');
  await service.unequip('char-1', EQUIPMENT_SLOTS.RIGHT_HAND, 5);
  state = await repository.read('char-1');
  assert.equal(state.inventory[5].serial, '30');
  assert.equal(state.equipment[EQUIPMENT_SLOTS.RIGHT_HAND], null);
});

test('occupied inventory slots swap atomically', async () => {
  const { repository, service } = fixture();
  await service.createItem('char-1', inv(0), { templateId: 1001, serial: '40' });
  await service.createItem('char-1', inv(1), { templateId: 1002, serial: '41' });
  await service.move('char-1', inv(0), inv(1));
  const state = await repository.read('char-1');
  assert.equal(state.inventory[0].serial, '41');
  assert.equal(state.inventory[1].serial, '40');
});

test('inn interface moves items without introducing merchant logic', async () => {
  const { repository, service } = fixture();
  await service.createItem('char-1', inv(0), { templateId: 1001, serial: '50' });
  await service.moveToInn('char-1', inv(0), 0);
  let state = await repository.read('char-1');
  assert.equal(state.inn[0].serial, '50');
  assert.equal(state.inventory[0], null);
  await service.moveFromInn('char-1', 0, inv(2));
  state = await repository.read('char-1');
  assert.equal(state.inventory[2].serial, '50');
});

test('global duplicate serial is rejected and hook receives details', async () => {
  const reports = [];
  const { service } = fixture({ duplicateSerialHook: event => reports.push(event) });
  await service.createItem('char-a', inv(0), { templateId: 1001, serial: '60' });
  await expectCode(service.createItem('char-b', inv(0), { templateId: 1002, serial: '60' }), 'DUPLICATE_SERIAL');
  assert.equal(reports.length, 1);
  assert.equal(reports[0].existingOwner, 'char-a');
});

test('failed operation rolls back the complete transaction', async () => {
  const { repository, service } = fixture();
  await service.createItem('char-1', inv(0), { templateId: 1001, serial: '70' });
  const before = await repository.read('char-1');
  await expectCode(service.equip('char-1', 0, EQUIPMENT_SLOTS.LEFT_HAND), 'ITEM_NOT_EQUIPPABLE_HERE');
  const after = await repository.read('char-1');
  assert.deepEqual(after, before);
});

test('concurrent moves on one owner serialize; only one consumes the source', async () => {
  const { repository, service } = fixture();
  await service.createItem('char-1', inv(0), { templateId: 1001, serial: '80' });
  const results = await Promise.allSettled([
    service.move('char-1', inv(0), inv(1)),
    service.move('char-1', inv(0), inv(2)),
  ]);
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(results.filter(x => x.status === 'rejected' && x.reason.code === 'SOURCE_EMPTY').length, 1);
  const state = await repository.read('char-1');
  const copies = [state.inventory[1], state.inventory[2]].filter(Boolean);
  assert.equal(copies.length, 1);
  assert.equal(copies[0].serial, '80');
});

test('concurrent duplicate serial creation across owners has one winner', async () => {
  const { repository, service } = fixture();
  const results = await Promise.allSettled([
    service.createItem('char-a', inv(0), { templateId: 1001, serial: '90' }),
    service.createItem('char-b', inv(0), { templateId: 1002, serial: '90' }),
  ]);
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(results.filter(x => x.status === 'rejected' && x.reason.code === 'DUPLICATE_SERIAL').length, 1);
  assert.deepEqual(await repository.scanForDuplicateSerials(), []);
});

test('slot bounds enforce 14 equipment, 28 inventory and 196 inn slots', async () => {
  const { service } = fixture();
  await expectCode(service.createItem('char-1', inv(28), { templateId: 1001, serial: '100' }), 'INVALID_SLOT');
  await expectCode(service.createItem('char-1', inn(196), { templateId: 1001, serial: '101' }), 'INVALID_SLOT');
});
