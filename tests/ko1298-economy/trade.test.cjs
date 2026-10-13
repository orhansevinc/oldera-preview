'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EconomyError } = require('../../services/ko1298-economy/src/index.cjs');
const { createFixture } = require('./fixture.cjs');

async function expectCode(promise, code) {
  await assert.rejects(promise, (error) => error instanceof EconomyError && error.code === code);
}

async function openTrade(f) {
  const trade = await f.service.inviteTrade({ fromPlayerId: 'alice', toPlayerId: 'bob' });
  await f.service.acceptTrade({ tradeId: trade.id, playerId: 'bob' });
  return trade.id;
}

test('invite can be rejected and no player can have two active trades', async () => {
  const f = createFixture();
  const trade = await f.service.inviteTrade({ fromPlayerId: 'alice', toPlayerId: 'bob' });
  await expectCode(f.service.inviteTrade({ fromPlayerId: 'alice', toPlayerId: 'charlie' }), 'PLAYER_ALREADY_TRADING');
  const rejected = await f.service.rejectTrade({ tradeId: trade.id, playerId: 'bob' });
  assert.equal(rejected.status, 'rejected');
  const next = await f.service.inviteTrade({ fromPlayerId: 'alice', toPlayerId: 'charlie' });
  assert.equal(next.status, 'pending');
});

test('changing staged offer clears both final confirmations', async () => {
  const f = createFixture();
  f.setBalance('alice', 500);
  f.setBalance('bob', 500);
  const tradeId = await openTrade(f);
  await f.service.stageTradeCoin({ tradeId, playerId: 'alice', amount: 100 });
  await f.service.confirmTrade({ tradeId, playerId: 'alice' });
  assert.equal(f.getTrade(tradeId).confirmations.alice, true);

  await f.service.stageTradeCoin({ tradeId, playerId: 'bob', amount: 50 });
  assert.deepEqual(f.getTrade(tradeId).confirmations, { alice: false, bob: false });
});

test('two-party final confirmation transfers staged coins and items exactly once', async () => {
  const f = createFixture();
  f.setBalance('alice', 1000);
  f.setBalance('bob', 500);
  f.addItem('alice', { serial: 'a-item', templateId: '100' });
  f.addItem('bob', { serial: 'b-item', templateId: '200' });
  const tradeId = await openTrade(f);

  await f.service.stageTradeItem({ tradeId, playerId: 'alice', itemSerial: 'a-item', quantity: 1 });
  await f.service.stageTradeItem({ tradeId, playerId: 'bob', itemSerial: 'b-item', quantity: 1 });
  await f.service.stageTradeCoin({ tradeId, playerId: 'alice', amount: 300 });
  await f.service.stageTradeCoin({ tradeId, playerId: 'bob', amount: 50 });

  const first = await f.service.confirmTrade({ tradeId, playerId: 'alice' });
  assert.equal(first.completed, false);
  const second = await f.service.confirmTrade({ tradeId, playerId: 'bob' });
  assert.equal(second.completed, true);

  assert.equal(f.getBalance('alice'), 750n);
  assert.equal(f.getBalance('bob'), 750n);
  assert.deepEqual(f.getInventory('alice').map((x) => x.serial), ['b-item']);
  assert.deepEqual(f.getInventory('bob').map((x) => x.serial), ['a-item']);
  assert.equal(f.getTrade(tradeId).status, 'completed');
  await expectCode(f.service.confirmTrade({ tradeId, playerId: 'alice' }), 'TRADE_NOT_OPEN');
});

test('disconnect cancels staged trade without moving coins or items', async () => {
  const f = createFixture();
  f.setBalance('alice', 1000);
  f.setBalance('bob', 500);
  f.addItem('alice', { serial: 'a-item', templateId: '100' });
  const tradeId = await openTrade(f);
  await f.service.stageTradeCoin({ tradeId, playerId: 'alice', amount: 300 });
  await f.service.stageTradeItem({ tradeId, playerId: 'alice', itemSerial: 'a-item', quantity: 1 });

  const cancelled = await f.service.handleDisconnect('bob');
  assert.equal(cancelled.status, 'cancelled');
  assert.match(cancelled.cancelReason, /^disconnect:/);
  assert.equal(f.getBalance('alice'), 1000n);
  assert.equal(f.getBalance('bob'), 500n);
  assert.deepEqual(f.getInventory('alice').map((x) => x.serial), ['a-item']);
});

test('duplicate serial is rejected while staging', async () => {
  const f = createFixture();
  f.addItem('alice', { serial: 'dup', templateId: '100' });
  f.addItem('bob', { serial: 'dup', templateId: '200' });
  const tradeId = await openTrade(f);

  await expectCode(f.service.stageTradeItem({ tradeId, playerId: 'alice', itemSerial: 'dup', quantity: 1 }), 'INVALID_ITEM_SERIAL');
});

test('finalization revalidates current coin balance and rolls back all economic mutations', async () => {
  const f = createFixture();
  f.setBalance('alice', 500);
  f.setBalance('bob', 500);
  f.addItem('alice', { serial: 'a-item', templateId: '100' });
  const tradeId = await openTrade(f);
  await f.service.stageTradeCoin({ tradeId, playerId: 'alice', amount: 400 });
  await f.service.stageTradeItem({ tradeId, playerId: 'alice', itemSerial: 'a-item', quantity: 1 });
  await f.service.confirmTrade({ tradeId, playerId: 'alice' });

  f.setBalance('alice', 100); // simulates another committed economy operation before Bob confirms
  await expectCode(f.service.confirmTrade({ tradeId, playerId: 'bob' }), 'INSUFFICIENT_COINS');

  assert.equal(f.getBalance('alice'), 100n);
  assert.equal(f.getBalance('bob'), 500n);
  assert.deepEqual(f.getInventory('alice').map((x) => x.serial), ['a-item']);
  assert.equal(f.getTrade(tradeId).status, 'open');
  assert.equal(f.getTrade(tradeId).confirmations.bob, false); // Bob confirmation rolled back
});

test('inventory transfer failure rolls back both items, both balances and completion state', async () => {
  const f = createFixture();
  f.setBalance('alice', 500);
  f.setBalance('bob', 500);
  f.addItem('alice', { serial: 'a-item', templateId: '100' });
  f.addItem('bob', { serial: 'b-item', templateId: '200' });
  const tradeId = await openTrade(f);
  await f.service.stageTradeItem({ tradeId, playerId: 'alice', itemSerial: 'a-item', quantity: 1 });
  await f.service.stageTradeItem({ tradeId, playerId: 'bob', itemSerial: 'b-item', quantity: 1 });
  await f.service.stageTradeCoin({ tradeId, playerId: 'alice', amount: 100 });
  await f.service.confirmTrade({ tradeId, playerId: 'alice' });
  f.injectTransferFailure();

  await assert.rejects(f.service.confirmTrade({ tradeId, playerId: 'bob' }), /injected transfer failure/);
  assert.equal(f.getBalance('alice'), 500n);
  assert.equal(f.getBalance('bob'), 500n);
  assert.deepEqual(f.getInventory('alice').map((x) => x.serial), ['a-item']);
  assert.deepEqual(f.getInventory('bob').map((x) => x.serial), ['b-item']);
  assert.equal(f.getTrade(tradeId).status, 'open');
});

test('recipient capacity failure prevents finalization without partial transfer', async () => {
  const f = createFixture();
  f.setBalance('alice', 100);
  f.setBalance('bob', 100);
  f.addItem('alice', { serial: 'a-item', templateId: '100' });
  f.addItem('bob', { serial: 'b-existing', templateId: '900' });
  f.setCapacity('bob', 1);
  const tradeId = await openTrade(f);
  await f.service.stageTradeItem({ tradeId, playerId: 'alice', itemSerial: 'a-item', quantity: 1 });
  await f.service.confirmTrade({ tradeId, playerId: 'alice' });

  await expectCode(f.service.confirmTrade({ tradeId, playerId: 'bob' }), 'INVENTORY_CAPACITY');
  assert.deepEqual(f.getInventory('alice').map((x) => x.serial), ['a-item']);
  assert.deepEqual(f.getInventory('bob').map((x) => x.serial), ['b-existing']);
});

test('concurrent second-side confirmations cannot double-apply a completed trade', async () => {
  const f = createFixture();
  f.setBalance('alice', 1000);
  f.setBalance('bob', 1000);
  const tradeId = await openTrade(f);
  await f.service.stageTradeCoin({ tradeId, playerId: 'alice', amount: 250 });
  await f.service.confirmTrade({ tradeId, playerId: 'alice' });

  const results = await Promise.allSettled([
    f.service.confirmTrade({ tradeId, playerId: 'bob' }),
    f.service.confirmTrade({ tradeId, playerId: 'bob' }),
  ]);

  assert.equal(results.filter((x) => x.status === 'fulfilled').length, 1);
  assert.equal(results.filter((x) => x.status === 'rejected').length, 1);
  assert.equal(f.getBalance('alice'), 750n);
  assert.equal(f.getBalance('bob'), 1250n);
  assert.equal(f.getTrade(tradeId).status, 'completed');
});
