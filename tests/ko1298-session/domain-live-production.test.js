'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  ProductionPostgresRepository,
  canonicalUsername,
} = require('../../services/ko1298-session/postgres-repository');
const { PersistentMovementPort } = require('../../services/ko1298-session/persistent-movement-port');
const { SessionAuthority } = require('../../services/ko1298-session/session-authority');
const {
  DOMAIN_LIVE_PROVIDER_PINS,
  createProductionProviderComposition,
} = require('../../services/ko1298-session/production-composition');

function fakeRepository({ account } = {}) {
  return new ProductionPostgresRepository({
    pool: { end: async () => {} },
    sessionRepository: {
      authenticate: async (_username, password) => password === 'Ko!Pass2026',
      getNation: async () => 0,
      setNation: async () => true,
      listCharacters: async () => [],
      createCharacter: async () => ({ ok: false }),
      getCharacter: async () => null,
    },
    worldRepository: {
      getCharacterForWorld: async () => null,
      saveWorldPosition: async () => ({}),
      saveWorldState: async () => ({}),
      loadReconnectSnapshot: async () => null,
    },
    accountRepository: {
      findByUsernameCanonical: async () => account ?? {
        status: 'active',
        verifiedAt: Date.now(),
        passwordVersion: 1,
        ban: { active: false },
      },
    },
  });
}

test('production account gate uses shared canonical identity and fails closed on website account state', async () => {
  assert.equal(canonicalUsername(' WebHero '), 'webhero');
  assert.throws(() => canonicalUsername('bad space'));
  assert.throws(() => canonicalUsername('1startsWrong'));

  for (const account of [
    { status: 'active', verifiedAt: null, passwordVersion: 1, ban: { active: false } },
    { status: 'banned', verifiedAt: Date.now(), passwordVersion: 1, ban: { active: false } },
    { status: 'active', verifiedAt: Date.now(), passwordVersion: 1, ban: { active: true, code: 'ACCOUNT_BANNED' } },
  ]) {
    const repo = fakeRepository({ account });
    assert.equal(await repo.authenticate('WebHero', 'Ko!Pass2026'), false);
  }

  const repo = fakeRepository();
  assert.equal(await repo.authenticate('WebHero', 'wrong'), false);
  assert.equal(await repo.authenticate('WebHero', 'Ko!Pass2026'), true);
  assert.equal((await repo.assertGameAccountAccess('WebHero', 2)).code, 'PASSWORD_VERSION_CHANGED');
});

test('production NPC visibility is not allowed to silently fall back to empty fixtures', async () => {
  const repo = fakeRepository();
  await assert.rejects(
    () => repo.getSurroundingNpcs({ zoneId: 21, x: 312, z: 402 }),
    (error) => error.code === 'PRODUCTION_NPC_PROVIDER_REQUIRED',
  );
  repo.setNpcWorld({ nearby: () => [{ nid: 10000, zoneId: 21 }] });
  assert.equal((await repo.getSurroundingNpcs({ zoneId: 21, x: 312, z: 402 })).length, 1);
});

test('movement persistence is awaited and rolls runtime state back when PostgreSQL save fails', async () => {
  let state = { entityId: 7, zoneId: 21, position: { x: 312, y: 0, z: 402 }, headingRaw: 0 };
  let rolledBack = false;
  const movement = {
    getState: () => structuredClone(state),
    async handleMovePacket() {
      state = { ...state, position: { x: 313, y: 0, z: 403 } };
      return { accepted: true, deduplicated: false, state: structuredClone(state) };
    },
    teleport(_sessionId, input) {
      state = { ...state, zoneId: input.zoneId, position: structuredClone(input.position), headingRaw: input.headingRaw };
      rolledBack = true;
      return state;
    },
    registerSession: () => {},
    restoreSession: () => {},
    getPositionSnapshot: () => state,
    getEntityPositionSnapshot: () => state,
    hasSession: () => true,
    disconnect: () => true,
    getDiagnostics: () => ({}),
    handleRotatePacket: () => ({ accepted: true }),
  };
  const worldSession = {
    getSession: () => ({ accountId: 'webhero', characterId: 'DbHero' }),
  };
  const port = new PersistentMovementPort({
    movement,
    worldSession,
    repository: { saveWorldPosition: async () => { throw new Error('db unavailable'); } },
  });

  await assert.rejects(
    () => port.handleMovePacket('game:7', Buffer.alloc(10)),
    (error) => error.code === 'MOVEMENT_PERSISTENCE_FAILED',
  );
  assert.equal(rolledBack, true);
  assert.deepEqual(state.position, { x: 312, y: 0, z: 402 });
});

test('session authority exposes online state and a transport-closing kick port without an admin database', async () => {
  let dispatcherClosed = null;
  let transportClosed = false;
  const authority = new SessionAuthority();
  authority.register({
    socketId: 17,
    session: {
      actorContext: () => ({
        sessionId: 'game:17', accountId: 'webhero', characterId: 'DbHero', zoneId: 21,
        entityId: 17, position: { x: 312, y: 0, z: 402 }, state: 'WORLD_READY',
      }),
    },
    dispatcher: { close: async (options) => { dispatcherClosed = options; } },
    disconnectTransport: () => { transportClosed = true; },
  });
  assert.equal(authority.listOnlinePlayers().length, 1);
  assert.equal(authority.findOnlinePlayer({ characterId: 'dbhero' }).socketId, 17);
  assert.equal((await authority.executeCommand({ type: 'BAN', character: 'DbHero' })).code, 'UNSUPPORTED_RUNTIME_COMMAND');
  assert.equal((await authority.executeCommand({ type: 'KICK', character: 'DbHero', reason: 'ADMIN_TEST' })).ok, true);
  assert.deepEqual(dispatcherClosed, { reason: 'ADMIN_TEST', useGrace: false });
  assert.equal(transportClosed, true);
  assert.equal(authority.listOnlinePlayers().length, 0);
});

test('production provider composition wires restore-on-select and persistent movement without MemoryRepository', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws03-domain-live-'));
  const npcPath = path.join(dir, 'npc.json');
  const mobPath = path.join(dir, 'mob.json');
  fs.writeFileSync(npcPath, '{}');
  fs.writeFileSync(mobPath, '{}');

  class NpcWorld {
    constructor() { this.rows = []; }
    add(row) { this.rows.push(row); }
    nearby() { return this.rows; }
  }
  class WorldSessionService {
    constructor() { this.restored = 0; }
    restoreAuthoritativeSession(input) { this.restored += 1; return { input }; }
    beginSelectedCharacter() { throw new Error('initial spawn path must not be used in production'); }
    getSession() { return { accountId: 'webhero', characterId: 'DbHero' }; }
  }
  class MovementService {
    constructor() {}
    registerSession() {}
    restoreSession() {}
    getState() { return null; }
    getPositionSnapshot() { return null; }
    getEntityPositionSnapshot() { return null; }
    hasSession() { return false; }
    teleport() {}
    disconnect() {}
    getDiagnostics() { return {}; }
    handleMovePacket() { return { accepted: false }; }
    handleRotatePacket() { return { accepted: false }; }
  }
  class MobVisibilityService {
    initialize() { return Array.from({ length: 135 }, (_, i) => ({ runtimeId: 20000 + i })); }
  }

  const repo = fakeRepository();
  const composition = createProductionProviderComposition({
    repository: repo,
    env: { OLDKO_MORADON_NPC_DATA: npcPath, OLDKO_MORADON_MOB_DATA: mobPath },
    existsSync: fs.existsSync,
    readFileSync: fs.readFileSync,
    heightResolver: { resolveHeight: () => ({ status: 'authoritative', height: 0 }) },
    providers: {
      world: {
        WorldSessionService,
        createSharedNpcRuntimeIdNamespace: () => ({ claim: () => 20000, snapshot: () => ({ occupied: 178 }) }),
      },
      movement: { MovementService },
      npc: {
        NpcWorld,
        materializeNpcPopulation: () => ({
          records: Array.from({ length: 43 }, (_, i) => ({ nid: 10000 + i, instanceId: 10000 + i, zoneId: 21, x: 312, y: 0, z: 402 })),
        }),
      },
      mobs: {
        MobVisibilityService,
        loadVerifiedWorldDefinition: () => ({}),
        RUNTIME_ID_CONTRACT: { NPC_BAND: 10000, INVALID_BAND: 30000 },
      },
    },
  });

  assert.deepEqual(composition.providerPins, DOMAIN_LIVE_PROVIDER_PINS);
  assert.equal(composition.evidence.npcRecords, 43);
  assert.equal(composition.evidence.mobRecords, 135);
  assert.ok(composition.movementSession instanceof PersistentMovementPort);
  const restored = await composition.worldSession.beginSelectedCharacter({ accountId: 'webhero', characterId: 'DbHero', socketId: 7 });
  assert.deepEqual(restored.input, { accountId: 'webhero', characterId: 'DbHero', socketId: 7 });
});
