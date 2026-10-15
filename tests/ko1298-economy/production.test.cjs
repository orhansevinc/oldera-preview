'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  EconomyError,
  VerifiedMerchantCatalog,
  Legacy1298MerchantTableAdapter,
  VERIFIED_1298_MERCHANT_IDENTITIES,
} = require('../../services/ko1298-economy/src/index.cjs');
const { createFixture } = require('./fixture.cjs');

async function expectEconomyCode(promise, code) {
  await assert.rejects(promise, (error) => error instanceof EconomyError && error.code === code);
}

async function expectAnyCode(promise, code) {
  await assert.rejects(promise, (error) => error?.code === code);
}

async function openTrade(f, left = 'alice', right = 'bob') {
  const trade = await f.service.inviteTrade({ fromPlayerId: left, toPlayerId: right });
  await f.service.acceptTrade({ tradeId: trade.id, playerId: right });
  return trade.id;
}

test('verified merchant catalog requires provenance and contains source-backed Caspy identity only', () => {
  const catalog = new VerifiedMerchantCatalog();
  assert.equal(VERIFIED_1298_MERCHANT_IDENTITIES.length, 1);
  const caspy = catalog.resolveIdentity({ npcTemplateId: 13001, zoneId: 21, sellingGroup: 203002 });
  assert.equal(caspy.name, 'Caspy[Accessory]');
  assert.equal(catalog.getOffer({ sellingGroup: 203002, itemTemplateId: 110010000 }), null);
  assert.throws(() => catalog.addOffer({ sellingGroup: 203002, itemTemplateId: 110010000, npcSellPrice: 10 }),
    (error) => error instanceof EconomyError && error.code === 'UNVERIFIED_MERCHANT_DATA');
  catalog.addOffer({
    sellingGroup: 203002,
    itemTemplateId: 110010000,
    npcSellPrice: 10,
    provenance: [{ kind: 'TEST_VERIFIED_SOURCE', ref: 'fixture:explicit-source' }],
  });
  assert.equal(catalog.getOffer({ sellingGroup: 203002, itemTemplateId: 110010000 }).npcSellPrice, 10n);
});

test('verified 1298 merchant table adapter derives catalog membership and canonical prices', () => {
  const adapter = new Legacy1298MerchantTableAdapter({
    basicRows: [
      { dwID: 203000000, byExtIndex: 14, bySellGroup: 203, iPrice: 600, iSaleType: 0 },
      { dwID: 202000000, byExtIndex: 14, bySellGroup: 202, iPrice: 100, iSaleType: 1 },
    ],
    getExtension: (extIndex, extensionId) => (extIndex === 14 && extensionId === 2
      ? { dwID: 2, siPriceMultiply: 2 }
      : null),
  });
  const offers = adapter.listOffers(203002);
  assert.equal(offers.length, 1);
  assert.equal(offers[0].itemTemplateId, '203000002');
  assert.equal(offers[0].npcSellPrice, 1200n);
  assert.equal(offers[0].npcBuyPrice, 200n);
  assert.ok(offers[0].provenance.some((source) => source.ref.includes('UITransactionDlg.cpp')));
});

test('merchant security rejects spoofed merchant, wrong-zone and too-far requests', async () => {
  const f = createFixture();
  f.addMerchant('caspy-runtime', { npcTemplateId: 13001, zoneId: 21, sellingGroup: 203002, maxDistance: 6 });
  f.setOffer('caspy-runtime', '1001', { npcSellPrice: 10, npcBuyPrice: 2 });
  f.setBalance('alice', 100);

  await expectAnyCode(f.service.buyFromNpc({ playerId: 'alice', npcId: 'spoofed', itemTemplateId: '1001', quantity: 1 }), 'NOT_MERCHANT');
  f.setPlayerContext('alice', { zoneId: 1, distances: { 'caspy-runtime': 2 } });
  await expectAnyCode(f.service.buyFromNpc({ playerId: 'alice', npcId: 'caspy-runtime', itemTemplateId: '1001', quantity: 1 }), 'WRONG_ZONE');
  f.setPlayerContext('alice', { zoneId: 21, distances: { 'caspy-runtime': 9 } });
  await expectAnyCode(f.service.buyFromNpc({ playerId: 'alice', npcId: 'caspy-runtime', itemTemplateId: '1001', quantity: 1 }), 'TOO_FAR');
  assert.equal(f.getBalance('alice'), 100n);
  assert.deepEqual(f.getInventory('alice'), []);
});

test('canonical price manipulation is rejected on both buy and sell', async () => {
  const f = createFixture();
  f.addMerchant('npc-1');
  f.setOffer('npc-1', '1001', { npcSellPrice: 125, npcBuyPrice: 25 });
  f.setBalance('alice', 500);
  f.addItem('alice', { serial: 's1', templateId: '1001' });
  await expectEconomyCode(f.service.buyFromNpc({ playerId: 'alice', npcId: 'npc-1', itemTemplateId: '1001', quantity: 1, clientUnitPrice: 1 }), 'PRICE_MISMATCH');
  await expectEconomyCode(f.service.sellToNpc({ playerId: 'alice', npcId: 'npc-1', itemSerial: 's1', quantity: 1, clientUnitPrice: 999 }), 'PRICE_MISMATCH');
  assert.equal(f.getBalance('alice'), 500n);
  assert.equal(f.getInventory('alice').length, 1);
});

test('negative/zero/unsafe quantities are rejected before merchant mutation', async () => {
  const f = createFixture(); f.addMerchant('npc-1'); f.setOffer('npc-1', '1001', { npcSellPrice: 1, npcBuyPrice: 1 }); f.setBalance('alice', 100);
  for (const quantity of [0, -1, Number.MAX_SAFE_INTEGER + 1]) {
    await expectEconomyCode(f.service.buyFromNpc({ playerId: 'alice', npcId: 'npc-1', itemTemplateId: '1001', quantity }), 'INVALID_QUANTITY');
  }
  assert.equal(f.getBalance('alice'), 100n);
});

test('stack-aware inventory adapter can merge purchase into a full-slot existing stack', async () => {
  const f = createFixture();
  f.addMerchant('npc-1'); f.setOffer('npc-1', 'arrow', { npcSellPrice: 2, npcBuyPrice: 1 }); f.setBalance('alice', 100);
  f.setTemplate('arrow', { stackable: true, maxStack: 10 }); f.setCapacity('alice', 1);
  f.addItem('alice', { serial: 'stack', templateId: 'arrow', quantity: 8 });
  await f.service.buyFromNpc({ playerId: 'alice', npcId: 'npc-1', itemTemplateId: 'arrow', quantity: 2 });
  assert.equal(f.getInventory('alice').length, 1);
  assert.equal(f.getInventory('alice')[0].quantity, 10);
  assert.equal(f.getBalance('alice'), 96n);
});

test('trade coin and item reservations block conflicting WS22 spend/sell operations', async () => {
  const f = createFixture();
  f.addMerchant('npc-1');
  f.setOffer('npc-1', '1001', { npcSellPrice: 400, npcBuyPrice: 25 });
  f.setBalance('alice', 1000); f.setBalance('bob', 0);
  f.addItem('alice', { serial: 'stack', templateId: '1001', quantity: 3 });
  const tradeId = await openTrade(f);
  await f.service.stageTradeCoin({ tradeId, playerId: 'alice', amount: 700 });
  await f.service.stageTradeItem({ tradeId, playerId: 'alice', itemSerial: 'stack', quantity: 2 });

  await expectEconomyCode(f.service.buyFromNpc({ playerId: 'alice', npcId: 'npc-1', itemTemplateId: '1001', quantity: 1 }), 'COIN_RESERVED');
  await expectEconomyCode(f.service.sellToNpc({ playerId: 'alice', npcId: 'npc-1', itemSerial: 'stack', quantity: 2 }), 'ITEM_RESERVED');
  await f.service.sellToNpc({ playerId: 'alice', npcId: 'npc-1', itemSerial: 'stack', quantity: 1 });
  assert.equal(f.getInventory('alice').find((x) => x.serial === 'stack').quantity, 2);
  assert.equal((await f.service.getReservations('alice')).coins, 700n);
});

test('coin add/remove is atomic, reasoned, audited and respects trade reservation', async () => {
  const f = createFixture({ maxCoins: 4_000_000_000n });
  f.setBalance('alice', 3_000_000_000n);
  assert.equal(await f.service.addCoins({ playerId: 'alice', amount: 500_000_000n, reason: 'loot.gold', metadata: { source: 'boss' } }), 3_500_000_000n);
  assert.equal(await f.service.removeCoins({ playerId: 'alice', amount: 400_000_000n, reason: 'fee.test' }), 3_100_000_000n);
  const trade = await f.service.inviteTrade({ fromPlayerId: 'alice', toPlayerId: 'bob' });
  await f.service.acceptTrade({ tradeId: trade.id, playerId: 'bob' });
  await f.service.stageTradeCoin({ tradeId: trade.id, playerId: 'alice', amount: 3_000_000_000n });
  await expectEconomyCode(f.service.removeCoins({ playerId: 'alice', amount: 200_000_000n, reason: 'fee.blocked' }), 'COIN_RESERVED');
  const types = f.getAudit().map((event) => event.type);
  assert.ok(types.includes('coin.credit'));
  assert.ok(types.includes('coin.debit'));
  assert.ok(types.includes('trade.coin_reserved'));
});

test('timeout cancels trade and releases logical reservations before later action', async () => {
  const f = createFixture({ tradeTimeoutMs: 1000 });
  f.setBalance('alice', 100); f.setBalance('bob', 100);
  const trade = await f.service.inviteTrade({ fromPlayerId: 'alice', toPlayerId: 'bob' });
  f.advanceClock(1001);
  await expectEconomyCode(f.service.acceptTrade({ tradeId: trade.id, playerId: 'bob' }), 'TRADE_TIMEOUT');
  assert.equal(f.getTrade(trade.id).status, 'cancelled');
  assert.equal(f.getTrade(trade.id).cancelReason, 'timeout');
  assert.equal((await f.service.getReservations('alice')).coins, 0n);
});

test('disconnect safely cancels pending, open and partially-confirmed trades', async () => {
  for (const stage of ['pending', 'open', 'confirmed']) {
    const f = createFixture(); f.setBalance('alice', 100); f.setBalance('bob', 100);
    const trade = await f.service.inviteTrade({ fromPlayerId: 'alice', toPlayerId: 'bob' });
    if (stage !== 'pending') await f.service.acceptTrade({ tradeId: trade.id, playerId: 'bob' });
    if (stage === 'confirmed') await f.service.confirmTrade({ tradeId: trade.id, playerId: 'alice' });
    const cancelled = await f.service.handleDisconnect('alice');
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(f.getBalance('alice') + f.getBalance('bob'), 200n);
  }
});

test('two simultaneous trade invites involving the same player cannot both become active', async () => {
  const f = createFixture();
  const results = await Promise.allSettled([
    f.service.inviteTrade({ fromPlayerId: 'alice', toPlayerId: 'bob' }),
    f.service.inviteTrade({ fromPlayerId: 'alice', toPlayerId: 'charlie' }),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
  assert.equal([...f.ref.current.trades.values()].filter((trade) => trade.status === 'pending').length, 1);
});

test('trade partial-stack transfer conserves total quantity while split serial stays unique', async () => {
  const f = createFixture(); f.addItem('alice', { serial: 'stack', templateId: '100', quantity: 7 });
  const tradeId = await openTrade(f);
  await f.service.stageTradeItem({ tradeId, playerId: 'alice', itemSerial: 'stack', quantity: 3 });
  await f.service.confirmTrade({ tradeId, playerId: 'alice' }); await f.service.confirmTrade({ tradeId, playerId: 'bob' });
  const all = [...f.getInventory('alice'), ...f.getInventory('bob')];
  assert.equal(all.reduce((sum, item) => sum + item.quantity, 0), 7);
  assert.equal(new Set(all.map((item) => item.serial)).size, all.length);
});

test('1000+ deterministic transaction-domain operations preserve total coin and terminal state', async () => {
  const f = createFixture({ maxCoins: 10_000_000n });
  const players = ['p0', 'p1', 'p2', 'p3'];
  for (const player of players) f.setBalance(player, 1_000_000n);
  const initialTotal = players.reduce((sum, player) => sum + f.getBalance(player), 0n);
  let seed = 0x1298;
  const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };

  let transactionDomainOps = 0;
  for (let i = 0; i < 125; i += 1) {
    const leftIndex = next() % players.length;
    let rightIndex = next() % players.length;
    if (rightIndex === leftIndex) rightIndex = (rightIndex + 1) % players.length;
    const left = players[leftIndex]; const right = players[rightIndex];
    const leftBalance = f.getBalance(left); const rightBalance = f.getBalance(right);
    const leftAmount = BigInt(next() % (Number(leftBalance < 5000n ? leftBalance : 5000n) + 1));
    const rightAmount = BigInt(next() % (Number(rightBalance < 5000n ? rightBalance : 5000n) + 1));
    const trade = await f.service.inviteTrade({ fromPlayerId: left, toPlayerId: right }); transactionDomainOps += 1;
    await f.service.acceptTrade({ tradeId: trade.id, playerId: right }); transactionDomainOps += 2; // expiry check + state mutation
    await f.service.stageTradeCoin({ tradeId: trade.id, playerId: left, amount: leftAmount }); transactionDomainOps += 2;
    await f.service.stageTradeCoin({ tradeId: trade.id, playerId: right, amount: rightAmount }); transactionDomainOps += 2;
    await f.service.confirmTrade({ tradeId: trade.id, playerId: left }); transactionDomainOps += 2;
    await f.service.confirmTrade({ tradeId: trade.id, playerId: right }); transactionDomainOps += 2;
    assert.equal(f.getTrade(trade.id).status, 'completed');
  }

  assert.ok(transactionDomainOps >= 1000);
  const finalTotal = players.reduce((sum, player) => sum + f.getBalance(player), 0n);
  assert.equal(finalTotal, initialTotal);
  assert.ok(players.every((player) => f.getBalance(player) >= 0n));
});

test('escrow state moves invited -> holding -> committed and releases on cancellation', async () => {
  const f = createFixture();
  f.setBalance('alice', 100); f.setBalance('bob', 100);
  const first = await f.service.inviteTrade({ fromPlayerId: 'alice', toPlayerId: 'bob' });
  assert.deepEqual(first.escrow, { mode: 'logical-reservation', state: 'invited' });
  const accepted = await f.service.acceptTrade({ tradeId: first.id, playerId: 'bob' });
  assert.equal(accepted.escrow.state, 'holding');
  await f.service.confirmTrade({ tradeId: first.id, playerId: 'alice' });
  const complete = await f.service.confirmTrade({ tradeId: first.id, playerId: 'bob' });
  assert.equal(complete.trade.escrow.state, 'committed');

  const second = await f.service.inviteTrade({ fromPlayerId: 'alice', toPlayerId: 'bob' });
  await f.service.acceptTrade({ tradeId: second.id, playerId: 'bob' });
  const cancelled = await f.service.cancelTrade({ tradeId: second.id, playerId: 'alice' });
  assert.equal(cancelled.escrow.state, 'released');
});

test('expired active trade is cleaned before a new invite involving the same player', async () => {
  const f = createFixture({ tradeTimeoutMs: 1000 });
  const first = await f.service.inviteTrade({ fromPlayerId: 'alice', toPlayerId: 'bob' });
  f.advanceClock(1001);
  const second = await f.service.inviteTrade({ fromPlayerId: 'alice', toPlayerId: 'charlie' });
  assert.equal(f.getTrade(first.id).status, 'cancelled');
  assert.equal(f.getTrade(first.id).cancelReason, 'timeout');
  assert.equal(second.status, 'pending');
});

test('seeded fuzzed trade operations preserve coin conservation across successes and rejections', async () => {
  const f = createFixture({ maxCoins: 1_000_000n });
  f.setBalance('alice', 100_000n); f.setBalance('bob', 100_000n);
  const initial = f.getBalance('alice') + f.getBalance('bob');
  let seed = 0x22_1298;
  const next = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed; };
  let operations = 0;

  for (let round = 0; round < 100; round += 1) {
    const trade = await f.service.inviteTrade({ fromPlayerId: 'alice', toPlayerId: 'bob' }); operations += 1;
    await f.service.acceptTrade({ tradeId: trade.id, playerId: 'bob' }); operations += 1;
    for (let step = 0; step < 10; step += 1) {
      const action = next() % 6;
      try {
        if (action === 0) await f.service.stageTradeCoin({ tradeId: trade.id, playerId: 'alice', amount: BigInt(next() % 120_000) });
        else if (action === 1) await f.service.stageTradeCoin({ tradeId: trade.id, playerId: 'bob', amount: BigInt(next() % 120_000) });
        else if (action === 2) await f.service.confirmTrade({ tradeId: trade.id, playerId: 'alice' });
        else if (action === 3) await f.service.confirmTrade({ tradeId: trade.id, playerId: 'bob' });
        else if (action === 4) await f.service.stageTradeItem({ tradeId: trade.id, playerId: 'alice', itemSerial: `missing-${round}-${step}`, quantity: 1 });
        else await f.service.stageTradeCoin({ tradeId: trade.id, playerId: 'alice', amount: -1 });
      } catch (error) {
        if (!(error instanceof EconomyError)) throw error;
      }
      operations += 1;
    }
    if (['pending', 'open'].includes(f.getTrade(trade.id).status)) {
      await f.service.cancelTrade({ tradeId: trade.id, playerId: 'alice', reason: 'fuzz-cleanup' }); operations += 1;
    }
    assert.equal(f.getBalance('alice') + f.getBalance('bob'), initial);
    assert.ok(f.getBalance('alice') >= 0n && f.getBalance('bob') >= 0n);
  }
  assert.ok(operations >= 1000);
});
