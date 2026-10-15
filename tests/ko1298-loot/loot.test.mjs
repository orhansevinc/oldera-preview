import test from 'node:test';
import assert from 'node:assert/strict';
import {
  InMemorySerialGuard,
  KillerOwnershipPolicy,
  LootService,
  SeededRng,
  isLootDomainError,
  rollDropTable,
  validateDropTable
} from '../../services/ko1298-loot/src/index.js';

function makePorts({ table, owners, serial = 'serial-1', distance = true, capacity = true, itemGrant, coinGrant } = {}) {
  const serialGuard = new InMemorySerialGuard();
  const grantedItems = [];
  const grantedCoins = [];
  return {
    serialGuard,
    grantedItems,
    grantedCoins,
    ports: {
      dropTables: { async findForMob() { return table ?? null; } },
      ownership: owners ?? new KillerOwnershipPolicy(),
      distance: { async canPickup() { return distance; } },
      inventory: { async canAccept() { return capacity; } },
      serials: { async createForDrop() { return serial; } },
      serialGuard,
      items: { async grant(payload) { grantedItems.push(payload); if (itemGrant) await itemGrant(payload); } },
      coins: { async grant(payload) { grantedCoins.push(payload); if (coinGrant) await coinGrant(payload); } }
    }
  };
}

function death(overrides = {}) {
  return {
    eventId: 'death-1',
    mobInstanceId: 'mob-instance-1',
    mobTemplateId: 1001,
    killerCharacterId: 'char-killer',
    zoneId: 21,
    position: { x: 10, z: 20 },
    ...overrides
  };
}

const itemTable = {
  id: 'fixture.item-only',
  rolls: 1,
  entries: [{ kind: 'item', itemId: 900001, weight: 1, minQuantity: 1, maxQuantity: 1 }]
};

const coinTable = {
  id: 'fixture.coin-only',
  rolls: 1,
  entries: [{ kind: 'coin', weight: 1, minQuantity: 12, maxQuantity: 12 }]
};

test('seeded RNG produces deterministic weighted results', () => {
  const table = validateDropTable({
    id: 'fixture.weighted',
    rolls: 8,
    entries: [
      { kind: 'none', weight: 5 },
      { kind: 'item', itemId: 1, weight: 3, minQuantity: 1, maxQuantity: 2 },
      { kind: 'coin', weight: 2, minQuantity: 10, maxQuantity: 20 }
    ]
  });
  const a = rollDropTable(table, new SeededRng(123456));
  const b = rollDropTable(table, new SeededRng(123456));
  assert.deepEqual(a, b);
  assert.deepEqual(a, [
    { kind: 'item', itemId: 1, quantity: 1 },
    { kind: 'item', itemId: 1, quantity: 2 },
    { kind: 'coin', quantity: 14 },
    { kind: 'item', itemId: 1, quantity: 1 }
  ]);
});

test('invalid and impossible drop definitions are rejected', () => {
  const invalid = [
    { id: 'x', rolls: 1, entries: [{ kind: 'item', itemId: 1, weight: -1, minQuantity: 1, maxQuantity: 1 }] },
    { id: 'x', rolls: 1, entries: [{ kind: 'coin', weight: 1, minQuantity: -2, maxQuantity: 1 }] },
    { id: 'x', rolls: 1, entries: [{ kind: 'coin', weight: 1, minQuantity: 3, maxQuantity: 2 }] },
    { id: 'x', rolls: 0, entries: [{ kind: 'none', weight: 1 }] },
    { id: 'x', rolls: 1, entries: [] }
  ];
  for (const table of invalid) {
    assert.throws(() => validateDropTable(table), (error) => isLootDomainError(error, 'INVALID_DROP_TABLE'));
  }
});

test('mob death creates item loot once per event id', async () => {
  const { ports } = makePorts({ table: itemTable });
  const service = new LootService({ ports, clock: () => 1000, idFactory: () => 'loot-A', lootLifetimeMs: 5000 });
  const first = await service.createFromMobDeath(death(), { seed: 7 });
  const second = await service.createFromMobDeath(death(), { seed: 999 });
  assert.equal(first.length, 1);
  assert.equal(first[0].lootId, 'loot-A');
  assert.deepEqual(second, first);
  assert.equal(service.listLoot().length, 1);
});

test('concurrent duplicate mob death delivery rolls only once', async () => {
  let lookupCount = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const { ports } = makePorts({ table: itemTable });
  ports.dropTables.findForMob = async () => { lookupCount += 1; await gate; return itemTable; };
  let id = 0;
  const service = new LootService({ ports, clock: () => 1000, idFactory: () => `loot-idem-${++id}` });
  const a = service.createFromMobDeath(death(), { seed: 1 });
  const b = service.createFromMobDeath(death(), { seed: 999 });
  release();
  const [first, second] = await Promise.all([a, b]);
  assert.equal(lookupCount, 1);
  assert.deepEqual(second, first);
  assert.equal(service.listLoot().length, 1);
});

test('pickup validates ownership, zone, distance and inventory capacity', async () => {
  const cases = [
    { name: 'ownership', characterId: 'other', code: 'LOOT_NOT_OWNED' },
    { name: 'zone', characterId: 'char-killer', zoneId: 22, code: 'PICKUP_ZONE_MISMATCH' },
    { name: 'distance', characterId: 'char-killer', distance: false, code: 'LOOT_OUT_OF_RANGE' },
    { name: 'capacity', characterId: 'char-killer', capacity: false, code: 'INVENTORY_CAPACITY' }
  ];

  for (const scenario of cases) {
    const { ports } = makePorts({ table: itemTable, distance: scenario.distance ?? true, capacity: scenario.capacity ?? true });
    const service = new LootService({ ports, clock: () => 1000, idFactory: () => `loot-${scenario.name}` });
    const [loot] = await service.createFromMobDeath(death({ eventId: `death-${scenario.name}` }), { seed: 1 });
    await assert.rejects(
      service.pickup({
        lootId: loot.lootId,
        characterId: scenario.characterId,
        zoneId: scenario.zoneId ?? 21,
        position: { x: 10, z: 20 }
      }),
      (error) => isLootDomainError(error, scenario.code)
    );
  }
});

test('item pickup grants through WS17-facing ports and commits unique serial', async () => {
  const { ports, serialGuard, grantedItems } = makePorts({ table: itemTable, serial: 'u-100' });
  const service = new LootService({ ports, clock: () => 1000, idFactory: () => 'loot-item' });
  const [loot] = await service.createFromMobDeath(death(), { seed: 1 });
  const receipt = await service.pickup({ lootId: loot.lootId, characterId: 'char-killer', zoneId: 21, position: { x: 10, z: 20 } });
  assert.deepEqual(receipt, { lootId: 'loot-item', characterId: 'char-killer', kind: 'item', itemId: 900001, quantity: 1, serial: 'u-100' });
  assert.equal(serialGuard.stateOf('u-100'), 'committed');
  assert.equal(grantedItems.length, 1);
  assert.equal(service.getLoot('loot-item'), null);
});

test('duplicate serial is blocked before item grant', async () => {
  const { ports, serialGuard, grantedItems } = makePorts({ table: itemTable, serial: 'dupe' });
  await serialGuard.reserve('dupe');
  await serialGuard.commit('dupe');
  const service = new LootService({ ports, clock: () => 1000, idFactory: () => 'loot-dupe' });
  const [loot] = await service.createFromMobDeath(death(), { seed: 1 });
  await assert.rejects(
    service.pickup({ lootId: loot.lootId, characterId: 'char-killer', zoneId: 21, position: { x: 10, z: 20 } }),
    (error) => isLootDomainError(error, 'DUPLICATE_ITEM_SERIAL')
  );
  assert.equal(grantedItems.length, 0);
  assert.equal(service.getLoot('loot-dupe').state, 'available');
});

test('failed item grant releases serial reservation and restores loot', async () => {
  const { ports, serialGuard } = makePorts({
    table: itemTable,
    serial: 'retryable',
    itemGrant: async () => { throw new Error('inventory transaction failed'); }
  });
  const service = new LootService({ ports, clock: () => 1000, idFactory: () => 'loot-retry' });
  const [loot] = await service.createFromMobDeath(death(), { seed: 1 });
  await assert.rejects(
    service.pickup({ lootId: loot.lootId, characterId: 'char-killer', zoneId: 21, position: { x: 10, z: 20 } }),
    /inventory transaction failed/
  );
  assert.equal(serialGuard.stateOf('retryable'), null);
  assert.equal(service.getLoot('loot-retry').state, 'available');
});

test('coin drop uses coin interface', async () => {
  const { ports, grantedCoins } = makePorts({ table: coinTable });
  const service = new LootService({ ports, clock: () => 1000, idFactory: () => 'loot-coin' });
  const [loot] = await service.createFromMobDeath(death(), { seed: 1 });
  const receipt = await service.pickup({ lootId: loot.lootId, characterId: 'char-killer', zoneId: 21, position: { x: 10, z: 20 } });
  assert.equal(receipt.kind, 'coin');
  assert.equal(receipt.quantity, 12);
  assert.equal(grantedCoins[0].amount, 12);
});

test('party ownership can be supplied as an interface without WS18 dependency', async () => {
  const owners = {
    async resolveOwners() { return { characterIds: ['char-killer', 'party-member'], publicAfterMs: null }; },
    async canPickup({ loot, characterId }) { return loot.ownerCharacterIds.includes(characterId); }
  };
  const { ports } = makePorts({ table: itemTable, owners });
  const service = new LootService({ ports, clock: () => 1000, idFactory: () => 'loot-party' });
  const [loot] = await service.createFromMobDeath(death(), { seed: 1 });
  const receipt = await service.pickup({ lootId: loot.lootId, characterId: 'party-member', zoneId: 21, position: { x: 10, z: 20 } });
  assert.equal(receipt.characterId, 'party-member');
});

test('expired loot is despawned and cannot be picked up', async () => {
  const { ports } = makePorts({ table: itemTable });
  let now = 1000;
  const service = new LootService({ ports, clock: () => now, idFactory: () => 'loot-expire', lootLifetimeMs: 50 });
  const [loot] = await service.createFromMobDeath(death(), { seed: 1 });
  now = 1050;
  await assert.rejects(
    service.pickup({ lootId: loot.lootId, characterId: 'char-killer', zoneId: 21, position: { x: 10, z: 20 } }),
    (error) => isLootDomainError(error, 'LOOT_EXPIRED')
  );
  assert.equal(service.getLoot('loot-expire'), null);
});

test('sweepExpired removes only expired available loot', async () => {
  const { ports } = makePorts({ table: itemTable });
  let now = 1000;
  let id = 0;
  const service = new LootService({ ports, clock: () => now, idFactory: () => `loot-${++id}`, lootLifetimeMs: 100 });
  await service.createFromMobDeath(death({ eventId: 'death-a' }), { seed: 1 });
  now = 1050;
  await service.createFromMobDeath(death({ eventId: 'death-b', mobInstanceId: 'mob-b' }), { seed: 1 });
  now = 1100;
  assert.deepEqual(service.sweepExpired(), ['loot-1']);
  assert.equal(service.listLoot().length, 1);
});

test('concurrent pickup allows only one claimant', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const { ports, grantedItems } = makePorts({ table: itemTable, itemGrant: async () => gate });
  const service = new LootService({ ports, clock: () => 1000, idFactory: () => 'loot-race' });
  const [loot] = await service.createFromMobDeath(death(), { seed: 1 });
  const request = { lootId: loot.lootId, characterId: 'char-killer', zoneId: 21, position: { x: 10, z: 20 } };
  const first = service.pickup(request);
  const second = service.pickup(request);
  await assert.rejects(second, (error) => isLootDomainError(error, 'LOOT_BUSY'));
  release();
  await first;
  assert.equal(grantedItems.length, 1);
});
