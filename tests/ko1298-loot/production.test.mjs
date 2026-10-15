import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SeededRng } from '../../services/ko1298-loot/src/rng.js';
import { KillerOwnershipPolicy } from '../../services/ko1298-loot/src/ports.js';
import {
  Verified1298DropTableAdapter,
  rollVerified1298DropTable
} from '../../services/ko1298-loot/src/verified1298.js';
import {
  ProductionLootService,
  isProductionLootDomainError
} from '../../services/ko1298-loot/src/production.js';
import {
  InMemoryLootStore,
  InMemoryReplayGuard,
  InMemoryTransactionalSerialGuard,
  InlineTransactionPort
} from '../../services/ko1298-loot/src/productionPorts.js';

const sample = JSON.parse(fs.readFileSync(
  new URL('../../world-data/drops/verified1298.sample.json', import.meta.url),
  'utf8'
));

function verifiedAdapter(overrides = {}) {
  return new Verified1298DropTableAdapter({ ...sample, ...overrides });
}

function directItemAdapter({ itemId = 379016000, chance = 10000, moneyBase = 0 } = {}) {
  return verifiedAdapter({
    monsterMappings: [{ monsterTemplateId: 100, dropTableKey: 100, moneyBase }],
    dropTables: [{
      dropTableKey: 100,
      slots: [
        { itemCode: 0, chance: 0 },
        { itemCode: 0, chance: 0 },
        { itemCode: itemId, chance },
        { itemCode: 0, chance: 0 },
        { itemCode: 0, chance: 0 }
      ]
    }],
    itemGroups: []
  });
}

function death(overrides = {}) {
  return {
    eventId: 'death-1',
    mobInstanceId: 'mob-1',
    mobTemplateId: 100,
    killerCharacterId: 'killer',
    zoneId: 21,
    position: { x: 10, z: 20 },
    ...overrides
  };
}

function makePorts({
  dropTables = directItemAdapter(),
  owners = new KillerOwnershipPolicy(),
  playerStates,
  distance = true,
  capacity = true,
  itemExists = true,
  serialFactory,
  transactionPort,
  lootStore,
  itemGrant,
  coinGrant
} = {}) {
  const serialGuard = new InMemoryTransactionalSerialGuard();
  const replay = new InMemoryReplayGuard();
  const store = lootStore ?? new InMemoryLootStore();
  const items = [];
  const coins = [];
  const audits = [];
  let serialCounter = 0;
  let stateIndex = 0;
  const states = playerStates ?? [{
    alive: true,
    worldReady: true,
    connected: true,
    zoneId: 21,
    position: { x: 10, z: 20 }
  }];

  return {
    serialGuard,
    replay,
    store,
    items,
    coins,
    audits,
    ports: {
      dropTables,
      ownership: owners,
      playerState: {
        async getLootState() {
          return states[Math.min(stateIndex++, states.length - 1)];
        }
      },
      distance: { async canPickup() { return distance; } },
      itemTemplates: { async exists() { return itemExists; } },
      inventory: { async canAccept() { return capacity; } },
      items: {
        async grant(payload) {
          items.push(payload);
          if (itemGrant) await itemGrant(payload);
        }
      },
      coins: {
        async grant(payload) {
          coins.push(payload);
          if (coinGrant) await coinGrant(payload);
        }
      },
      serials: {
        async createForDrop() {
          return serialFactory ? serialFactory() : `serial-${++serialCounter}`;
        }
      },
      serialGuard,
      transactions: transactionPort ?? new InlineTransactionPort(),
      lootStore: store,
      replay,
      audit: { async append(event) { audits.push(event); } }
    }
  };
}

async function spawn(service, overrides = {}, seed = 1) {
  return service.createFromMobDeath(death(overrides), { seed });
}

test('verified sample maps Kecoon through K_MONSTER.sItem to table 100', async () => {
  const table = await verifiedAdapter().findForMob(100);
  assert.equal(table.dropTableKey, 100);
  assert.equal(table.moneyBase, 73);
  assert.equal(table.slots[4].itemCode, 391010000);
  assert.equal(await verifiedAdapter().findForMob(999), null);
});

test('duplicate verified mappings/tables/groups fail closed', () => {
  assert.throws(
    () => verifiedAdapter({ monsterMappings: [sample.monsterMappings[0], sample.monsterMappings[0]] }),
    (error) => isProductionLootDomainError(error, 'DUPLICATE_MONSTER_DROP_MAPPING')
  );
  assert.throws(
    () => verifiedAdapter({ dropTables: [sample.dropTables[0], sample.dropTables[0]] }),
    (error) => isProductionLootDomainError(error, 'DUPLICATE_DROP_TABLE')
  );
  assert.throws(
    () => verifiedAdapter({ itemGroups: [sample.itemGroups[0], sample.itemGroups[0]] }),
    (error) => isProductionLootDomainError(error, 'DUPLICATE_ITEM_GROUP')
  );
});

test('1298 rolling is deterministic and represents coin/direct-arrow quantity correctly', async () => {
  const table = await verifiedAdapter().findForMob(100);
  const first = await rollVerified1298DropTable(table, new SeededRng(42));
  const second = await rollVerified1298DropTable(table, new SeededRng(42));
  assert.deepEqual(first, second);
  assert.equal(first[0].kind, 'coin');
  for (const reward of first) {
    if (reward.itemId === 391010000) assert.equal(reward.quantity, 20);
  }
});

test('unverified ItemProdution path is not guessed', async () => {
  const adapter = verifiedAdapter({
    monsterMappings: [{ monsterTemplateId: 100, dropTableKey: 100, moneyBase: 0 }],
    dropTables: [{
      dropTableKey: 100,
      slots: [
        { itemCode: 10, chance: 10000 },
        { itemCode: 0, chance: 0 },
        { itemCode: 0, chance: 0 },
        { itemCode: 0, chance: 0 },
        { itemCode: 0, chance: 0 }
      ]
    }],
    itemGroups: []
  });
  const table = await adapter.findForMob(100);
  await assert.rejects(
    rollVerified1298DropTable(table, { nextIntInclusive(min) { return min; } }),
    (error) => isProductionLootDomainError(error, 'VERIFIED_PRODUCTION_RESOLVER_REQUIRED')
  );
});

test('invalid generated item is rejected before ground loot creation', async () => {
  const context = makePorts({ itemExists: false });
  const service = new ProductionLootService({ ports: context.ports, idFactory: () => 'loot-invalid' });
  await assert.rejects(
    spawn(service),
    (error) => isProductionLootDomainError(error, 'INVALID_DROP_ITEM')
  );
  assert.equal(service.listLoot().length, 0);
});

test('death delivery is idempotent and no-drop outcome is persisted', async () => {
  const dropTables = directItemAdapter({ itemId: 0, chance: 0, moneyBase: 0 });
  const context = makePorts({ dropTables });
  const service = new ProductionLootService({ ports: context.ports });
  assert.deepEqual(await spawn(service), []);
  assert.deepEqual(await spawn(service, {}, 999), []);
});

test('public-after ownership requires explicit verified provenance', async () => {
  const owners = {
    async resolveOwners() { return { characterIds: ['killer'], publicAfterMs: 1000 }; },
    async canPickup() { return true; }
  };
  const context = makePorts({ owners });
  const service = new ProductionLootService({ ports: context.ports });
  await assert.rejects(
    spawn(service),
    (error) => isProductionLootDomainError(error, 'UNVERIFIED_PUBLIC_LOOT_POLICY')
  );
});

test('pickup ignores client position/zone and uses authoritative player state', async () => {
  const context = makePorts();
  const service = new ProductionLootService({ ports: context.ports, idFactory: () => 'loot-authority' });
  const [loot] = await spawn(service);
  const receipt = await service.pickup({
    lootId: loot.lootId,
    characterId: 'killer',
    requestId: 'request-authority',
    zoneId: 999,
    position: { x: 99999, z: 99999 }
  });
  assert.equal(receipt.itemId, 379016000);
  assert.equal(context.items.length, 1);
});

test('alive/world-ready/connected/same-zone gates fail closed', async () => {
  const cases = [
    [{ alive: false, worldReady: true, connected: true, zoneId: 21, position: { x: 10, z: 20 } }, 'PLAYER_NOT_ALIVE'],
    [{ alive: true, worldReady: false, connected: true, zoneId: 21, position: { x: 10, z: 20 } }, 'PLAYER_NOT_WORLD_READY'],
    [{ alive: true, worldReady: true, connected: false, zoneId: 21, position: { x: 10, z: 20 } }, 'PLAYER_DISCONNECTED'],
    [{ alive: true, worldReady: true, connected: true, zoneId: 22, position: { x: 10, z: 20 } }, 'PICKUP_ZONE_MISMATCH']
  ];

  for (const [state, code] of cases) {
    const context = makePorts({ playerStates: [state] });
    const service = new ProductionLootService({ ports: context.ports, idFactory: () => `loot-${code}` });
    const [loot] = await spawn(service);
    await assert.rejects(
      service.pickup({ lootId: loot.lootId, characterId: 'killer', requestId: `request-${code}` }),
      (error) => isProductionLootDomainError(error, code)
    );
  }
});

test('distance and inventory-capacity failures do not consume loot', async () => {
  for (const [options, code] of [
    [{ distance: false }, 'LOOT_OUT_OF_RANGE'],
    [{ capacity: false }, 'INVENTORY_CAPACITY']
  ]) {
    const context = makePorts(options);
    const service = new ProductionLootService({ ports: context.ports, idFactory: () => `loot-${code}` });
    const [loot] = await spawn(service);
    await assert.rejects(
      service.pickup({ lootId: loot.lootId, characterId: 'killer', requestId: `request-${code}` }),
      (error) => isProductionLootDomainError(error, code)
    );
    assert.equal(service.getLoot(loot.lootId).state, 'available');
  }
});

test('disconnect between pre-check and transaction re-check aborts claim', async () => {
  const ready = { alive: true, worldReady: true, connected: true, zoneId: 21, position: { x: 10, z: 20 } };
  const disconnected = { ...ready, connected: false };
  const context = makePorts({ playerStates: [ready, disconnected] });
  const service = new ProductionLootService({ ports: context.ports, idFactory: () => 'loot-disconnect' });
  const [loot] = await spawn(service);
  await assert.rejects(
    service.pickup({ lootId: loot.lootId, characterId: 'killer', requestId: 'request-disconnect' }),
    (error) => isProductionLootDomainError(error, 'PLAYER_DISCONNECTED')
  );
  assert.equal(context.items.length, 0);
  assert.equal(service.getLoot(loot.lootId).state, 'available');
});

test('item pickup commits serial, claimed tombstone, replay and audit', async () => {
  const context = makePorts();
  const service = new ProductionLootService({ ports: context.ports, idFactory: () => 'loot-item' });
  const [loot] = await spawn(service);
  const receipt = await service.pickup({ lootId: loot.lootId, characterId: 'killer', requestId: 'request-item' });
  assert.equal(receipt.serial, 'serial-1');
  assert.equal(context.serialGuard.stateOf('serial-1'), 'committed');
  assert.equal(context.replay.stateOf('killer:request-item'), 'committed');
  assert.equal(context.store.claimOf('loot-item').transactionId, 'loot-claim:loot-item');
  assert.equal(service.getClaim('loot-item').claimed, true);
  assert.equal(service.getLoot('loot-item'), null);
  assert.ok(context.audits.some((event) => event.type === 'loot.claim'));
});

test('coin grant shares stable atomic claim transaction', async () => {
  const dropTables = directItemAdapter({ itemId: 0, chance: 0, moneyBase: 100 });
  const transactionIds = [];
  const transactionPort = {
    async run(meta, fn) {
      transactionIds.push(meta.transactionId);
      return fn({ transactionId: meta.transactionId });
    }
  };
  const context = makePorts({ dropTables, transactionPort });
  const service = new ProductionLootService({ ports: context.ports, idFactory: () => 'loot-coin' });
  const [loot] = await spawn(service);
  const receipt = await service.pickup({ lootId: loot.lootId, characterId: 'killer', requestId: 'request-coin' });
  assert.equal(receipt.kind, 'coin');
  assert.equal(context.coins.length, 1);
  assert.ok(transactionIds.includes('loot-claim:loot-coin'));
});

test('same request replay cannot grant twice', async () => {
  const context = makePorts();
  const service = new ProductionLootService({ ports: context.ports, idFactory: () => 'loot-replay' });
  const [loot] = await spawn(service);
  const request = { lootId: loot.lootId, characterId: 'killer', requestId: 'same-request' };
  await service.pickup(request);
  await assert.rejects(
    service.pickup(request),
    (error) => isProductionLootDomainError(error, 'PICKUP_REPLAY')
  );
  assert.equal(context.items.length, 1);
});

test('two simultaneous claimants cannot claim one ground loot', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const owners = {
    async resolveOwners() { return { characterIds: ['killer', 'party-2'], publicAfterMs: null }; },
    async canPickup({ loot, characterId }) { return loot.ownerCharacterIds.includes(characterId); }
  };
  const context = makePorts({ owners, itemGrant: async () => gate });
  const service = new ProductionLootService({ ports: context.ports, idFactory: () => 'loot-race' });
  const [loot] = await spawn(service);

  const first = service.pickup({ lootId: loot.lootId, characterId: 'killer', requestId: 'race-a' });
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(
    service.pickup({ lootId: loot.lootId, characterId: 'party-2', requestId: 'race-b' }),
    (error) => isProductionLootDomainError(error, 'LOOT_BUSY')
  );
  release();
  await first;
  assert.equal(context.items.length, 1);
});

test('grant/transaction failure releases transient locks and restores ground loot', async () => {
  let failOnce = true;
  const context = makePorts({
    itemGrant: async () => {
      if (failOnce) {
        failOnce = false;
        throw new Error('inventory transaction failed');
      }
    }
  });
  const service = new ProductionLootService({ ports: context.ports, idFactory: () => 'loot-retry' });
  const [loot] = await spawn(service);
  await assert.rejects(
    service.pickup({ lootId: loot.lootId, characterId: 'killer', requestId: 'retry-1' }),
    /inventory transaction failed/
  );
  assert.equal(context.serialGuard.stateOf('serial-1'), null);
  assert.equal(context.replay.stateOf('killer:retry-1'), null);
  assert.equal(service.getLoot(loot.lootId).state, 'available');
});

test('expired loot is durably despawned before removal', async () => {
  let now = 1000;
  const context = makePorts();
  const service = new ProductionLootService({
    ports: context.ports,
    clock: () => now,
    lootLifetimeMs: 10,
    idFactory: () => 'loot-expired'
  });
  await spawn(service);
  now = 1010;
  assert.deepEqual(await service.sweepExpired(), ['loot-expired']);
  assert.equal(context.store.wasDespawned('loot-expired'), true);
  assert.equal(service.getLoot('loot-expired'), null);
});

test('5000 deterministic death/drop/pickup simulations conserve every reward exactly once', async () => {
  const dropTables = verifiedAdapter({
    monsterMappings: [{ monsterTemplateId: 100, dropTableKey: 100, moneyBase: 25 }],
    dropTables: [{
      dropTableKey: 100,
      slots: [
        { itemCode: 0, chance: 0 },
        { itemCode: 0, chance: 0 },
        { itemCode: 379016000, chance: 2500 },
        { itemCode: 0, chance: 0 },
        { itemCode: 391010000, chance: 2500 }
      ]
    }],
    itemGroups: []
  });
  let serial = 0;
  let lootId = 0;
  const context = makePorts({
    dropTables,
    serialFactory: () => `soak-serial-${++serial}`
  });
  const service = new ProductionLootService({
    ports: context.ports,
    idFactory: () => `soak-loot-${++lootId}`
  });

  let spawned = 0;
  let claimed = 0;
  for (let index = 0; index < 5000; index += 1) {
    const records = await spawn(service, {
      eventId: `soak-death-${index}`,
      mobInstanceId: `soak-mob-${index}`
    }, index + 1);
    spawned += records.length;
    for (const loot of records) {
      await service.pickup({
        lootId: loot.lootId,
        characterId: 'killer',
        requestId: `soak-request-${index}-${loot.lootId}`
      });
      claimed += 1;
    }
  }

  assert.equal(claimed, spawned);
  assert.equal(service.listLoot().length, 0);
  assert.equal(context.items.length + context.coins.length, spawned);
});

test('2000 deterministic malformed-probability fuzz cases are rejected', () => {
  const rng = new SeededRng(0x26c0ffee);
  for (let index = 0; index < 2000; index += 1) {
    const invalidChance = rng.nextIntInclusive(0, 1) === 0
      ? -rng.nextIntInclusive(1, 50000)
      : 10000 + rng.nextIntInclusive(1, 50000);
    assert.throws(
      () => verifiedAdapter({
        dropTables: [{
          dropTableKey: 100,
          slots: [
            { itemCode: 0, chance: 0 },
            { itemCode: 0, chance: 0 },
            { itemCode: 379016000, chance: invalidChance },
            { itemCode: 0, chance: 0 },
            { itemCode: 0, chance: 0 }
          ]
        }]
      }),
      (error) => isProductionLootDomainError(error, 'INVALID_1298_DROP_DATA')
    );
  }
});
