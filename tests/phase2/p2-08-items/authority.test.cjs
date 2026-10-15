'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ItemEconomyAuthority, P208Error } = require('../../../services/ko1298-items-p2/authority.cjs');

function txManager() {
  const committed = new Map();
  return {
    async runOnce(meta, work) {
      const key = `${meta.kind}:${meta.operationId}`;
      if (committed.has(key)) return { replayed: true, result: committed.get(key) };
      const result = await work({ id: key });
      committed.set(key, result);
      return { replayed: false, result };
    }
  };
}
function basePorts(overrides = {}) {
  const log = [];
  return {
    log,
    transactionManager: txManager(),
    npc: { async assertInteraction(_tx, x) { log.push(['npc', x]); } },
    merchantRules: {
      async quoteBuy() { return { verified: true, source: 'fixture:verified-source', totalGold: 20n, itemTemplateId: '1001', quantity: 2 }; },
      async quoteSell() { return { verified: true, source: 'fixture:verified-source', totalGold: 7n }; }
    },
    repairRules: { async quote() { return { verified: true, source: 'fixture:verified-source', totalGold: 4n, targetDurability: 100 }; } },
    upgradeRules: { async resolveAndRoll() { return { verified: true, source: 'fixture:verified-source', coinCost: 3n, materials: [], outcome: 'success' }; } },
    items: {
      async grantTemplate(_tx, x) { log.push(['grant', x]); return { serial: '9001' }; },
      async lockOwned(_tx, x) { log.push(['lock', x]); return { serial: x.serial, itemTemplateId: '1001', durability: 50 }; },
      async removeOwned(_tx, x) { log.push(['remove', x]); },
      async setDurability(_tx, x) { log.push(['durability', x]); },
      async consumeRequirements(_tx, x) { log.push(['materials', x]); },
      async applyUpgradeOutcome(_tx, x) { log.push(['upgrade', x]); return { serial: x.serial }; },
      async moveInn(_tx, x) { log.push(['inn', x]); return x; },
      async swapTradeOffers(_tx, x) { log.push(['swap', x]); return { ok: true }; },
      async transferPlayerMerchant(_tx, x) { log.push(['merchant-transfer', x]); },
      async equip(_tx, x) { log.push(['equip', x]); return { slot: x.slot }; },
      async consumeOwned(_tx, x) { log.push(['consume', x]); }
    },
    coins: {
      async debit(_tx, id, amount) { log.push(['debit', id, amount]); },
      async credit(_tx, id, amount) { log.push(['credit', id, amount]); },
      async settleTrade() { return { ok: true }; }
    },
    loot: { async lockClaim() { return { kind: 'coin', amount: 5n }; }, async markClaimed(_tx, x) { log.push(['claimed', x]); } },
    lootOwnership: { async assertClaim() {} },
    trade: { async lockConfirmed() { return { participantIds: ['2', '1'] }; }, async markCommitted() {} },
    playerMerchant: { async lockSale() { return { verified: true, source: 'fixture:verified-source', sellerCharacterId: '2', totalGold: 9n }; }, async markCommitted() {} },
    equipmentRules: { async resolveEquip() { return { verified: true, source: 'fixture:verified-source', slot: 4, combatProjection: { attack: 1 } }; } },
    itemUseRules: { async resolveUse() { return { verified: true, source: 'fixture:verified-source', consumeQuantity: 1, effect: { hp: 1 } }; } },
    effects: { async apply(_tx, x) { return x.effect; } },
    ...overrides
  };
}

test('client-supplied price is rejected before mutation', async () => {
  const ports = basePorts();
  const authority = new ItemEconomyAuthority(ports);
  await assert.rejects(() => authority.merchantBuy({ operationId: 'op1', characterId: '1', merchantId: '13001', itemTemplateId: '1001', quantity: 2, totalPrice: 1 }),
    error => error instanceof P208Error && error.code === 'CLIENT_AUTHORITY_REJECTED');
  assert.equal(ports.log.length, 0);
});

test('merchant buy is idempotent and server quote drives money/item result', async () => {
  const ports = basePorts();
  const authority = new ItemEconomyAuthority(ports);
  const command = { operationId: 'buy-1', characterId: '1', merchantId: '13001', itemTemplateId: '1001', quantity: 2 };
  const first = await authority.merchantBuy(command);
  const second = await authority.merchantBuy(command);
  assert.equal(first.replayed, false);
  assert.equal(second.replayed, true);
  assert.equal(ports.log.filter(x => x[0] === 'debit').length, 1);
  assert.equal(ports.log.filter(x => x[0] === 'grant').length, 1);
});

test('unverified upgrade rules fail closed', async () => {
  const ports = basePorts({ upgradeRules: { async resolveAndRoll() { return { verified: false, coinCost: 0n, materials: [], outcome: 'success' }; } } });
  const authority = new ItemEconomyAuthority(ports);
  await assert.rejects(() => authority.upgrade({ operationId: 'up-1', characterId: '1', anvilId: 'anvil', serial: '9001' }),
    error => error instanceof P208Error && error.code === 'UNVERIFIED_GAME_RULE');
  assert.equal(ports.log.some(x => x[0] === 'debit'), false);
});

test('loot pickup uses loot authority and operation replay instead of client result', async () => {
  const ports = basePorts();
  const authority = new ItemEconomyAuthority(ports);
  const first = await authority.lootPickup({ lootId: 'L1', characterId: '1' });
  const second = await authority.lootPickup({ lootId: 'L1', characterId: '1' });
  assert.equal(first.replayed, false);
  assert.equal(second.replayed, true);
  assert.equal(ports.log.filter(x => x[0] === 'credit').length, 1);
  assert.equal(ports.log.filter(x => x[0] === 'claimed').length, 1);
});

test('repair performs quote, debit and durability mutation in one runOnce callback', async () => {
  const ports = basePorts();
  const authority = new ItemEconomyAuthority(ports);
  await authority.repair({ operationId: 'repair-1', characterId: '1', npcId: 'smith', serial: '9001' });
  assert.deepEqual(ports.log.map(x => x[0]), ['npc', 'lock', 'debit', 'durability']);
});
