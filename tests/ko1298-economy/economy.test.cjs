'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EconomyError } = require('../../services/ko1298-economy/src/index.cjs');
const { createFixture } = require('./fixture.cjs');

async function expectCode(promise, code) {
  await assert.rejects(promise, (error) => error instanceof EconomyError && error.code === code);
}

test('NPC buy uses canonical merchant price and atomically debits coin + credits item', async () => {
  const f = createFixture();
  f.addMerchant('npc-1');
  f.setOffer('npc-1', '1001', { npcSellPrice: 125, npcBuyPrice: 25 });
  f.setBalance('alice', 1000);

  const result = await f.service.buyFromNpc({ playerId: 'alice', npcId: 'npc-1', itemTemplateId: '1001', quantity: 2 });

  assert.equal(result.total, 250n);
  assert.equal(f.getBalance('alice'), 750n);
  assert.equal(f.getInventory('alice').length, 1);
  assert.equal(f.getInventory('alice')[0].quantity, 2);
});

test('NPC buy rejects insufficient coin without inventory mutation', async () => {
  const f = createFixture();
  f.addMerchant('npc-1');
  f.setOffer('npc-1', '1001', { npcSellPrice: 600, npcBuyPrice: 10 });
  f.setBalance('alice', 500);

  await expectCode(f.service.buyFromNpc({ playerId: 'alice', npcId: 'npc-1', itemTemplateId: '1001', quantity: 1 }), 'INSUFFICIENT_COINS');
  assert.equal(f.getBalance('alice'), 500n);
  assert.deepEqual(f.getInventory('alice'), []);
});

test('NPC buy capacity rejection leaves coin unchanged', async () => {
  const f = createFixture();
  f.addMerchant('npc-1');
  f.setOffer('npc-1', '1001', { npcSellPrice: 100, npcBuyPrice: 10 });
  f.setBalance('alice', 500);
  f.setCapacity('alice', 0);

  await expectCode(f.service.buyFromNpc({ playerId: 'alice', npcId: 'npc-1', itemTemplateId: '1001', quantity: 1 }), 'INVENTORY_CAPACITY');
  assert.equal(f.getBalance('alice'), 500n);
});

test('NPC buy rolls back coin debit when inventory credit throws', async () => {
  const f = createFixture();
  f.addMerchant('npc-1');
  f.setOffer('npc-1', '1001', { npcSellPrice: 100, npcBuyPrice: 10 });
  f.setBalance('alice', 500);
  f.injectNpcCreditFailure();

  await assert.rejects(f.service.buyFromNpc({ playerId: 'alice', npcId: 'npc-1', itemTemplateId: '1001', quantity: 1 }), /injected/);
  assert.equal(f.getBalance('alice'), 500n);
  assert.deepEqual(f.getInventory('alice'), []);
});

test('NPC sell validates ownership/serial and applies canonical price', async () => {
  const f = createFixture();
  f.addMerchant('npc-1');
  f.setOffer('npc-1', '2001', { npcSellPrice: 500, npcBuyPrice: 75 });
  f.setBalance('alice', 100);
  f.addItem('alice', { serial: 'serial-1', templateId: '2001', quantity: 2 });

  const result = await f.service.sellToNpc({ playerId: 'alice', npcId: 'npc-1', itemSerial: 'serial-1', quantity: 1 });
  assert.equal(result.total, 75n);
  assert.equal(f.getBalance('alice'), 175n);
  assert.equal(f.getInventory('alice')[0].quantity, 1);
});

test('NPC sell rejects duplicate serial and does not create coins', async () => {
  const f = createFixture();
  f.addMerchant('npc-1');
  f.setOffer('npc-1', '2001', { npcSellPrice: 500, npcBuyPrice: 75 });
  f.setBalance('alice', 100);
  f.addItem('alice', { serial: 'dup', templateId: '2001' });
  f.addItem('bob', { serial: 'dup', templateId: '2001' });

  await expectCode(f.service.sellToNpc({ playerId: 'alice', npcId: 'npc-1', itemSerial: 'dup', quantity: 1 }), 'INVALID_ITEM_SERIAL');
  assert.equal(f.getBalance('alice'), 100n);
  assert.equal(f.getInventory('alice').length, 1);
});

test('NPC sell rejects coin overflow before removing item', async () => {
  const f = createFixture({ maxCoins: 1000n });
  f.addMerchant('npc-1');
  f.setOffer('npc-1', '2001', { npcSellPrice: 500, npcBuyPrice: 100 });
  f.setBalance('alice', 950);
  f.addItem('alice', { serial: 'serial-1', templateId: '2001' });

  await expectCode(f.service.sellToNpc({ playerId: 'alice', npcId: 'npc-1', itemSerial: 'serial-1', quantity: 1 }), 'COIN_OVERFLOW');
  assert.equal(f.getBalance('alice'), 950n);
  assert.equal(f.getInventory('alice').length, 1);
});

test('negative and overflowing trade coin staging are rejected', async () => {
  const f = createFixture({ maxCoins: 1000n });
  f.setBalance('alice', 1000);
  f.setBalance('bob', 1000);
  const trade = await f.service.inviteTrade({ fromPlayerId: 'alice', toPlayerId: 'bob' });
  await f.service.acceptTrade({ tradeId: trade.id, playerId: 'bob' });

  await expectCode(f.service.stageTradeCoin({ tradeId: trade.id, playerId: 'alice', amount: -1 }), 'NEGATIVE_COIN');
  await expectCode(f.service.stageTradeCoin({ tradeId: trade.id, playerId: 'alice', amount: 1001 }), 'COIN_OVERFLOW');
});
