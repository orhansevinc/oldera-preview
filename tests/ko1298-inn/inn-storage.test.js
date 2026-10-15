'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  INN_PAGE_COUNT,
  INN_SLOTS_PER_PAGE,
  INN_SLOT_COUNT,
  INVENTORY_SLOT_COUNT,
  InnStorageService,
  InMemoryInnRepository,
  createPlainItemPort,
  createInnHostessHandler,
} = require('../../services/ko1298-inn');

function item(templateId, serial, quantity = 1) {
  return { templateId, serial, quantity, durability: 100 };
}

function setup(extra = {}) {
  const templates = new Map([
    [1001, { id: 1001, stackable: false, maxStack: 1 }],
    [2001, { id: 2001, stackable: true, maxStack: 9999 }],
    [2002, { id: 2002, stackable: true, maxStack: 10 }],
  ]);
  const repository = extra.repository || new InMemoryInnRepository(extra.repositoryOptions);
  const items = extra.items || createPlainItemPort({ templates });
  const service = new InnStorageService({ repository, items });
  return { repository, items, service, templates };
}

async function expectCode(promise, code) {
  await assert.rejects(promise, error => error && error.code === code);
}

test('1298 model exposes 7 pages x 28 slots = 196 and 28 inventory slots', () => {
  assert.equal(INN_PAGE_COUNT, 7);
  assert.equal(INN_SLOTS_PER_PAGE, 28);
  assert.equal(INN_SLOT_COUNT, 196);
  assert.equal(INVENTORY_SLOT_COUNT, 28);
});

test('inn is account-scoped: one character deposits and another character on same account withdraws', async () => {
  const { repository, service } = setup();
  await repository.seedAccount(1, { characters: { 10: { 0: item(1001, 9001) }, 11: {} } });

  const deposit = await service.deposit({ accountId: 1, characterId: 10, inventorySlot: 0, innPage: 6, innSlot: 27 });
  assert.equal(deposit.serial, 9001);

  const open = await service.open(1);
  assert.equal(open.pages[6].slots[27].serial, 9001);

  await service.withdraw({ accountId: 1, characterId: 11, innPage: 6, innSlot: 27, inventorySlot: 3 });
  const state = await repository.read(1);
  assert.equal(state.characters['10'].inventory[0], null);
  assert.equal(state.characters['11'].inventory[3].serial, 9001);
  assert.equal(state.inn[195], null);
});

test('invalid page/slot/inventory is rejected before mutation', async () => {
  const { repository, service } = setup();
  await repository.seedAccount(1, { characters: { 10: { 0: item(1001, 9001) } } });
  const before = await repository.read(1);

  await expectCode(service.deposit({ accountId: 1, characterId: 10, inventorySlot: 0, innPage: 7, innSlot: 0 }), 'INVALID_INN_PAGE');
  await expectCode(service.deposit({ accountId: 1, characterId: 10, inventorySlot: 0, innPage: 0, innSlot: 28 }), 'INVALID_INN_SLOT');
  await expectCode(service.deposit({ accountId: 1, characterId: 10, inventorySlot: 28, innPage: 0, innSlot: 0 }), 'INVALID_INVENTORY_SLOT');

  assert.deepEqual(await repository.read(1), before);
});

test('unique non-stackable serial survives inventory -> inn -> inventory unchanged', async () => {
  const { repository, service } = setup();
  await repository.seedAccount(1, { characters: { 10: { 4: item(1001, 123456789) } } });

  await service.deposit({ accountId: 1, characterId: 10, inventorySlot: 4, innPage: 0, innSlot: 5 });
  let state = await repository.read(1);
  assert.equal(state.inn[5].serial, 123456789);
  assert.equal(state.characters['10'].inventory[4], null);

  await service.withdraw({ accountId: 1, characterId: 10, innPage: 0, innSlot: 5, inventorySlot: 7 });
  state = await repository.read(1);
  assert.equal(state.characters['10'].inventory[7].serial, 123456789);
  assert.equal(state.inn[5], null);
});

test('stack split requires explicit unique serial and conserves quantity', async () => {
  const { repository, service } = setup();
  await repository.seedAccount(1, { characters: { 10: { 0: item(2001, 5001, 100) } } });

  await expectCode(service.deposit({ accountId: 1, characterId: 10, inventorySlot: 0, innPage: 0, innSlot: 0, quantity: 25 }), 'SPLIT_SERIAL_REQUIRED');
  await service.deposit({ accountId: 1, characterId: 10, inventorySlot: 0, innPage: 0, innSlot: 0, quantity: 25, splitSerial: 5002 });

  const state = await repository.read(1);
  assert.equal(state.characters['10'].inventory[0].serial, 5001);
  assert.equal(state.characters['10'].inventory[0].quantity, 75);
  assert.equal(state.inn[0].serial, 5002);
  assert.equal(state.inn[0].quantity, 25);
});

test('stack merge is exact, capacity checked, and rolls back when over capacity', async () => {
  const { repository, service } = setup();
  await repository.seedAccount(1, {
    characters: { 10: { 0: item(2002, 6001, 5) } },
    inn: [{ page: 0, slot: 0, item: item(2002, 6002, 8) }],
  });
  const before = await repository.read(1);

  await expectCode(service.deposit({ accountId: 1, characterId: 10, inventorySlot: 0, innPage: 0, innSlot: 0, quantity: 3 }), 'STACK_CAPACITY_EXCEEDED');
  assert.deepEqual(await repository.read(1), before);

  await service.deposit({ accountId: 1, characterId: 10, inventorySlot: 0, innPage: 0, innSlot: 0, quantity: 2 });
  const after = await repository.read(1);
  assert.equal(after.inn[0].serial, 6002);
  assert.equal(after.inn[0].quantity, 10);
  assert.equal(after.characters['10'].inventory[0].serial, 6001);
  assert.equal(after.characters['10'].inventory[0].quantity, 3);
});

test('occupied different item never swaps implicitly', async () => {
  const { repository, service } = setup();
  await repository.seedAccount(1, {
    characters: { 10: { 0: item(1001, 7001) } },
    inn: [{ page: 0, slot: 0, item: item(2001, 7002, 1) }],
  });
  const before = await repository.read(1);
  await expectCode(service.deposit({ accountId: 1, characterId: 10, inventorySlot: 0, innPage: 0, innSlot: 0 }), 'DESTINATION_OCCUPIED');
  assert.deepEqual(await repository.read(1), before);
});

test('item ownership is enforced by account-character relationship', async () => {
  const { repository, service } = setup();
  await repository.seedAccount(1, { characters: { 10: { 0: item(1001, 8001) } } });
  await repository.seedAccount(2, { characters: { 20: {} } });

  await expectCode(service.deposit({ accountId: 2, characterId: 10, inventorySlot: 0, innPage: 0, innSlot: 0 }), 'ITEM_OWNERSHIP_MISMATCH');
  assert.equal((await repository.read(1)).characters['10'].inventory[0].serial, 8001);
});

test('Inn Hostess adapter exposes account warehouse without inventing NPC identity', async () => {
  const { repository, service } = setup();
  await repository.seedAccount(1, { characters: { 10: {} } });
  const handler = createInnHostessHandler({ service });
  const result = await handler({ session: { accountId: 1, characterId: 10 }, npc: { instanceId: 999 } });

  assert.equal(result.kind, 'inn-storage');
  assert.equal(result.interface, 'inn');
  assert.equal(result.storage.totalSlots, 196);
  assert.equal(result.npc.instanceId, 999);
});
