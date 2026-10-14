#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const manifest = JSON.parse(await readFile(path.join(here, 'provider-manifest.json'), 'utf8'));
const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const providerRoot = path.resolve(argValue('--provider-root', path.join(repoRoot, '.ws49-providers')));
const outputRoot = path.resolve(argValue('--output', path.join(repoRoot, 'artifacts/ws49')));
const SEED = 12980049;
const EPOCH_MS = 1_700_000_000_000;
const SCENARIO_TIMEOUT_MS = 12_000;
const providerById = Object.fromEntries(manifest.providers.map((entry) => [entry.id, entry]));
const actualHeads = JSON.parse(await readFile(path.join(providerRoot, 'actual-provider-heads.json'), 'utf8'));

await rm(outputRoot, { recursive: true, force: true });
await mkdir(path.join(outputRoot, 'transcripts'), { recursive: true });
await mkdir(path.join(outputRoot, 'failure-snapshots'), { recursive: true });

function normalize(value) {
  if (typeof value === 'bigint') return value.toString();
  if (Buffer.isBuffer(value)) return { hex: value.toString('hex'), bytes: value.length };
  if (value instanceof Error) return { name: value.name, code: value.code ?? null, message: value.message };
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalize(v)]));
  return value;
}

function providerRefs(ids) {
  return ids.map((id) => ({ id, branch: providerById[id].branch, sha: providerById[id].sha }));
}

function traceFactory(id) {
  let tick = 0;
  const events = [];
  return {
    events,
    push(event, data = {}) {
      events.push({ sequence: ++tick, tMs: EPOCH_MS + tick * 10, event, data: normalize(data) });
    }
  };
}

function blocked(message, details = {}) {
  const error = new Error(message);
  error.name = 'ScenarioBlocked';
  error.code = 'BLOCKED';
  error.details = details;
  throw error;
}

async function withTimeout(promise, timeoutMs, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`${label} exceeded ${timeoutMs}ms`);
      error.code = 'TIMEOUT';
      reject(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function requireProvider(id, relativePath) {
  return require(path.join(providerRoot, providerById[id].slug, relativePath));
}

async function importProvider(id, relativePath) {
  const absolute = path.join(providerRoot, providerById[id].slug, relativePath);
  return import(pathToFileURL(absolute).href);
}

async function listTests(root) {
  const out = [];
  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (/\.(?:c?js|mjs)$/.test(entry.name)) out.push(full);
    }
  }
  await walk(root);
  return out.sort();
}

async function runProviderTests(id, relativeDirectory, namePattern = null) {
  const cwd = path.join(providerRoot, providerById[id].slug);
  const tests = await listTests(path.join(cwd, relativeDirectory));
  assert.ok(tests.length, `${id}: no tests found under ${relativeDirectory}`);
  const nodeArgs = ['--test'];
  if (namePattern) nodeArgs.push(`--test-name-pattern=${namePattern}`);
  nodeArgs.push(...tests.map((file) => path.relative(cwd, file)));
  const result = spawnSync(process.execPath, nodeArgs, {
    cwd,
    env: { ...process.env, NODE_ENV: 'test' },
    encoding: 'utf8',
    timeout: 30_000
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const error = new Error(`${id} provider tests failed (${namePattern || 'full suite'})`);
    error.code = 'PROVIDER_TEST_FAILURE';
    error.stdout = result.stdout;
    error.stderr = result.stderr;
    throw error;
  }
  return { status: result.status, stdoutTail: result.stdout.trim().split('\n').slice(-12) };
}

function movePayload({ x, z, y = 0, speed, flag }) {
  const buf = Buffer.alloc(9);
  buf.writeUInt16LE(Math.round(x * 10), 0);
  buf.writeUInt16LE(Math.round(z * 10), 2);
  buf.writeInt16LE(Math.round(y * 10), 4);
  buf.writeUInt16LE(Math.round(speed * 10), 6);
  buf.writeUInt8(flag, 8);
  return buf;
}

function makeMovementFixture({ includeSenderInBroadcast = true } = {}) {
  const { MovementService, StaticZoneBounds } = requireProvider('WS15', 'services/ko1298-movement/src');
  let now = EPOCH_MS;
  const broadcasts = [];
  const disconnects = [];
  const service = new MovementService({
    zoneBounds: new StaticZoneBounds({
      21: { minX: 0, maxX: 1000, minY: -100, maxY: 300, minZ: 0, maxZ: 1000 },
      1: { minX: 0, maxX: 500, minY: -100, maxY: 300, minZ: 0, maxZ: 500 }
    }),
    clock: () => now,
    speedPolicy: () => 10,
    broadcast: (event) => broadcasts.push(normalize(event)),
    onDisconnect: (event) => disconnects.push(normalize(event)),
    config: { positionSlack: 10, includeSenderInBroadcast }
  });
  return {
    service,
    broadcasts,
    disconnects,
    advance(ms) { now += ms; }
  };
}

async function createLootFixture({ waitOnGrant = false, ownership = null } = {}) {
  const { InMemorySerialGuard, KillerOwnershipPolicy, LootService } = await importProvider('WS26', 'services/ko1298-loot/src/index.js');
  const serialGuard = new InMemorySerialGuard();
  const grantedItems = [];
  let serial = 0;
  let lootId = 0;
  let releaseGrant = null;
  let gate = null;
  if (waitOnGrant) gate = new Promise((resolve) => { releaseGrant = resolve; });
  const table = {
    id: 'fixture.ws49.item-only',
    rolls: 1,
    entries: [{ kind: 'item', itemId: 900001, weight: 1, minQuantity: 1, maxQuantity: 1 }]
  };
  const ports = {
    dropTables: { async findForMob() { return table; } },
    ownership: ownership || new KillerOwnershipPolicy(),
    distance: { async canPickup() { return true; } },
    inventory: { async canAccept() { return true; } },
    serials: { async createForDrop() { return `ws49-serial-${++serial}`; } },
    serialGuard,
    items: { async grant(payload) { grantedItems.push(normalize(payload)); if (gate) await gate; } },
    coins: { async grant() {} }
  };
  const service = new LootService({ ports, clock: () => EPOCH_MS, idFactory: () => `ws49-loot-${++lootId}`, lootLifetimeMs: 60_000 });
  return { service, grantedItems, releaseGrant };
}

function deathEvent(indexOrOverrides = 1, extraOverrides = {}) {
  const index = typeof indexOrOverrides === 'number' ? indexOrOverrides : 1;
  const overrides = typeof indexOrOverrides === 'object' ? indexOrOverrides : extraOverrides;
  return {
    eventId: `ws49-death-${index}`,
    mobInstanceId: `ws49-mob-${index}`,
    mobTemplateId: 1001,
    killerCharacterId: 'char-killer',
    zoneId: 21,
    position: { x: 10, z: 20 },
    ...overrides
  };
}

const scenarioDefinitions = [
  {
    id: 'A',
    name: 'auth-login-character-create-select-moradon-world-ready',
    providers: ['WS10', 'WS03', 'WS14'],
    async run(trace) {
      const ws10 = await readFile(path.join(providerRoot, 'ws10/workstreams/ws10/STATUS.md'), 'utf8');
      for (const marker of manifest.canonicalGates.scenarioA.requiredMarkers) assert.ok(ws10.includes(marker), `WS10 canonical marker missing: ${marker}`);
      assert.ok(ws10.includes(`run id \`${manifest.canonicalGates.scenarioA.runId}\``), 'WS10 canonical run id mismatch');
      trace.push('canonical-browser-gate', { runId: manifest.canonicalGates.scenarioA.runId, result: 'PASS' });
      const preflight = await runProviderTests('WS03', 'tests/ko1298-session');
      trace.push('ws03-provider-preflight', preflight);
      return { evidenceMode: 'canonical-ws10-plus-current-ws03-preflight', expected: 'Moradon E2E PASS', actual: 'WS10 run #26 PASS markers + WS03 suite PASS' };
    }
  },
  {
    id: 'B', name: 'world-ready-movement-start-rotate-move-stop', providers: ['WS15'],
    async run(trace) {
      const f = makeMovementFixture();
      f.service.registerSession({ sessionId: 'p1', entityId: 100, zoneId: 21, position: { x: 50, y: 0, z: 50 } });
      const start = f.service.handleMovePacket('p1', movePayload({ x: 54, z: 50, speed: 4, flag: 0x01 }));
      trace.push('movement-start', start);
      const rotate = Buffer.alloc(2); rotate.writeInt16LE(321, 0);
      trace.push('rotate', f.service.handleRotatePacket('p1', rotate));
      f.advance(1000);
      trace.push('movement-update', f.service.handleMovePacket('p1', movePayload({ x: 58, z: 50, speed: 4, flag: 0x03 })));
      f.advance(250);
      const stop = f.service.handleMovePacket('p1', movePayload({ x: 57, z: 50, speed: 0, flag: 0x00 }));
      trace.push('movement-stop', stop);
      assert.equal(stop.state.moving, false);
      assert.deepEqual(stop.state.position, { x: 57, y: 0, z: 50 });
      return { expected: 'accepted start/rotate/update/stop with authoritative stopped position', actual: normalize(stop.state) };
    }
  },
  {
    id: 'C', name: 'region-crossing-nearby-entity-sync', providers: ['WS14', 'WS15'],
    async run(trace) {
      trace.push('provider-capability-audit', { ws15: 'same-zone recipients only', ws14: 'region bootstrap/detail request only' });
      blocked('Missing region-cell crossing contract: WS15 current provider exposes no enter/leave membership event or region-scoped recipient mutation for movement.', { missingContract: 'WS15 movement accepted -> deterministic region crossing enter/leave events consumed by WS14 visibility sync' });
    }
  },
  {
    id: 'D', name: 'npc-appears-target-detail-interaction', providers: ['WS14', 'WS16'],
    async run(trace) {
      trace.push('provider-capability-audit', { ws16: 'NPC packets/domain ready', integration: 'conditional' });
      blocked('WS16 NPC flow is not composed into the authenticated WS14/WS03 dispatcher and still requires authoritative terrain Y.', { missingContract: 'WS14 game socket dispatcher -> WS16 NPC opcodes + real terrain-height resolver' });
    }
  },
  {
    id: 'E', name: 'merchant-open-buy-inventory-sell-coin', providers: ['WS16', 'WS17', 'WS22', 'WS31'],
    async run(trace) {
      const { createFixture } = requireProvider('WS22', 'tests/ko1298-economy/fixture.cjs');
      const f = createFixture();
      f.addMerchant('npc-1');
      f.setOffer('npc-1', '1001', { npcSellPrice: 125, npcBuyPrice: 25 });
      f.setBalance('alice', 1000);
      const buy = await f.service.buyFromNpc({ playerId: 'alice', npcId: 'npc-1', itemTemplateId: '1001', quantity: 2 });
      const serial = f.getInventory('alice')[0].serial;
      const sell = await f.service.sellToNpc({ playerId: 'alice', npcId: 'npc-1', itemSerial: serial, quantity: 1 });
      trace.push('ws22-domain-preflight', { buy, sell, balance: f.getBalance('alice'), inventory: f.getInventory('alice') });
      blocked('WS22 transaction domain passes, but product merchant-open -> WS16 merchant identity -> WS31 verified catalog -> WS17 production inventory composition is missing.', { missingContract: 'WS16 merchant interaction adapter + verified merchant NPC/item mapping + WS17 production inventory adapter into WS22' });
    }
  },
  {
    id: 'F', name: 'mob-spawn-target-attack-counterattack-damage-death', providers: ['WS19', 'WS25', 'WS31'],
    async run(trace) {
      trace.push('provider-capability-audit', { ws25: 'synthetic lifecycle with attack intent adapters', ws19: 'normal attack path available' });
      blocked('No composed mob combat loop exists from WS25 target/attack intent through WS19 authoritative damage and mob counterattack back to death; WS25 also does not claim real 1298 monster stats.', { missingContract: 'WS25 attack intent <-> WS19 normal attack/damage adapter with verified WS31 monster combat stats/cooldowns' });
    }
  },
  {
    id: 'G', name: 'mob-death-drop-loot-pickup-inventory', providers: ['WS17', 'WS25', 'WS26', 'WS31'],
    async run(trace) {
      const f = await createLootFixture();
      const [loot] = await f.service.createFromMobDeath(deathEvent(), { seed: SEED });
      const receipt = await f.service.pickup({ lootId: loot.lootId, characterId: 'char-killer', zoneId: 21, position: { x: 10, z: 20 } });
      trace.push('ws26-synthetic-domain-preflight', { loot, receipt, grants: f.grantedItems });
      blocked('WS26 synthetic domain path works, but WS31 has no authoritative 1298 drop catalog and the WS25 -> WS26 -> WS17 production adapter chain is not composed.', { missingContract: 'verified monster->drop table + WS25 death event adapter + WS17 production item grant adapter' });
    }
  },
  {
    id: 'H', name: 'xp-reward-level-boundary', providers: ['WS27', 'WS31'],
    async run(trace) {
      const preflight = await runProviderTests('WS27', 'tests/ko1298-progression', 'mob XP crosses multiple configured level caps');
      trace.push('ws27-synthetic-level-table-preflight', preflight);
      blocked('WS27 delegates exact XP thresholds/max level to LevelTablePort and WS31 current catalog has no verified progression curve.', { missingContract: 'WS31 verified 1298 XP threshold/max-level data -> WS27 LevelTablePort' });
    }
  },
  {
    id: 'I', name: 'player-death-respawn', providers: ['WS14', 'WS19', 'WS27', 'WS31'],
    async run(trace) {
      const preflight = await runProviderTests('WS27', 'tests/ko1298-progression', 'respawn resolves a point');
      trace.push('ws27-respawn-port-preflight', preflight);
      blocked('WS27 respawn transition is tested, but real respawn coordinates remain RespawnPointPort data and no WS27 -> WS14 world-position handoff is composed.', { missingContract: 'verified respawn point resolver + progression respawn event -> WS14/WS15 authoritative placement' });
    }
  },
  {
    id: 'J', name: 'zone-transition-target-zone-world-ready', providers: ['WS14', 'WS31'],
    async run(trace) {
      const preflight = await runProviderTests('WS14', 'tests/ko1298-world', 'zone-change handshake');
      trace.push('ws14-moradon-zone-change-preflight', preflight);
      blocked('WS14 current public transition entry point is Moradon-specific; a generic verified target-zone transition contract/data path is not available.', { missingContract: 'beginZoneChange(targetZoneId, verified spawn) backed by WS31 zone/spawn data and WORLD_READY lifecycle' });
    }
  },
  {
    id: 'K', name: 'disconnect-reconnect-state-restore', providers: ['WS03', 'WS14', 'WS17'],
    async run(trace) {
      const f = makeMovementFixture();
      for (let i = 0; i < 50; i += 1) {
        const sessionId = `cycle-${i}`;
        f.service.registerSession({ sessionId, entityId: 100 + i, zoneId: 21, position: { x: 50, y: 0, z: 50 } });
        assert.equal(f.service.disconnect(sessionId), true);
        assert.equal(f.service.getState(sessionId), null);
      }
      trace.push('50-cycle-session-cleanup-preflight', { cycles: 50, disconnectEvents: f.disconnects.length });
      blocked('Session cleanup passes at WS15 domain level, but reconnect restore across persisted character/world/inventory state is not composed through WS03 + persistence + WS14/WS17.', { missingContract: 'persistent reconnect snapshot load + session ownership reacquire + world/inventory state restore' });
    }
  },
  {
    id: 'L', name: 'malformed-replayed-packet-resilience', providers: ['WS03', 'WS14', 'WS15'],
    async run(trace) {
      const f = makeMovementFixture();
      f.service.registerSession({ sessionId: 'p1', entityId: 100, zoneId: 21, position: { x: 50, y: 0, z: 50 } });
      let malformedError;
      try { f.service.handleMovePacket('p1', Buffer.from([0x00])); } catch (error) { malformedError = error; }
      assert.ok(malformedError, 'malformed movement packet must fail closed');
      trace.push('malformed-movement-rejected', malformedError);
      blocked('Malformed movement fails closed, but there is no shared replay/idempotency contract covering gameplay packet families end-to-end.', { missingContract: 'packet replay identity/sequence policy across session/world/economy/combat/loot dispatchers' });
    }
  },
  {
    id: 'M', name: 'two-concurrent-players-see-movement-broadcast', providers: ['WS15'],
    async run(trace) {
      const f = makeMovementFixture();
      f.service.registerSession({ sessionId: 'p1', entityId: 100, zoneId: 21, position: { x: 50, y: 0, z: 50 } });
      f.service.registerSession({ sessionId: 'p2', entityId: 101, zoneId: 21, position: { x: 55, y: 0, z: 50 } });
      f.service.registerSession({ sessionId: 'other-zone', entityId: 102, zoneId: 1, position: { x: 20, y: 0, z: 20 } });
      const p1Move = f.service.handleMovePacket('p1', movePayload({ x: 54, z: 50, speed: 4, flag: 0x01 }));
      trace.push('p1-move-broadcast', p1Move);
      assert.deepEqual([...p1Move.recipients].sort(), ['p1', 'p2']);
      f.advance(100);
      const p2Move = f.service.handleMovePacket('p2', movePayload({ x: 55, z: 54, speed: 4, flag: 0x01 }));
      trace.push('p2-move-broadcast', p2Move);
      assert.deepEqual([...p2Move.recipients].sort(), ['p1', 'p2']);
      return { expected: 'both players receive both same-zone broadcasts; other zone excluded', actual: { p1: [...p1Move.recipients].sort(), p2: [...p2Move.recipients].sort() } };
    }
  },
  {
    id: 'N', name: 'two-players-same-loot-race', providers: ['WS26'],
    async run(trace) {
      const { isLootDomainError } = await importProvider('WS26', 'services/ko1298-loot/src/index.js');
      const ownership = {
        async resolveOwners() { return { characterIds: ['char-a', 'char-b'], publicAfterMs: null }; },
        async canPickup({ loot, characterId }) { return loot.ownerCharacterIds.includes(characterId); }
      };
      const f = await createLootFixture({ waitOnGrant: true, ownership });
      const [loot] = await f.service.createFromMobDeath(deathEvent({ killerCharacterId: 'char-a' }), { seed: SEED });
      const firstRequest = { lootId: loot.lootId, characterId: 'char-a', zoneId: 21, position: { x: 10, z: 20 } };
      const secondRequest = { lootId: loot.lootId, characterId: 'char-b', zoneId: 21, position: { x: 10, z: 20 } };
      const first = f.service.pickup(firstRequest);
      let secondError;
      try { await f.service.pickup(secondRequest); } catch (error) { secondError = error; }
      assert.ok(isLootDomainError(secondError, 'LOOT_BUSY'));
      trace.push('second-claim-rejected', secondError);
      f.releaseGrant();
      const receipt = await first;
      assert.equal(f.grantedItems.length, 1);
      trace.push('first-claim-committed', receipt);
      return { expected: 'one committed grant; concurrent loser LOOT_BUSY', actual: { grants: f.grantedItems.length, loser: secondError.code } };
    }
  },
  {
    id: 'O', name: 'two-player-trade-transaction', providers: ['WS22'],
    async run(trace) {
      const { createFixture } = requireProvider('WS22', 'tests/ko1298-economy/fixture.cjs');
      const f = createFixture();
      f.setBalance('alice', 1000);
      f.setBalance('bob', 500);
      f.addItem('alice', { serial: 'a-item', templateId: '100' });
      f.addItem('bob', { serial: 'b-item', templateId: '200' });
      const trade = await f.service.inviteTrade({ fromPlayerId: 'alice', toPlayerId: 'bob' });
      await f.service.acceptTrade({ tradeId: trade.id, playerId: 'bob' });
      await f.service.stageTradeItem({ tradeId: trade.id, playerId: 'alice', itemSerial: 'a-item', quantity: 1 });
      await f.service.stageTradeItem({ tradeId: trade.id, playerId: 'bob', itemSerial: 'b-item', quantity: 1 });
      await f.service.stageTradeCoin({ tradeId: trade.id, playerId: 'alice', amount: 300 });
      await f.service.stageTradeCoin({ tradeId: trade.id, playerId: 'bob', amount: 50 });
      const first = await f.service.confirmTrade({ tradeId: trade.id, playerId: 'alice' });
      const second = await f.service.confirmTrade({ tradeId: trade.id, playerId: 'bob' });
      const actual = {
        firstCompleted: first.completed,
        secondCompleted: second.completed,
        aliceBalance: f.getBalance('alice'), bobBalance: f.getBalance('bob'),
        aliceInventory: f.getInventory('alice').map((x) => x.serial),
        bobInventory: f.getInventory('bob').map((x) => x.serial),
        status: f.getTrade(trade.id).status
      };
      trace.push('trade-complete', actual);
      assert.deepEqual(normalize(actual), {
        firstCompleted: false, secondCompleted: true, aliceBalance: '750', bobBalance: '750',
        aliceInventory: ['b-item'], bobInventory: ['a-item'], status: 'completed'
      });
      return { expected: 'atomic item+coin swap exactly once', actual: normalize(actual) };
    }
  }
];

async function runScenario(definition) {
  const trace = traceFactory(definition.id);
  const started = Date.now();
  try {
    const detail = await withTimeout(definition.run(trace), SCENARIO_TIMEOUT_MS, `scenario ${definition.id}`);
    return {
      id: definition.id, name: definition.name, status: 'PASS', providers: providerRefs(definition.providers),
      durationMs: Date.now() - started, firstFailingEvent: null, expected: normalize(detail?.expected ?? null), actual: normalize(detail?.actual ?? detail ?? null),
      blocker: null, transcript: trace.events
    };
  } catch (error) {
    const status = error.code === 'BLOCKED' ? 'BLOCKED' : 'FAIL';
    trace.push(status === 'BLOCKED' ? 'blocked' : 'failure', error);
    return {
      id: definition.id, name: definition.name, status, providers: providerRefs(definition.providers),
      durationMs: Date.now() - started,
      firstFailingEvent: status === 'BLOCKED' ? (error.details?.missingContract || 'missing provider contract') : (trace.events.at(-1)?.event ?? null),
      expected: normalize(error.details?.expected ?? (status === 'BLOCKED' ? `complete ${definition.name} path` : null)),
      actual: normalize(error.details?.actual ?? (status === 'BLOCKED' ? error.message : null)),
      blocker: status === 'BLOCKED' ? { message: error.message, ...normalize(error.details || {}) } : null,
      error: status === 'FAIL' ? normalize(error) : null, transcript: trace.events
    };
  }
}

async function stressMovement100() {
  const f = makeMovementFixture();
  f.service.registerSession({ sessionId: 'stress', entityId: 500, zoneId: 21, position: { x: 100, y: 0, z: 100 } });
  let x = 100;
  for (let i = 0; i < 100; i += 1) {
    const next = x + 0.5;
    f.service.handleMovePacket('stress', movePayload({ x: next, z: 100, speed: 1, flag: i === 0 ? 0x01 : 0x03 }));
    f.advance(100);
    x = next;
  }
  f.service.handleMovePacket('stress', movePayload({ x, z: 100, speed: 0, flag: 0x00 }));
  return { name: '100 movement sequences', status: 'PASS', scope: 'WS15 provider domain', actual: normalize(f.service.getState('stress')) };
}

async function stressReconnect50() {
  const f = makeMovementFixture();
  for (let i = 0; i < 50; i += 1) {
    const id = `reconnect-${i}`;
    f.service.registerSession({ sessionId: id, entityId: 600 + i, zoneId: 21, position: { x: 100, y: 0, z: 100 } });
    assert.equal(f.service.disconnect(id), true);
    assert.equal(f.service.getState(id), null);
  }
  return { name: '50 reconnect/session-cleanup cycles', status: 'PASS', scope: 'WS15 cleanup only; not product state restore', actual: { disconnects: f.disconnects.length } };
}

async function stressSyntheticMobKills100() {
  const f = await createLootFixture();
  for (let i = 1; i <= 100; i += 1) {
    const [loot] = await f.service.createFromMobDeath(deathEvent(i), { seed: SEED + i });
    await f.service.pickup({ lootId: loot.lootId, characterId: 'char-killer', zoneId: 21, position: { x: 10, z: 20 } });
  }
  assert.equal(f.grantedItems.length, 100);
  return { name: '100 synthetic mob-death loot cycles', status: 'PASS', scope: 'WS26 synthetic domain; no real 1298 drop fidelity claim', actual: { grants: 100 } };
}

async function stressLootRaces25() {
  const { isLootDomainError } = await importProvider('WS26', 'services/ko1298-loot/src/index.js');
  for (let i = 1; i <= 25; i += 1) {
    const f = await createLootFixture({ waitOnGrant: true });
    const [loot] = await f.service.createFromMobDeath(deathEvent(i), { seed: SEED + i });
    const request = { lootId: loot.lootId, characterId: 'char-killer', zoneId: 21, position: { x: 10, z: 20 } };
    const first = f.service.pickup(request);
    let loser;
    try { await f.service.pickup(request); } catch (error) { loser = error; }
    assert.ok(isLootDomainError(loser, 'LOOT_BUSY'));
    f.releaseGrant();
    await first;
    assert.equal(f.grantedItems.length, 1);
  }
  return { name: '25 concurrent loot races', status: 'PASS', scope: 'WS26 claim guard; WS17 production inventory not composed', actual: { races: 25, singleWinner: true } };
}

const results = [];
for (const definition of scenarioDefinitions) {
  const result = await runScenario(definition);
  results.push(result);
  await writeFile(path.join(outputRoot, 'transcripts', `${definition.id}.json`), `${JSON.stringify(normalize(result.transcript), null, 2)}\n`);
  if (result.status !== 'PASS') {
    await writeFile(path.join(outputRoot, 'failure-snapshots', `${definition.id}.json`), `${JSON.stringify(normalize(result), null, 2)}\n`);
  }
  console.log(`${definition.id} ${definition.name}: ${result.status}`);
}

const stress = [];
for (const run of [stressReconnect50, stressMovement100, stressSyntheticMobKills100, stressLootRaces25]) {
  const started = Date.now();
  try {
    const detail = await withTimeout(run(), 20_000, run.name);
    stress.push({ ...normalize(detail), durationMs: Date.now() - started });
  } catch (error) {
    stress.push({ name: run.name, status: 'FAIL', scope: 'stress', durationMs: Date.now() - started, error: normalize(error) });
  }
}

const counts = {
  pass: results.filter((x) => x.status === 'PASS').length,
  fail: results.filter((x) => x.status === 'FAIL').length,
  blocked: results.filter((x) => x.status === 'BLOCKED').length
};
const topBlockers = results.filter((x) => x.status === 'BLOCKED').slice(0, 5).map((x) => ({ scenario: x.id, message: x.blocker.message, missingContract: x.blocker.missingContract }));
const report = {
  schemaVersion: 1,
  workstream: 'WS49',
  seed: SEED,
  deterministicEpochMs: EPOCH_MS,
  generatedAt: new Date().toISOString(),
  ws10Authority: 'WS10 remains the canonical real-browser gate; WS49 does not replace it.',
  providerManifest: manifest,
  providerHeadsAtRun: actualHeads,
  counts,
  scenarios: results.map(({ transcript, ...result }) => normalize(result)),
  stress: normalize(stress),
  topBlockers
};

function markdownReport() {
  const lines = [
    '# WS49 Deterministic Gameplay Integration Report', '',
    `Seed: \`${SEED}\`  `,
    `Deterministic epoch: \`${EPOCH_MS}\`  `,
    `Scenario result: **${counts.pass} PASS / ${counts.fail} FAIL / ${counts.blocked} BLOCKED**`, '',
    '> WS10 remains the canonical real-browser Moradon gate. WS49 is a deterministic service/integration scenario suite.', '',
    '## Provider manifest', '',
    '| Provider | Branch | Pinned SHA | Head at run | Drift |', '|---|---|---|---|---|'
  ];
  for (const entry of actualHeads.providers) lines.push(`| ${entry.id} | \`${entry.branch}\` | \`${entry.pinnedSha.slice(0, 12)}\` | \`${entry.actualHeadSha.slice(0, 12)}\` | ${entry.drift ? 'YES' : 'NO'} |`);
  lines.push('', '## Scenarios', '', '| ID | Scenario | Result | First failing event / blocker |', '|---|---|---|---|');
  for (const result of results) lines.push(`| ${result.id} | ${result.name} | **${result.status}** | ${result.blocker?.message || result.error?.message || result.firstFailingEvent || ''} |`);
  lines.push('', '## Stress', '', '| Stress | Result | Scope |', '|---|---|---|');
  for (const item of stress) lines.push(`| ${item.name} | **${item.status}** | ${item.scope || ''} |`);
  lines.push('', '## Top blockers', '');
  for (const blocker of topBlockers) lines.push(`- **${blocker.scenario}:** ${blocker.message} Missing contract: ${blocker.missingContract}`);
  lines.push('');
  return lines.join('\n');
}

await writeFile(path.join(outputRoot, 'integration-report.json'), `${JSON.stringify(report, null, 2)}\n`);
await writeFile(path.join(outputRoot, 'integration-report.md'), markdownReport());
await writeFile(path.join(outputRoot, 'provider-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(path.join(outputRoot, 'actual-provider-heads.json'), `${JSON.stringify(actualHeads, null, 2)}\n`);

const hardFailure = counts.fail > 0 || stress.some((item) => item.status === 'FAIL');
if (hardFailure) process.exitCode = 1;
