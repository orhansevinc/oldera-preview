'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SessionOwnershipService,
  InMemoryLeaseStore,
  DUPLICATE_LOGIN_POLICY,
  LEASE_SCOPE,
  RESULT,
} = require('../../services/session-ownership');

class ManualClock {
  constructor(now = 1_000) {
    this.value = now;
  }
  now() {
    return this.value;
  }
  advance(ms) {
    this.value += ms;
  }
}

class TwoPartyCasGateStore extends InMemoryLeaseStore {
  constructor({ scope, key }) {
    super();
    this.scope = scope;
    this.key = key;
    this.waiters = [];
    this.gateOpen = false;
  }

  async compareAndSet(scope, key, expectedVersion, nextRecord) {
    if (!this.gateOpen && scope === this.scope && key === this.key && expectedVersion === null && nextRecord) {
      await new Promise((resolve) => {
        this.waiters.push(resolve);
        if (this.waiters.length === 2) {
          this.gateOpen = true;
          for (const waiter of this.waiters.splice(0)) waiter();
        }
      });
    }
    return super.compareAndSet(scope, key, expectedVersion, nextRecord);
  }
}

class CharacterCasGateStore extends InMemoryLeaseStore {
  constructor(characterId) {
    super();
    this.characterId = characterId;
    this.entered = null;
    this.release = null;
    this.enteredPromise = new Promise((resolve) => { this.entered = resolve; });
    this.releasePromise = new Promise((resolve) => { this.release = resolve; });
    this.used = false;
  }

  async compareAndSet(scope, key, expectedVersion, nextRecord) {
    if (!this.used && scope === LEASE_SCOPE.CHARACTER && key === this.characterId && expectedVersion === null && nextRecord) {
      this.used = true;
      this.entered();
      await this.releasePromise;
    }
    return super.compareAndSet(scope, key, expectedVersion, nextRecord);
  }
}

function makeService(options = {}) {
  const clock = options.clock || new ManualClock();
  const store = options.store || new InMemoryLeaseStore();
  const disconnects = [];
  const disconnectArbiter = options.disconnectArbiter || {
    requestDisconnect: async (event) => disconnects.push(event),
  };
  const service = new SessionOwnershipService({
    store,
    clock,
    leaseMs: 1_000,
    reconnectGraceMs: 250,
    disconnectArbiter,
    ...options,
  });
  return { service, store, clock, disconnects };
}

async function ownAccount(service, accountId = 'acc-1', sessionId = 's-1', serverId = 'gs-1') {
  const result = await service.acquireAccount({ accountId, sessionId, serverId });
  assert.equal(result.ok, true);
  return result;
}

test('account lease is exclusive and duplicate login is rejected by default', async () => {
  const { service } = makeService();
  await ownAccount(service);
  const duplicate = await service.acquireAccount({ accountId: 'acc-1', sessionId: 's-2', serverId: 'gs-2' });
  assert.deepEqual(duplicate.ok, false);
  assert.equal(duplicate.code, RESULT.ACCOUNT_IN_USE);
  assert.equal(duplicate.ownerSessionId, 's-1');
});

test('same session account acquisition is idempotent renewal', async () => {
  const { service, clock } = makeService();
  const first = await ownAccount(service);
  clock.advance(100);
  const second = await service.acquireAccount({ accountId: 'acc-1', sessionId: 's-1', serverId: 'gs-1' });
  assert.equal(second.ok, true);
  assert.equal(second.status, 'renewed');
  assert.equal(second.lease.generation, first.lease.generation);
  assert(second.lease.leaseUntil > first.lease.leaseUntil);
});

test('character lease requires active account ownership', async () => {
  const { service } = makeService();
  const result = await service.acquireCharacter({
    accountId: 'acc-1', characterId: 'char-1', sessionId: 's-1', serverId: 'gs-1',
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, RESULT.ACCOUNT_NOT_OWNED);
});

test('same character cannot be owned by two live sessions', async () => {
  const { service, store } = makeService();
  await ownAccount(service, 'acc-1', 's-1');
  const first = await service.acquireCharacter({
    accountId: 'acc-1', characterId: 'char-1', sessionId: 's-1', serverId: 'gs-1',
  });
  assert.equal(first.ok, true);

  // Seed a different account lease for a second authenticated session; character CAS still rejects it.
  await store.compareAndSet(LEASE_SCOPE.ACCOUNT, 'acc-2', null, {
    scope: LEASE_SCOPE.ACCOUNT,
    key: 'acc-2',
    accountId: 'acc-2',
    characterId: null,
    sessionId: 's-2',
    serverId: 'gs-2',
    state: 'active',
    generation: 1,
    acquiredAt: 1_000,
    heartbeatAt: 1_000,
    leaseUntil: 2_000,
    graceUntil: null,
    replacedSessionId: null,
  });

  const second = await service.acquireCharacter({
    accountId: 'acc-2', characterId: 'char-1', sessionId: 's-2', serverId: 'gs-2',
  });
  assert.equal(second.ok, false);
  assert.equal(second.code, RESULT.CHARACTER_IN_USE);
});

test('stale account lease is safely reclaimed after expiry', async () => {
  const { service, clock } = makeService();
  const first = await ownAccount(service);
  clock.advance(1_001);
  const second = await service.acquireAccount({ accountId: 'acc-1', sessionId: 's-2', serverId: 'gs-2' });
  assert.equal(second.ok, true);
  assert.equal(second.status, 'reclaimed-stale');
  assert.equal(second.lease.generation, first.lease.generation + 1);
  assert.equal(second.lease.sessionId, 's-2');
});

test('heartbeat extends every active lease owned by the session', async () => {
  const { service, clock } = makeService();
  await ownAccount(service);
  await service.acquireCharacter({ accountId: 'acc-1', characterId: 'char-1', sessionId: 's-1', serverId: 'gs-1' });
  clock.advance(700);
  const heartbeat = await service.heartbeat('s-1');
  assert.equal(heartbeat.renewed, 2);
  clock.advance(500);
  assert.equal((await service.getAccountOwner('acc-1')).sessionId, 's-1');
  assert.equal((await service.getCharacterOwner('char-1')).sessionId, 's-1');
});

test('crashed server sessions expire without disconnect cleanup', async () => {
  const { service, clock } = makeService();
  await ownAccount(service);
  clock.advance(1_001);
  assert.equal(await service.getAccountOwner('acc-1'), null);
  const sweep = await service.sweepExpired();
  assert.equal(sweep.removed, 1);
});

test('disconnect grace blocks takeover and can be resumed by authenticated coordinator', async () => {
  const { service, clock } = makeService();
  await ownAccount(service);
  await service.acquireCharacter({ accountId: 'acc-1', characterId: 'char-1', sessionId: 's-1', serverId: 'gs-1' });

  const disconnected = await service.disconnect('s-1', { useGrace: true });
  assert.equal(disconnected.status, 'grace');
  assert.equal(disconnected.affected, 2);

  const takeover = await service.acquireAccount({ accountId: 'acc-1', sessionId: 's-2', serverId: 'gs-2' });
  assert.equal(takeover.ok, false);
  assert.equal(takeover.code, RESULT.ACCOUNT_IN_USE);

  clock.advance(100);
  const accountResume = await service.resumeGrace({
    scope: LEASE_SCOPE.ACCOUNT,
    key: 'acc-1',
    previousSessionId: 's-1',
    newSessionId: 's-2',
    serverId: 'gs-2',
  });
  const charResume = await service.resumeGrace({
    scope: LEASE_SCOPE.CHARACTER,
    key: 'char-1',
    previousSessionId: 's-1',
    newSessionId: 's-2',
    serverId: 'gs-2',
  });
  assert.equal(accountResume.ok, true);
  assert.equal(charResume.ok, true);
  assert.equal((await service.getCharacterOwner('char-1')).sessionId, 's-2');
});

test('grace expiry allows a fresh session to claim the account', async () => {
  const { service, clock } = makeService();
  await ownAccount(service);
  await service.disconnect('s-1', { useGrace: true });
  clock.advance(251);
  const fresh = await service.acquireAccount({ accountId: 'acc-1', sessionId: 's-2', serverId: 'gs-2' });
  assert.equal(fresh.ok, true);
  assert.equal(fresh.status, 'reclaimed-stale');
});

test('disconnect is idempotent and does not extend grace on retry', async () => {
  const { service, clock } = makeService();
  await ownAccount(service);
  const first = await service.disconnect('s-1', { useGrace: true });
  const ownerAfterFirst = await service.getAccountOwner('acc-1');
  clock.advance(100);
  const second = await service.disconnect('s-1', { useGrace: true });
  const ownerAfterSecond = await service.getAccountOwner('acc-1');
  assert.equal(first.affected, 1);
  assert.equal(second.status, 'already-disconnected');
  assert.equal(ownerAfterSecond.graceUntil, ownerAfterFirst.graceUntil);
});

test('account ban revoke removes account and character ownership and requests disconnect', async () => {
  const { service, disconnects } = makeService();
  await ownAccount(service);
  await service.acquireCharacter({ accountId: 'acc-1', characterId: 'char-1', sessionId: 's-1', serverId: 'gs-1' });
  const revoked = await service.revokeAccount('acc-1', { reason: 'ACCOUNT_BANNED' });
  assert.equal(revoked.status, 'revoked');
  assert.equal(revoked.affected, 2);
  assert.equal(await service.getAccountOwner('acc-1'), null);
  assert.equal(await service.getCharacterOwner('char-1'), null);
  assert.deepEqual(disconnects, [{ sessionId: 's-1', reason: 'ACCOUNT_BANNED', accountId: 'acc-1' }]);
});

test('GM kick/revoke is idempotent', async () => {
  const { service, disconnects } = makeService();
  await ownAccount(service);
  const first = await service.revokeSession('s-1', { reason: 'GM_KICK' });
  const second = await service.revokeSession('s-1', { reason: 'GM_KICK' });
  assert.equal(first.status, 'revoked');
  assert.equal(second.status, 'already-revoked');
  assert.equal(disconnects.length, 1);
});

test('replace-old policy atomically takes account ownership then cleans displaced character leases', async () => {
  const { service, disconnects } = makeService({ duplicateLoginPolicy: DUPLICATE_LOGIN_POLICY.REPLACE_OLD });
  await ownAccount(service);
  await service.acquireCharacter({ accountId: 'acc-1', characterId: 'char-1', sessionId: 's-1', serverId: 'gs-1' });

  const replacement = await service.acquireAccount({ accountId: 'acc-1', sessionId: 's-2', serverId: 'gs-2' });
  assert.equal(replacement.ok, true);
  assert.equal(replacement.status, 'replaced');
  assert.equal(replacement.displacedSessionId, 's-1');
  assert.equal(await service.getCharacterOwner('char-1'), null);
  assert.equal((await service.getAccountOwner('acc-1')).sessionId, 's-2');
  assert.deepEqual(disconnects, [{ sessionId: 's-1', reason: 'DUPLICATE_LOGIN_REPLACED' }]);
});

test('simultaneous login race has exactly one winner under reject-new policy', async () => {
  const store = new TwoPartyCasGateStore({ scope: LEASE_SCOPE.ACCOUNT, key: 'acc-race' });
  const clock = new ManualClock();
  const { service } = makeService({ store, clock });

  const [a, b] = await Promise.all([
    service.acquireAccount({ accountId: 'acc-race', sessionId: 's-a', serverId: 'gs-a' }),
    service.acquireAccount({ accountId: 'acc-race', sessionId: 's-b', serverId: 'gs-b' }),
  ]);
  const winners = [a, b].filter((result) => result.ok);
  const losers = [a, b].filter((result) => !result.ok);
  assert.equal(winners.length, 1);
  assert.equal(losers.length, 1);
  assert.equal(losers[0].code, RESULT.ACCOUNT_IN_USE);
  const owner = await service.getAccountOwner('acc-race');
  assert.equal(owner.sessionId, winners[0].lease.sessionId);
});

test('replace-old requests disconnect even when displaced session has no character lease', async () => {
  const { service, disconnects } = makeService({ duplicateLoginPolicy: DUPLICATE_LOGIN_POLICY.REPLACE_OLD });
  await ownAccount(service, 'acc-only', 's-old', 'gs-1');
  const replacement = await service.acquireAccount({ accountId: 'acc-only', sessionId: 's-new', serverId: 'gs-2' });
  assert.equal(replacement.ok, true);
  assert.equal(replacement.status, 'replaced');
  assert.deepEqual(disconnects, [{ sessionId: 's-old', reason: 'DUPLICATE_LOGIN_REPLACED' }]);
});

test('account takeover racing character claim cannot leave orphan character ownership', async () => {
  const store = new CharacterCasGateStore('char-race');
  const { service } = makeService({ store, duplicateLoginPolicy: DUPLICATE_LOGIN_POLICY.REPLACE_OLD });
  await ownAccount(service, 'acc-race-2', 's-old', 'gs-1');

  const characterClaim = service.acquireCharacter({
    accountId: 'acc-race-2',
    characterId: 'char-race',
    sessionId: 's-old',
    serverId: 'gs-1',
  });
  await store.enteredPromise;

  const takeover = await service.acquireAccount({
    accountId: 'acc-race-2',
    sessionId: 's-new',
    serverId: 'gs-2',
  });
  assert.equal(takeover.ok, true);
  store.release();

  const oldClaimResult = await characterClaim;
  assert.equal(oldClaimResult.ok, false);
  assert.equal(oldClaimResult.code, RESULT.ACCOUNT_NOT_OWNED);
  assert.equal(await service.getCharacterOwner('char-race'), null);
  assert.equal((await service.getAccountOwner('acc-race-2')).sessionId, 's-new');
});
