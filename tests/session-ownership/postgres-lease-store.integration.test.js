'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SessionOwnershipService,
  DUPLICATE_LOGIN_POLICY,
  LEASE_SCOPE,
  RESULT,
  createPostgresLeaseStore,
  createAdminSessionAuthority,
} = require('../../services/session-ownership');

const postgresAvailable = Boolean(process.env.DATABASE_URL || process.env.PGHOST);
const pgTest = (name, fn) => test(name, { skip: !postgresAvailable }, fn);

class ManualClock {
  constructor(now = 10_000) { this.value = now; }
  now() { return this.value; }
  advance(ms) { this.value += ms; }
}

function createStore() {
  return createPostgresLeaseStore({ connectionString: process.env.DATABASE_URL || undefined });
}

function makeService(store, {
  clock = new ManualClock(),
  policy = DUPLICATE_LOGIN_POLICY.REJECT_NEW,
  disconnects = [],
} = {}) {
  const service = new SessionOwnershipService({
    store,
    clock,
    leaseMs: 1_000,
    reconnectGraceMs: 250,
    duplicateLoginPolicy: policy,
    disconnectArbiter: { requestDisconnect: async (event) => disconnects.push(event) },
  });
  return { service, clock, disconnects };
}

async function clear(store) {
  await store.pool.query('TRUNCATE TABLE oldko.session_leases');
}

function makeTwoPartyGate({ scope, key }) {
  let entered = 0;
  let open = false;
  const waiters = [];
  return {
    scope,
    key,
    async wait() {
      if (open) return;
      entered += 1;
      if (entered === 2) {
        open = true;
        for (const resolve of waiters.splice(0)) resolve();
        return;
      }
      await new Promise((resolve) => waiters.push(resolve));
    },
  };
}

function gatedStore(base, gate) {
  return {
    get: base.get.bind(base),
    listBySession: base.listBySession.bind(base),
    listAll: base.listAll.bind(base),
    compareAndSet: async (scope, key, expectedVersion, nextRecord) => {
      if (scope === gate.scope && key === gate.key && expectedVersion === null && nextRecord != null) {
        await gate.wait();
      }
      return base.compareAndSet(scope, key, expectedVersion, nextRecord);
    },
  };
}

function leaseRecord({
  scope = LEASE_SCOPE.ACCOUNT,
  key = 'acc-primitive',
  accountId = 'acc-primitive',
  characterId = null,
  sessionId = 's-primitive',
  serverId = 'gs-1',
  generation = 1,
  now = 10_000,
  leaseUntil = now + 1_000,
  state = 'active',
  graceUntil = null,
  replacedSessionId = null,
} = {}) {
  return {
    scope,
    key,
    accountId,
    characterId,
    sessionId,
    serverId,
    state,
    generation,
    acquiredAt: now,
    heartbeatAt: now,
    leaseUntil,
    graceUntil,
    replacedSessionId,
  };
}

pgTest('migration and explicit atomic primitives use the single WS07-compatible lease table', async (t) => {
  const store = createStore();
  t.after(() => store.close());
  await clear(store);

  const { rows } = await store.pool.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'oldko' AND table_name = 'session_leases'`,
  );
  const columns = new Set(rows.map((row) => row.column_name));
  for (const required of [
    'scope', 'lease_key', 'account_id', 'character_id', 'session_id', 'server_id',
    'version', 'acquired_at', 'heartbeat_at', 'lease_until', 'expires_at', 'updated_at',
    'grace_until', 'replaced_session_id',
  ]) assert.equal(columns.has(required), true, `missing ${required}`);

  const initial = leaseRecord();
  const acquired = await store.acquire(initial.scope, initial.key, initial);
  assert.equal(acquired.ok, true);
  assert.equal((await store.read(initial.scope, initial.key)).version, 1);

  const renewedRecord = { ...acquired.record, heartbeatAt: 10_100, leaseUntil: 11_100 };
  delete renewedRecord.version;
  const renewed = await store.renew(initial.scope, initial.key, 1, renewedRecord);
  assert.equal(renewed.ok, true);
  assert.equal(renewed.record.version, 2);

  const replacementRecord = leaseRecord({
    key: initial.key,
    accountId: initial.accountId,
    sessionId: 's-primitive-new',
    serverId: 'gs-2',
    generation: 2,
    now: 10_200,
    replacedSessionId: 's-primitive',
  });
  const replaced = await store.replace(initial.scope, initial.key, 2, replacementRecord);
  assert.equal(replaced.ok, true);
  assert.equal(replaced.record.version, 3);
  assert.equal(replaced.record.sessionId, 's-primitive-new');

  const released = await store.release(initial.scope, initial.key, 3);
  assert.equal(released.ok, true);
  assert.equal(await store.read(initial.scope, initial.key), null);

  const stale = leaseRecord({
    key: 'acc-stale-primitive', accountId: 'acc-stale-primitive', now: 8_000, leaseUntil: 9_000,
  });
  const staleInserted = await store.acquire(stale.scope, stale.key, stale);
  const reclaimedRecord = leaseRecord({
    key: stale.key, accountId: stale.accountId, sessionId: 's-new', serverId: 'gs-2', generation: 2, now: 10_000,
  });
  const reclaimed = await store.reclaimExpired(
    stale.scope, stale.key, staleInserted.record.version, reclaimedRecord, 10_000,
  );
  assert.equal(reclaimed.ok, true);
  assert.equal(reclaimed.record.sessionId, 's-new');
});

pgTest('two independent stores forced through the same empty-state race yield exactly one reject-new winner', async (t) => {
  const storeA = createStore();
  const storeB = createStore();
  t.after(async () => { await storeA.close(); await storeB.close(); });
  await clear(storeA);

  const gate = makeTwoPartyGate({ scope: LEASE_SCOPE.ACCOUNT, key: 'acc-race' });
  const clock = new ManualClock();
  const a = makeService(gatedStore(storeA, gate), { clock }).service;
  const b = makeService(gatedStore(storeB, gate), { clock }).service;

  const [ra, rb] = await Promise.all([
    a.acquireAccount({ accountId: 'acc-race', sessionId: 's-a', serverId: 'proc-a' }),
    b.acquireAccount({ accountId: 'acc-race', sessionId: 's-b', serverId: 'proc-b' }),
  ]);
  const winners = [ra, rb].filter((result) => result.ok);
  const losers = [ra, rb].filter((result) => !result.ok);
  assert.equal(winners.length, 1);
  assert.equal(losers.length, 1);
  assert.equal(losers[0].code, RESULT.ACCOUNT_IN_USE);
  assert.equal((await storeA.get(LEASE_SCOPE.ACCOUNT, 'acc-race')).sessionId, winners[0].lease.sessionId);
});

pgTest('replace-old clears displaced character leases and stale old-owner heartbeat/release cannot remove the new lease', async (t) => {
  const storeA = createStore();
  const storeB = createStore();
  t.after(async () => { await storeA.close(); await storeB.close(); });
  await clear(storeA);

  const clock = new ManualClock();
  const oldSide = makeService(storeA, { clock });
  const newSide = makeService(storeB, { clock, policy: DUPLICATE_LOGIN_POLICY.REPLACE_OLD });

  await oldSide.service.acquireAccount({ accountId: 'acc-replace', sessionId: 's-old', serverId: 'proc-old' });
  await oldSide.service.acquireCharacter({
    accountId: 'acc-replace', characterId: 'char-old', sessionId: 's-old', serverId: 'proc-old',
  });

  const replaced = await newSide.service.acquireAccount({
    accountId: 'acc-replace', sessionId: 's-new', serverId: 'proc-new',
  });
  assert.equal(replaced.ok, true);
  assert.equal(replaced.status, 'replaced');
  assert.equal(await newSide.service.getCharacterOwner('char-old'), null);

  assert.equal((await oldSide.service.heartbeat('s-old')).renewed, 0);
  assert.equal((await oldSide.service.revokeSession('s-old', { reason: 'OLD_PROCESS_SHUTDOWN' })).status, 'already-revoked');
  assert.equal((await newSide.service.getAccountOwner('acc-replace')).sessionId, 's-new');
});

pgTest('account precondition plus concurrent character CAS gives exactly one character owner', async (t) => {
  const storeA = createStore();
  const storeB = createStore();
  t.after(async () => { await storeA.close(); await storeB.close(); });
  await clear(storeA);

  const clock = new ManualClock();
  const gate = makeTwoPartyGate({ scope: LEASE_SCOPE.CHARACTER, key: 'char-race' });
  const serviceA = makeService(gatedStore(storeA, gate), { clock }).service;
  const serviceB = makeService(gatedStore(storeB, gate), { clock }).service;
  await serviceA.acquireAccount({ accountId: 'acc-a', sessionId: 's-a', serverId: 'proc-a' });
  await serviceB.acquireAccount({ accountId: 'acc-b', sessionId: 's-b', serverId: 'proc-b' });

  const [a, b] = await Promise.all([
    serviceA.acquireCharacter({ accountId: 'acc-a', characterId: 'char-race', sessionId: 's-a', serverId: 'proc-a' }),
    serviceB.acquireCharacter({ accountId: 'acc-b', characterId: 'char-race', sessionId: 's-b', serverId: 'proc-b' }),
  ]);
  assert.equal([a, b].filter((result) => result.ok).length, 1);
  assert.equal([a, b].filter((result) => !result.ok)[0].code, RESULT.CHARACTER_IN_USE);
});

pgTest('process crash without release is recovered by TTL stale reclaim after service restart', async (t) => {
  const storeA = createStore();
  const storeB = createStore();
  t.after(async () => { await storeA.close(); await storeB.close(); });
  await clear(storeA);

  const clock = new ManualClock();
  const crashed = makeService(storeA, { clock }).service;
  await crashed.acquireAccount({ accountId: 'acc-crash', sessionId: 's-dead', serverId: 'proc-dead' });
  await crashed.acquireCharacter({
    accountId: 'acc-crash', characterId: 'char-crash', sessionId: 's-dead', serverId: 'proc-dead',
  });

  clock.advance(1_001);
  const restarted = makeService(storeB, { clock }).service;
  const reclaimed = await restarted.acquireAccount({
    accountId: 'acc-crash', sessionId: 's-live', serverId: 'proc-live',
  });
  assert.equal(reclaimed.ok, true);
  assert.equal(reclaimed.status, 'reclaimed-stale');
  assert.equal(reclaimed.lease.sessionId, 's-live');
  assert.equal(await restarted.getCharacterOwner('char-crash'), null);
});

pgTest('reconnect grace resume is CAS-safe across two service instances', async (t) => {
  const storeA = createStore();
  const storeB = createStore();
  t.after(async () => { await storeA.close(); await storeB.close(); });
  await clear(storeA);

  const clock = new ManualClock();
  const original = makeService(storeA, { clock }).service;
  await original.acquireAccount({ accountId: 'acc-grace', sessionId: 's-old', serverId: 'proc-old' });
  await original.disconnect('s-old', { useGrace: true });

  const contenderA = makeService(storeA, { clock }).service;
  const contenderB = makeService(storeB, { clock }).service;
  const [a, b] = await Promise.all([
    contenderA.resumeGrace({
      scope: LEASE_SCOPE.ACCOUNT, key: 'acc-grace', previousSessionId: 's-old', newSessionId: 's-a', serverId: 'proc-a',
    }),
    contenderB.resumeGrace({
      scope: LEASE_SCOPE.ACCOUNT, key: 'acc-grace', previousSessionId: 's-old', newSessionId: 's-b', serverId: 'proc-b',
    }),
  ]);
  assert.equal([a, b].filter((result) => result.ok).length, 1);
  assert.equal([a, b].filter((result) => !result.ok)[0].code, RESULT.NOT_RESUMABLE);
});

pgTest('admin session authority exposes lease reads and ownership revokes without character mutation authority', async (t) => {
  const store = createStore();
  t.after(() => store.close());
  await clear(store);

  const clock = new ManualClock();
  const disconnects = [];
  const { service } = makeService(store, { clock, disconnects });
  const admin = createAdminSessionAuthority({ service, clock });

  await service.acquireAccount({ accountId: 'acc-admin', sessionId: 's-admin', serverId: 'proc-1' });
  await service.acquireCharacter({
    accountId: 'acc-admin', characterId: 'char-admin', sessionId: 's-admin', serverId: 'proc-1',
  });
  const online = await admin.listOnlineCharacters();
  assert.equal(online.length, 1);
  assert.equal(online[0].characterId, 'char-admin');
  assert.equal(typeof admin.mutateOnlineCharacter, 'undefined');
  assert.equal(typeof admin.getCharacterState, 'undefined');

  const kicked = await admin.kickCharacter('char-admin', { reason: 'GM_KICK' });
  assert.equal(kicked.status, 'revoked');
  assert.equal(await service.getCharacterOwner('char-admin'), null);
  assert.equal(await service.getAccountOwner('acc-admin'), null);
  assert.deepEqual(disconnects, [{ sessionId: 's-admin', reason: 'GM_KICK' }]);
});
