'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const fixture = require('../../world-data/mobs/fixtures/moradon-lifecycle.fixture.json');
const moradonVerified = require('../../world-data/mobs/verified/moradon-zone21.verified.json');
const {
  MobService,
  MobState,
  DeterministicMobScheduler,
  loadVerifiedWorldDefinition,
  loadWs31MonsterTemplates,
  validateWorldDefinition,
} = require('../../services/ko1298-mobs');

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function target(id, x, z, extra = {}) {
  return { id, zoneId: 'fixture:moradon', position: { x, y: 0, z }, ...extra };
}

function makeHarness({ definition = fixture, candidates = [], targets = [], isTargetAlive, canAggro, canAttack, visible, resolveHeight } = {}) {
  const calls = {
    spawn: [], state: [], despawn: [], nearbySpawn: [], nearbyDespawn: [],
    chase: [], returnHome: [], stop: [], patrol: [], noPath: [], attackIntent: [], assistSignal: [],
  };
  let candidateList = candidates;
  const targetMap = new Map(targets.map((value) => [String(value.id), value]));
  const service = new MobService(definition, {
    world: {
      listAggroCandidates: () => candidateList,
      getTargetSnapshot: (id) => targetMap.get(String(id)) ?? null,
      isMobVisibleToPlayer: visible ?? (() => false),
      onMobSpawn: (mob, event) => calls.spawn.push({ mob, event }),
      onMobStateChange: (mob, event) => calls.state.push({ mob, event }),
      onMobDespawn: (mob, event) => calls.despawn.push({ mob, event }),
      onNearbyMobSpawn: (player, mob, event) => calls.nearbySpawn.push({ player, mob, event }),
      onNearbyMobDespawn: (player, mob, event) => calls.nearbyDespawn.push({ player, mob, event }),
      onAssistSignal: (signal) => calls.assistSignal.push(signal),
    },
    terrain: {
      resolveHeight: resolveHeight ?? (() => null),
    },
    movement: {
      chase: (intent) => calls.chase.push(intent),
      returnHome: (intent) => calls.returnHome.push(intent),
      stop: (intent) => calls.stop.push(intent),
      patrol: (intent) => calls.patrol.push(intent),
      onNoPath: (intent) => calls.noPath.push(intent),
    },
    combat: {
      isTargetAlive: isTargetAlive ?? (() => true),
      canAggro: canAggro ?? (() => true),
      canAttack: canAttack ?? (() => true),
      attackIntent: (intent) => calls.attackIntent.push(intent),
    },
  });
  return {
    calls, service, targetMap,
    setCandidates(value) { candidateList = value; },
  };
}

function firstId(service) { return service.list()[0].id; }

function largeDefinition(count) {
  return {
    schemaVersion: 2,
    dataClass: 'fixture',
    zoneId: 'fixture:load',
    templates: [{
      templateId: 'fixture:load-mob', displayName: 'Load Mob', dataClass: 'fixture', sourceRef: 'load-test',
      maxHp: 100, aggroRange: 8, leashRange: 20, attackRange: 2, attackDelayMs: 1000,
      returnTolerance: 0.5, corpseDespawnMs: 100, respawnDelayMs: 300, stuckThreshold: 2,
    }],
    spawnGroups: [{
      groupId: 'fixture:load-group', templateId: 'fixture:load-mob',
      spawns: Array.from({ length: count }, (_, i) => ({
        spawnId: `s-${String(i).padStart(4, '0')}`, x: i % 20, y: 0, z: Math.floor(i / 20), heading: 0,
      })),
    }],
  };
}

test('fixture remains explicitly synthetic with stable deterministic instance ids', () => {
  const definition = validateWorldDefinition(fixture);
  assert.equal(definition.dataClass, 'fixture');
  const h = makeHarness();
  const mobs = h.service.initialize(0);
  assert.deepEqual(mobs.map((mob) => mob.id), [
    'fixture:moradon-training-group-a/a1',
    'fixture:moradon-training-group-a/a2',
  ]);
  assert.equal(h.service.stats().mobCount, 2);
  assert.equal(h.calls.spawn.length, 2);
});

test('target selection is deterministic: nearest wins and lexical id breaks ties', () => {
  const beta = target('beta', 103, 100);
  const alpha = target('alpha', 103, 100);
  const farther = target('farther', 107, 100);
  const h = makeHarness({ candidates: [beta, farther, alpha], targets: [beta, farther, alpha] });
  h.service.initialize(0);
  h.service.tick(100);
  assert.equal(h.service.get(firstId(h.service)).state, MobState.CHASING);
  assert.equal(h.service.get(firstId(h.service)).targetId, 'alpha');
  assert.equal(h.calls.state.some((entry) => entry.event.type === 'aggro'), true);
});

test('attack-intent is emitted without applying damage and source delay gates intent cadence', () => {
  const p = target('p1', 101, 100);
  const h = makeHarness({ candidates: [p], targets: [p] });
  h.service.initialize(0);
  h.service.tick(10);
  const id = firstId(h.service);
  assert.equal(h.service.get(id).state, MobState.ATTACK_INTENT);
  assert.equal(h.calls.attackIntent.length, 1, 'only the nearer fixture mob is within the fixture attack range');
  assert.equal(h.service.get(id).hp, 120, 'WS25 never mutates target or self HP from attack intent');
  h.service.tick(500);
  assert.equal(h.calls.attackIntent.length, 1);
  h.service.tick(1010);
  assert.equal(h.calls.attackIntent.length, 2);
});

test('combat policy veto prevents aggro and attack policy can force chase', () => {
  const p = target('p1', 101, 100);
  const veto = makeHarness({ candidates: [p], targets: [p], canAggro: () => false });
  veto.service.initialize(0);
  veto.service.tick(1);
  assert.equal(veto.service.get(firstId(veto.service)).state, MobState.IDLE);

  const noAttack = makeHarness({ candidates: [p], targets: [p], canAttack: () => false });
  noAttack.service.initialize(0);
  noAttack.service.tick(1);
  assert.equal(noAttack.service.get(firstId(noAttack.service)).state, MobState.CHASING);
});

test('target dead, lost, or wrong-zone clears target deterministically', () => {
  const p = target('p1', 103, 100);
  let alive = true;
  const h = makeHarness({ candidates: [p], targets: [p], isTargetAlive: () => alive });
  h.service.initialize(0);
  h.service.tick(1);
  const id = firstId(h.service);
  assert.equal(h.service.get(id).state, MobState.CHASING);
  alive = false;
  h.setCandidates([]);
  h.service.tick(2);
  assert.equal(h.service.get(id).state, MobState.IDLE);
  assert.equal(h.service.get(id).targetId, null);

  alive = true;
  p.zoneId = 'other-zone';
  h.setCandidates([p]);
  h.service.tick(3);
  assert.equal(h.service.get(id).state, MobState.IDLE);
});

test('leash violation delegates return-home and home completion waits for authoritative WS15 sync', () => {
  const p = target('p1', 103, 100);
  const h = makeHarness({ candidates: [p], targets: [p] });
  h.service.initialize(0);
  h.service.tick(1);
  const id = firstId(h.service);
  h.service.syncPosition(id, { x: 120, y: 0, z: 100, heading: 0 }, 2);
  h.service.tick(3);
  assert.equal(h.service.get(id).state, MobState.RETURNING);
  assert.equal(h.calls.returnHome.at(-1).reason, 'mob-leash-exceeded');
  h.setCandidates([]);
  h.service.syncPosition(id, { x: 100.1, y: 0, z: 100, heading: 0 }, 4);
  h.service.tick(5);
  assert.equal(h.service.get(id).state, MobState.IDLE);
  assert.deepEqual(h.service.get(id).position, h.service.get(id).home);
});

test('stuck threshold and no-path are movement-result ports, not copied pathfinding', () => {
  const p = target('p1', 103, 100);
  const h = makeHarness({ candidates: [p], targets: [p] });
  h.service.initialize(0);
  h.service.tick(1);
  const id = firstId(h.service);
  h.service.reportMovementOutcome(id, 'stuck', 2);
  assert.equal(h.service.get(id).state, MobState.CHASING);
  h.service.reportMovementOutcome(id, 'stuck', 3);
  assert.equal(h.service.get(id).state, MobState.RETURNING);

  const h2 = makeHarness({ candidates: [p], targets: [p] });
  h2.service.initialize(0);
  h2.service.tick(1);
  const id2 = firstId(h2.service);
  h2.service.reportMovementOutcome(id2, 'no-path', 2);
  assert.equal(h2.calls.noPath.length, 1);
  assert.equal(h2.service.get(id2).state, MobState.RETURNING);
});

test('death -> corpse -> despawn -> respawn is deterministic and keeps stable instance id', () => {
  const h = makeHarness();
  h.service.initialize(0);
  const id = firstId(h.service);
  h.service.applyHealth(id, 0, 1000, { sourceId: 'fixture:test' });
  assert.equal(h.service.get(id).state, MobState.DEAD);
  h.service.tick(1001);
  assert.equal(h.service.get(id).state, MobState.CORPSE);
  h.service.tick(3999);
  assert.equal(h.service.get(id).state, MobState.CORPSE);
  h.service.tick(4000);
  assert.equal(h.service.get(id).state, MobState.DESPAWNED);
  h.service.tick(10999);
  assert.equal(h.service.get(id).state, MobState.DESPAWNED);
  h.service.tick(11000);
  const respawned = h.service.get(id);
  assert.equal(respawned.id, id);
  assert.equal(respawned.spawnEpoch, 1);
  assert.equal(respawned.state, MobState.IDLE);
  assert.equal(respawned.hp, respawned.maxHp);
});

test('optional patrol emits intent only when a source/fixture path exists', () => {
  const def = clone(fixture);
  def.spawnGroups[0].spawns[0].patrolPath = [
    { x: 100, y: 0, z: 100, heading: 0 },
    { x: 101, y: 0, z: 101, heading: 0 },
  ];
  const h = makeHarness({ definition: def });
  h.service.initialize(0);
  h.service.tick(1);
  assert.equal(h.service.get('fixture:moradon-training-group-a/a1').state, MobState.PATROLLING);
  assert.equal(h.calls.patrol.length, 1);
});

test('region visibility hooks are deterministic for player enter/leave and multiple players', () => {
  const visible = (player, mob) => String(player.regionId) === String(Math.floor(mob.position.x / 10));
  const h = makeHarness({ visible });
  h.service.initialize(0);
  const b = { id: 'player-b', zoneId: 'fixture:moradon', regionId: 10 };
  const a = { id: 'player-a', zoneId: 'fixture:moradon', regionId: 10 };
  assert.equal(h.service.playerEnteredRegion(b, 1).length, 2);
  assert.equal(h.service.playerEnteredRegion(a, 2).length, 2);
  h.calls.nearbySpawn.length = 0;
  h.service.syncPosition(firstId(h.service), { x: 120, y: 0, z: 100, heading: 0 }, 3);
  assert.deepEqual(h.calls.nearbyDespawn.map((e) => e.player.id).slice(-2), ['player-a', 'player-b']);
  assert.equal(h.service.playerLeftRegion('player-a', 4).length, 1, 'one remaining visible mob despawns for leaving player');
  assert.equal(h.service.stats().trackedPlayers, 1);
});

test('verified group/family assist is modeled as a source-backed world signal without guessed propagation', () => {
  const world = loadVerifiedWorldDefinition(moradonVerified);
  const firstGroup = world.spawnGroups.find((g) => g.templateId === 'ko1298:monster:750');
  const one = { ...world, spawnGroups: [{ ...firstGroup, spawns: [firstGroup.spawns[0]] }] };
  const spawn = firstGroup.spawns[0];
  const p = { id: 'p1', zoneId: '21', position: { x: spawn.x + 1, y: 1, z: spawn.z } };
  const h = makeHarness({
    definition: one, candidates: [p], targets: [p],
    resolveHeight: () => ({ status: 'authoritative', height: 1, surface: 'terrain', policy: 'test-authority' }),
  });
  h.service.initialize(0);
  h.service.tick(1);
  assert.equal(h.calls.assistSignal.length, 1);
  assert.equal(h.calls.assistSignal[0].group, 0);
  assert.equal(h.calls.assistSignal[0].family, 7);
  assert.equal(h.calls.assistSignal[0].searchRange, 3);
});

test('verified Moradon loader preserves 10 templates, 20 source rows and 135 deterministic X/Z slots', () => {
  const worldA = loadVerifiedWorldDefinition(moradonVerified);
  const worldB = loadVerifiedWorldDefinition(moradonVerified);
  const countA = worldA.spawnGroups.reduce((n, g) => n + g.spawns.length, 0);
  assert.equal(moradonVerified.monsters.length, 10);
  assert.equal(moradonVerified.spawnRows.length, 20);
  assert.equal(worldA.templates.length, 10);
  assert.equal(worldA.spawnGroups.length, 20);
  assert.equal(countA, 135);
  assert.equal(worldA.dataClass, 'real');
  assert.equal(worldA.zoneId, '21');
  assert.equal(worldA.templates.find((t) => t.templateId === 'ko1298:monster:750').maxHp, 7);
  assert.equal(worldA.templates.find((t) => t.templateId === 'ko1298:monster:750').aggroRange, 3);
  assert.equal(worldA.templates.find((t) => t.templateId === 'ko1298:monster:750').leashRange, 40);
  assert.deepEqual(worldA.spawnGroups[0].spawns.map((s) => [s.x, s.z]), worldB.spawnGroups[0].spawns.map((s) => [s.x, s.z]));
  assert.equal(worldA.spawnGroups[0].spawns[0].y, null);
  assert.equal(worldA.spawnGroups[0].spawns[0].corpseDespawnMs, 30000);
  assert.equal(worldA.spawnGroups[0].spawns[0].respawnDelayMs, 30000);

  for (const group of worldA.spawnGroups) {
    for (const spawn of group.spawns) {
      const area = spawn.sourceArea;
      assert.ok(spawn.x >= Math.min(area.leftX, area.rightX) && spawn.x <= Math.max(area.leftX, area.rightX));
      assert.ok(spawn.z >= Math.min(area.topZ, area.bottomZ) && spawn.z <= Math.max(area.topZ, area.bottomZ));
    }
  }
});

test('verified loader rejects duplicate spawn rows and wrong-zone rows', () => {
  const dup = clone(moradonVerified);
  dup.spawnRows.push(clone(dup.spawnRows[0]));
  assert.throws(() => loadVerifiedWorldDefinition(dup), /duplicate verified spawn rowId/);

  const wrongZone = clone(moradonVerified);
  wrongZone.spawnRows[0].zoneId = 1;
  assert.throws(() => loadVerifiedWorldDefinition(wrongZone), /does not match world zone 21/);
});

test('real spawns fail closed unless terrain.resolveHeight is authoritative', () => {
  const world = loadVerifiedWorldDefinition(moradonVerified);
  const noResolver = makeHarness({ definition: world });
  assert.throws(() => noResolver.service.initialize(0), /requires authoritative terrain height/);

  const unresolved = makeHarness({
    definition: world,
    resolveHeight: () => ({ status: 'unresolved', reason: 'shape-not-ready' }),
  });
  assert.throws(() => unresolved.service.initialize(0), /unresolved:shape-not-ready/);
  assert.equal(unresolved.calls.spawn.length, 0);

  const resolved = makeHarness({
    definition: world,
    resolveHeight: (zoneId) => {
      assert.equal(zoneId, 21);
      return { status: 'authoritative', height: 12.5, surface: 'shape', policy: 'test-authority' };
    },
  });
  const mobs = resolved.service.initialize(0);
  assert.equal(mobs.length, 135);
  assert.equal(mobs.every((m) => m.position.y === 12.5), true);
  assert.equal(mobs.every((m) => m.home.y === 12.5), true);
  assert.equal(mobs.every((m) => m.spawnOrigin.y === 12.5), true);
  assert.equal(mobs.every((m) => m.position.x === m.spawnAnchor.x && m.position.z === m.spawnAnchor.z), true);
  assert.equal(mobs.every((m) => m.heightAuthority.status === 'authoritative'), true);
});

test('real respawn keeps deterministic rectangle X/Z, re-resolves Y and defers non-authoritative height', () => {
  const world = loadVerifiedWorldDefinition(moradonVerified);
  const firstGroup = world.spawnGroups[0];
  const one = { ...world, spawnGroups: [{ ...firstGroup, spawns: [firstGroup.spawns[0]] }] };
  const answers = [
    { status: 'authoritative', height: 10, surface: 'terrain', policy: 'test-authority' },
    { status: 'unresolved', reason: 'temporary-height-gap' },
    { status: 'authoritative', height: 11, surface: 'shape', policy: 'test-authority' },
  ];
  let calls = 0;
  const h = makeHarness({
    definition: one,
    resolveHeight: () => answers[calls++],
  });
  const initial = h.service.initialize(0)[0];
  const anchor = { ...initial.spawnAnchor };
  assert.equal(initial.position.y, 10);
  assert.deepEqual(initial.position, initial.home);
  assert.deepEqual(initial.position, initial.spawnOrigin);

  h.service.applyHealth(initial.id, 0, 1);
  h.service.tick(2);
  h.service.tick(30001);
  assert.equal(h.service.get(initial.id).state, MobState.DESPAWNED);
  h.service.tick(30002);
  assert.equal(h.service.get(initial.id).state, MobState.DESPAWNED);
  assert.equal(h.service.get(initial.id).spawnEpoch, 0);
  assert.equal(h.calls.state.at(-1).event.type, 'respawn-deferred-height');
  h.service.tick(30003);
  const respawned = h.service.get(initial.id);
  assert.equal(respawned.state, MobState.IDLE);
  assert.equal(respawned.spawnEpoch, 1);
  assert.equal(respawned.position.y, 11);
  assert.deepEqual(respawned.position, respawned.home);
  assert.deepEqual(respawned.position, respawned.spawnOrigin);
  assert.deepEqual(respawned.spawnAnchor, anchor);
  assert.equal(respawned.position.x, anchor.x);
  assert.equal(respawned.position.z, anchor.z);
  assert.equal(calls, 3);
});

test('real AI chase/return intents use the same authoritative home coordinate basis', () => {
  const world = loadVerifiedWorldDefinition(moradonVerified);
  const firstGroup = world.spawnGroups.find((g) => g.templateId === 'ko1298:monster:750');
  const spawn = firstGroup.spawns[0];
  const one = { ...world, spawnGroups: [{ ...firstGroup, spawns: [spawn] }] };
  const p = { id: 'p1', zoneId: '21', position: { x: spawn.x + 2, y: 5, z: spawn.z } };
  const h = makeHarness({
    definition: one,
    candidates: [p],
    targets: [p],
    canAttack: () => false,
    resolveHeight: () => ({ status: 'authoritative', height: 5, surface: 'terrain', policy: 'test-authority' }),
  });
  h.service.initialize(0);
  h.service.tick(1);
  const mob = h.service.get(firstId(h.service));
  assert.equal(mob.state, MobState.CHASING);
  assert.deepEqual(h.calls.chase.at(-1).home, mob.home);
  assert.deepEqual(mob.spawnOrigin, mob.home);
  h.service.syncPosition(mob.id, { x: mob.home.x + 50, y: mob.home.y, z: mob.home.z, heading: 0 }, 2);
  h.service.tick(3);
  assert.equal(h.service.get(mob.id).state, MobState.RETURNING);
  assert.deepEqual(h.calls.returnHome.at(-1).home, mob.home);
});

test('WS31 catalog loader validates canonical name/level against verified K_MONSTER stats', () => {
  const ws31 = [{
    id: 100, name: 'Kecoon', category: 'MONSTER', level: 6, confidence: 'HIGH',
    source: [{ kind: 'DB_K_MONSTER', ref: 'Open-KO/OpenKO-db@bec619466938d278339c30e5b1a4bff3c9413bab:ManualSetup/6_InsertData_K_MONSTER.sql' }],
  }];
  const stat = [{
    id: 100, name: 'Kecoon', resourceId: 100, level: 6, hp: 32, attackDelayMs: 1500,
    speed1: 2, speed2: 3, attackRange: 5, searchRange: 5, tracingRange: 45,
    sourceRef: 'Open-KO/OpenKO-db@bec619466938d278339c30e5b1a4bff3c9413bab:ManualSetup/6_InsertData_K_MONSTER.sql#100',
  }];
  const templates = loadWs31MonsterTemplates(ws31, stat);
  assert.equal(templates.length, 1);
  assert.equal(templates[0].templateId, 'ko1298:monster:100');
  assert.equal(templates[0].metadata.catalogConfidence, 'HIGH');
  const bad = clone(stat); bad[0].level = 7;
  assert.throws(() => loadWs31MonsterTemplates(ws31, bad), /level mismatch/);
});

test('world definition catches duplicate spawn ids and cross-zone spawn contamination', () => {
  const dup = clone(fixture);
  dup.spawnGroups[0].spawns[1].spawnId = dup.spawnGroups[0].spawns[0].spawnId;
  assert.throws(() => validateWorldDefinition(dup), /duplicate spawnId/);
  const zone = clone(fixture);
  zone.spawnGroups[0].zoneId = 'fixture:wrong';
  assert.throws(() => validateWorldDefinition(zone), /zoneId must match world zoneId/);
});

test('deterministic scheduler executes exact fixed ticks with no wall-clock timers', () => {
  const h = makeHarness();
  const scheduler = new DeterministicMobScheduler(h.service, { tickIntervalMs: 50 });
  scheduler.initialize(1000);
  assert.equal(scheduler.advanceTo(1049).executed, 0);
  assert.equal(scheduler.advanceTo(1150).executed, 3);
  assert.equal(scheduler.snapshot().tickCount, 3);
  assert.equal(scheduler.snapshot().nextTickAt, 1200);
});

test('100/500/1000 mob deterministic tick simulation completes without timer flakiness', (t) => {
  for (const count of [100, 500, 1000]) {
    const def = largeDefinition(count);
    const h = makeHarness({ definition: def });
    const scheduler = new DeterministicMobScheduler(h.service, { tickIntervalMs: 100 });
    const start = performance.now();
    scheduler.initialize(0);
    scheduler.advanceTo(5000);
    const elapsed = performance.now() - start;
    assert.equal(h.service.stats().mobCount, count);
    assert.equal(scheduler.snapshot().tickCount, 50);
    t.diagnostic(`${count} mobs x 50 ticks: ${elapsed.toFixed(2)} ms`);
  }
});

test('multiple-player acquisition stays deterministic at scale', () => {
  const def = largeDefinition(100);
  const p2 = { id: 'p2', zoneId: 'fixture:load', position: { x: 1, y: 0, z: 1 } };
  const p1 = { id: 'p1', zoneId: 'fixture:load', position: { x: 1, y: 0, z: 1 } };
  const h = makeHarness({ definition: def, candidates: [p2, p1], targets: [p2, p1] });
  h.service.initialize(0);
  h.service.tick(1);
  const targeted = h.service.list().filter((m) => m.targetId !== null);
  assert.equal(targeted.length > 0, true);
  assert.equal(targeted.every((m) => m.targetId === 'p1'), true);
});

test('500-mob death/respawn churn cleans target/death state without growing instance maps', () => {
  const def = largeDefinition(500);
  const h = makeHarness({ definition: def });
  h.service.initialize(0);
  const ids = h.service.list().map((m) => m.id);
  for (const id of ids) h.service.applyHealth(id, 0, 10);
  h.service.tick(11);
  assert.equal(h.service.stats().states[MobState.CORPSE], 500);
  h.service.tick(110);
  assert.equal(h.service.stats().states[MobState.DESPAWNED], 500);
  h.service.tick(310);
  const list = h.service.list();
  assert.equal(h.service.stats().mobCount, 500);
  assert.equal(list.every((m) => m.state === MobState.IDLE && m.hp === m.maxHp && m.targetId === null && m.diedAt === null && m.respawnAt === null), true);
  assert.equal(list.every((m) => m.spawnEpoch === 1), true);
});

test('player visibility state is cleaned when players leave', () => {
  const visible = () => true;
  const h = makeHarness({ visible });
  h.service.initialize(0);
  for (let i = 0; i < 50; i += 1) h.service.playerEnteredRegion({ id: `p${i}`, zoneId: 'fixture:moradon', regionId: 1 }, 1);
  assert.equal(h.service.stats().trackedPlayers, 50);
  for (let i = 0; i < 50; i += 1) h.service.playerLeftRegion(`p${i}`, 2);
  assert.equal(h.service.stats().trackedPlayers, 0);
});
