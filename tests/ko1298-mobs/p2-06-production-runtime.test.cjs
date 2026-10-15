'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  createMobProductionRuntime,
  loadVerifiedWorldDefinition,
} = require('../../services/ko1298-mobs');

const VERIFIED = JSON.parse(fs.readFileSync(
  path.resolve(__dirname, '../../world-data/mobs/verified/moradon-zone21.verified.json'),
  'utf8',
));

function regionKey(record) {
  return `${record.zoneId}:${Math.floor(record.position.x / 48)}:${Math.floor(record.position.z / 48)}`;
}

function visible(player, mob) {
  if (String(player.zoneId) !== String(mob.zoneId)) return false;
  const px = Math.floor(player.position.x / 48);
  const pz = Math.floor(player.position.z / 48);
  const mx = Math.floor(mob.position.x / 48);
  const mz = Math.floor(mob.position.z / 48);
  return Math.abs(px - mx) <= 1 && Math.abs(pz - mz) <= 1;
}

function harness() {
  let nextId = 20000;
  const ids = new Map();
  const attackIntents = [];
  const movementIntents = [];
  const deathEvents = [];
  const semanticEvents = [];
  const definition = loadVerifiedWorldDefinition(VERIFIED);
  const runtime = createMobProductionRuntime(definition, {
    terrain: {
      resolveHeight(zoneId, x, z) {
        assert.equal(zoneId, 21);
        assert.ok(Number.isFinite(x));
        assert.ok(Number.isFinite(z));
        return { status: 'authoritative', height: 0, surface: 'p2-06-test' };
      },
    },
    runtimeIds: {
      claim(input) {
        if (!ids.has(input.sourceIdentity)) ids.set(input.sourceIdentity, nextId++);
        return ids.get(input.sourceIdentity);
      },
    },
    world: {
      visibilityKey: regionKey,
      isMobVisibleToPlayer: visible,
    },
    movement: {
      chase(intent) { movementIntents.push({ kind: 'CHASE', intent }); },
      returnHome(intent) { movementIntents.push({ kind: 'RETURN_HOME', intent }); },
      stop(intent) { movementIntents.push({ kind: 'STOP', intent }); },
      patrol(intent) { movementIntents.push({ kind: 'PATROL', intent }); },
      onNoPath(intent) { movementIntents.push({ kind: 'NO_PATH', intent }); },
    },
    combat: {
      isTargetAlive: (target) => target?.alive !== false && (target?.hp ?? 1) > 0,
      canAggro: () => true,
      canAttack: () => true,
      attackIntent(intent) { attackIntents.push(intent); },
    },
    loot: {
      onMobDeath(event) { deathEvents.push(event); },
    },
    events: {
      onEvent(event) { semanticEvents.push(event); },
    },
    clock: () => 1_000_000,
  });
  runtime.initialize(0);
  return { runtime, attackIntents, movementIntents, deathEvents, semanticEvents };
}

function playerAt(id, mob, extra = {}) {
  return {
    id,
    zoneId: mob.zoneId,
    position: { x: mob.x, y: mob.y, z: mob.z },
    alive: true,
    hp: 100,
    ...extra,
  };
}

test('source-backed Moradon has 135 mobs but initial login AOI has zero mob slots', () => {
  const { runtime } = harness();
  const diagnostic = runtime.diagnoseVisibility({ zoneId: 21, x: 312, z: 402 });
  assert.equal(diagnostic.totalMaterialized, 135);
  assert.equal(diagnostic.nearbyCount, 0);
  assert.ok(diagnostic.nearest);
  assert.ok(diagnostic.nearest.z <= 329);
});

test('two players consume the same shared mob identity, HP and position', () => {
  const { runtime } = harness();
  const first = runtime.visibilitySnapshot()[0];
  runtime.playerUpsert(playerAt('player-a', first), 100);
  runtime.playerUpsert(playerAt('player-b', first), 100);

  const a = runtime.getNearby({ zoneId: first.zoneId, x: first.x, z: first.z });
  const b = runtime.getNearby({ zoneId: first.zoneId, x: first.x, z: first.z });
  const aMob = a.find((mob) => mob.runtimeId === first.runtimeId);
  const bMob = b.find((mob) => mob.runtimeId === first.runtimeId);
  assert.ok(aMob);
  assert.ok(bMob);
  assert.equal(aMob.runtimeId, bMob.runtimeId);
  assert.equal(aMob.hp, bMob.hp);
  assert.deepEqual(aMob.position, bMob.position);
});

test('aggro produces P2-07 attack intent and disconnect resets target without applying damage', () => {
  const { runtime, attackIntents } = harness();
  const first = runtime.visibilitySnapshot()[0];
  runtime.playerUpsert(playerAt('player-a', first), 100);
  runtime.tick(200);

  const engaged = runtime.combatSnapshot(first.runtimeId);
  assert.equal(engaged.targetId, 'player-a');
  assert.ok(['aggro', 'chasing', 'attack-intent'].includes(engaged.state));
  assert.ok(attackIntents.some((intent) => intent.runtimeId === first.runtimeId && intent.targetId === 'player-a'));
  assert.equal(engaged.hp, engaged.maxHp, 'P2-06 must not apply damage from its own attack intent');

  runtime.playerDisconnected('player-a', 300);
  const reset = runtime.combatSnapshot(first.runtimeId);
  assert.equal(reset.targetId, null);
  assert.ok(['idle', 'returning'].includes(reset.state));
});

test('P2-07 result drives one death event, duplicate result drives no second P2-08 reward event, then same runtime ID respawns', () => {
  const { runtime, deathEvents } = harness();
  const first = runtime.visibilitySnapshot()[0];
  runtime.playerUpsert(playerAt('player-a', first), 100);

  const result = {
    ok: true,
    requestKey: 'combat-request-001',
    attackerId: 'player-a',
    targetId: first.runtimeId,
    absoluteTargetHp: 0,
  };
  const killed = runtime.applyCombatResult(first.runtimeId, result, 1000);
  assert.equal(killed.applied, true);
  assert.equal(killed.deathTransition, true);
  assert.equal(deathEvents.length, 1);
  assert.equal(deathEvents[0].eventId, `ko1298-mob-death:${first.runtimeId}:combat-request-001`);

  const duplicate = runtime.applyCombatResult(first.runtimeId, result, 1001);
  assert.equal(duplicate.applied, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(deathEvents.length, 1);

  const dead = runtime.visibilitySnapshot(first.runtimeId);
  const respawnAt = dead.respawnAt;
  assert.ok(Number.isFinite(respawnAt));
  runtime.tick(respawnAt);
  runtime.tick(respawnAt + 1);
  const respawned = runtime.combatSnapshot(first.runtimeId);
  assert.equal(respawned.runtimeId, first.runtimeId);
  assert.equal(respawned.hp, respawned.maxHp);
  assert.equal(respawned.state, 'idle');
  assert.equal(respawned.spawnEpoch, 1);
});

test('movement ownership stays external: no-path/leash uses intent ports and authoritative position sync', () => {
  const { runtime, movementIntents } = harness();
  const first = runtime.visibilitySnapshot()[0];
  runtime.playerUpsert(playerAt('player-a', first, {
    position: { x: first.x + 10, y: first.y, z: first.z },
  }), 100);
  runtime.tick(200);
  assert.ok(movementIntents.some((entry) => entry.kind === 'CHASE'));

  runtime.reportMovementOutcome(first.runtimeId, 'no-path', 300);
  assert.ok(movementIntents.some((entry) => entry.kind === 'NO_PATH'));
  assert.ok(movementIntents.some((entry) => entry.kind === 'RETURN_HOME'));

  runtime.syncMobPosition(first.runtimeId, first.home, 400);
  runtime.tick(500);
  assert.ok(['idle', 'aggro', 'chasing', 'attack-intent'].includes(runtime.combatSnapshot(first.runtimeId).state));
});

test('runtime owns exactly one central timer, not per-mob timers', () => {
  const { runtime } = harness();
  let calls = 0;
  const fakeTimer = { id: 'only-timer' };
  const setIntervalFn = (fn, ms) => {
    calls += 1;
    assert.equal(typeof fn, 'function');
    assert.equal(ms, 100);
    return fakeTimer;
  };
  assert.equal(runtime.start({ setIntervalFn }), fakeTimer);
  assert.equal(runtime.start({ setIntervalFn }), fakeTimer);
  assert.equal(calls, 1);
  assert.equal(runtime.stop({ clearIntervalFn: (timer) => assert.equal(timer, fakeTimer) }), true);
});

test('tick benchmark reports one shared 135-mob loop without a flaky wall-clock threshold', () => {
  const { runtime } = harness();
  const benchmark = runtime.benchmarkTicks({ iterations: 250, startAtMs: 2_000_000, stepMs: 100 });
  assert.equal(benchmark.mobCount, 135);
  assert.equal(benchmark.timerModel, 'single-central-timer');
  assert.equal(benchmark.iterations, 250);
  assert.ok(benchmark.nsPerTick > 0);
});
