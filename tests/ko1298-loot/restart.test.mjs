import test from 'node:test';
import assert from 'node:assert/strict';
import {
  InMemoryLootStore,
  InMemoryReplayGuard,
  InMemoryTransactionalSerialGuard,
  InlineTransactionPort,
  KillerOwnershipPolicy,
  ProductionLootService,
  Verified1298DropTableAdapter
} from '../../services/ko1298-loot/src/index.js';

const provenance = {
  classification: 'verified-1298',
  sourceRefs: ['restart-regression-fixture']
};

function dropTables() {
  return new Verified1298DropTableAdapter({
    provenance,
    monsterMappings: [{ monsterTemplateId: 100, dropTableKey: 100, moneyBase: 0 }],
    dropTables: [{
      dropTableKey: 100,
      slots: [
        { itemCode: 0, chance: 0 },
        { itemCode: 0, chance: 0 },
        { itemCode: 379016000, chance: 10000 },
        { itemCode: 0, chance: 0 },
        { itemCode: 0, chance: 0 }
      ]
    }],
    itemGroups: []
  });
}

function ports(sharedStore, grants, serialPrefix) {
  let serial = 0;
  return {
    dropTables: dropTables(),
    ownership: new KillerOwnershipPolicy(),
    playerState: {
      async getLootState() {
        return {
          alive: true,
          worldReady: true,
          connected: true,
          zoneId: 21,
          position: { x: 10, z: 20 }
        };
      }
    },
    distance: { async canPickup() { return true; } },
    itemTemplates: { async exists() { return true; } },
    inventory: { async canAccept() { return true; } },
    items: { async grant(payload) { grants.push(payload); } },
    coins: { async grant() {} },
    serials: { async createForDrop() { return `${serialPrefix}-${++serial}`; } },
    serialGuard: new InMemoryTransactionalSerialGuard(),
    transactions: new InlineTransactionPort(),
    lootStore: sharedStore,
    replay: new InMemoryReplayGuard(),
    audit: { async append() {} }
  };
}

const death = {
  eventId: 'restart-death-1',
  mobInstanceId: 'restart-mob-1',
  mobTemplateId: 100,
  killerCharacterId: 'killer',
  zoneId: 21,
  position: { x: 10, z: 20 }
};

test('claimed loot stays consumed after service restart and death redelivery', async () => {
  const store = new InMemoryLootStore();
  const grants = [];

  const first = new ProductionLootService({
    ports: ports(store, grants, 'before-restart'),
    idFactory: () => 'restart-loot-1'
  });
  const [loot] = await first.createFromMobDeath(death, { seed: 26 });
  await first.pickup({ lootId: loot.lootId, characterId: 'killer', requestId: 'pickup-before-restart' });

  assert.equal(grants.length, 1);
  assert.equal(store.claimOf(loot.lootId).claimed, true);

  const afterRestart = new ProductionLootService({
    ports: ports(store, grants, 'after-restart'),
    idFactory: () => 'must-not-be-created'
  });
  const rehydrated = await afterRestart.createFromMobDeath(death, { seed: 999999 });

  assert.deepEqual(rehydrated, []);
  assert.equal(afterRestart.listLoot().length, 0);
  assert.equal(grants.length, 1);
});
