'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  InnStorageService,
  InMemoryInnRepository,
  createPlainItemPort,
} = require('../../services/ko1298-inn');

function item(templateId, serial, quantity = 1) {
  return { templateId, serial, quantity, durability: 100 };
}

function baseTemplates() {
  return new Map([
    [1001, { id: 1001, stackable: false, maxStack: 1 }],
    [2001, { id: 2001, stackable: true, maxStack: 9999 }],
  ]);
}

async function expectCode(promise, code) {
  await assert.rejects(promise, error => error && error.code === code);
}

test('concurrent transfers of the same source serialize: one wins, one sees SOURCE_EMPTY, no duplicate/loss', async () => {
  const repository = new InMemoryInnRepository();
  const service = new InnStorageService({ repository, items: createPlainItemPort({ templates: baseTemplates() }) });
  await repository.seedAccount(1, { characters: { 10: { 0: item(1001, 10001) } } });

  const results = await Promise.allSettled([
    service.deposit({ accountId: 1, characterId: 10, inventorySlot: 0, innPage: 0, innSlot: 0 }),
    service.deposit({ accountId: 1, characterId: 10, inventorySlot: 0, innPage: 0, innSlot: 1 }),
  ]);

  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const rejected = results.find(r => r.status === 'rejected');
  assert.equal(rejected.reason.code, 'SOURCE_EMPTY');

  const state = await repository.read(1);
  assert.equal(state.characters['10'].inventory[0], null);
  assert.equal(state.inn.filter(Boolean).length, 1);
  assert.equal(state.inn.find(Boolean).serial, 10001);
  assert.deepEqual(await repository.scanForDuplicateSerials(), []);
});

test('same account, two characters concurrently moving to one inn slot cannot overwrite each other', async () => {
  const repository = new InMemoryInnRepository();
  const service = new InnStorageService({ repository, items: createPlainItemPort({ templates: baseTemplates() }) });
  await repository.seedAccount(1, { characters: { 10: { 0: item(1001, 11001) }, 11: { 0: item(1001, 11002) } } });

  const results = await Promise.allSettled([
    service.deposit({ accountId: 1, characterId: 10, inventorySlot: 0, innPage: 0, innSlot: 0 }),
    service.deposit({ accountId: 1, characterId: 11, inventorySlot: 0, innPage: 0, innSlot: 0 }),
  ]);

  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const rejected = results.find(r => r.status === 'rejected');
  assert.equal(rejected.reason.code, 'DESTINATION_OCCUPIED');
  const state = await repository.read(1);
  assert.equal(state.inn.filter(Boolean).length, 1);
  assert.equal(state.characters['10'].inventory.filter(Boolean).length + state.characters['11'].inventory.filter(Boolean).length, 1);
});

test('duplicate split serial across accounts triggers hook and loser transaction rolls back', async () => {
  const duplicateEvents = [];
  const repository = new InMemoryInnRepository({ duplicateSerialHook: event => duplicateEvents.push(event) });
  const service = new InnStorageService({ repository, items: createPlainItemPort({ templates: baseTemplates() }) });
  await repository.seedAccount(1, { characters: { 10: { 0: item(2001, 12001, 10) } } });
  await repository.seedAccount(2, { characters: { 20: { 0: item(2001, 12002, 10) } } });

  const results = await Promise.allSettled([
    service.deposit({ accountId: 1, characterId: 10, inventorySlot: 0, innPage: 0, innSlot: 0, quantity: 5, splitSerial: 19999 }),
    service.deposit({ accountId: 2, characterId: 20, inventorySlot: 0, innPage: 0, innSlot: 0, quantity: 5, splitSerial: 19999 }),
  ]);

  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const rejected = results.find(r => r.status === 'rejected');
  assert.equal(rejected.reason.code, 'DUPLICATE_SERIAL');
  assert.equal(duplicateEvents.length, 1);

  const s1 = await repository.read(1);
  const s2 = await repository.read(2);
  const loser = rejected.reason.details.attemptedAccount === 1 ? s1 : s2;
  assert.equal(loser.inn.filter(Boolean).length, 0);
  assert.equal(loser.characters[String(rejected.reason.details.attemptedAccount === 1 ? 10 : 20)].inventory[0].quantity, 10);
  assert.deepEqual(await repository.scanForDuplicateSerials(), []);
});

test('item-port failure after transaction begins rolls back draft completely', async () => {
  const repository = new InMemoryInnRepository();
  const items = createPlainItemPort({ templates: baseTemplates() });
  items.getTemplate = async () => { throw Object.assign(new Error('catalog offline'), { code: 'CATALOG_OFFLINE' }); };
  const service = new InnStorageService({ repository, items });
  await repository.seedAccount(1, { characters: { 10: { 0: item(1001, 13001) } } });
  const before = await repository.read(1);

  await assert.rejects(service.deposit({ accountId: 1, characterId: 10, inventorySlot: 0, innPage: 0, innSlot: 0 }), /catalog offline/);
  assert.deepEqual(await repository.read(1), before);
});

test('disconnect/abort during asynchronous transfer cannot leave half transaction', async () => {
  const repository = new InMemoryInnRepository();
  const controller = new AbortController();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const items = createPlainItemPort({ templates: baseTemplates() });
  const originalGet = items.getTemplate;
  items.getTemplate = async templateId => {
    await gate;
    return originalGet(templateId);
  };
  const service = new InnStorageService({ repository, items });
  await repository.seedAccount(1, { characters: { 10: { 0: item(1001, 14001) } } });
  const before = await repository.read(1);

  const transfer = service.deposit({ accountId: 1, characterId: 10, inventorySlot: 0, innPage: 0, innSlot: 0, signal: controller.signal });
  controller.abort();
  release();
  await expectCode(transfer, 'TRANSFER_ABORTED');
  assert.deepEqual(await repository.read(1), before);
});

test('repository conservation guard rejects a malicious transaction that creates quantity', async () => {
  const repository = new InMemoryInnRepository();
  await repository.seedAccount(1, { characters: { 10: { 0: item(2001, 15001, 10) } } });
  const before = await repository.read(1);

  await expectCode(repository.transact({ accountId: 1, characterId: 10 }, async state => {
    state.characters['10'].inventory[0].quantity += 1;
  }), 'ITEM_CONSERVATION_VIOLATION');

  assert.deepEqual(await repository.read(1), before);
});
