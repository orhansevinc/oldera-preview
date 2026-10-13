'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('../../world-data/mobs/fixtures/moradon-lifecycle.fixture.json');
const { MobService, MobState, validateWorldDefinition } = require('../../services/ko1298-mobs');

function makeHarness(overrides = {}) {
  const calls = { spawn: [], state: [], despawn: [], chase: [], returnHome: [], stop: [] };
  let candidates = overrides.candidates ?? [];
  const targets = new Map((overrides.targets ?? []).map((target) => [String(target.id), target]));
  const service = new MobService(fixture, {
    world: {
      listAggroCandidates: () => candidates,
      getTargetSnapshot: (id) => targets.get(String(id)) ?? null,
      onMobSpawn: (mob, event) => calls.spawn.push({ mob, event }),
      onMobStateChange: (mob, event) => calls.state.push({ mob, event }),
      onMobDespawn: (mob, event) => calls.despawn.push({ mob, event }),
    },
    movement: {
      chase: (intent) => calls.chase.push(intent),
      returnHome: (intent) => calls.returnHome.push(intent),
      stop: (intent) => calls.stop.push(intent),
    },
    combat: {
      isTargetAlive: overrides.isTargetAlive ?? (() => true),
      canAggro: overrides.canAggro ?? (() => true),
    },
  });
  return {
    calls,
    service,
    targets,
    setCandidates(value) { candidates = value; },
  };
}

function firstId(service) {
  return service.list()[0].id;
}

function target(id, x, z, extra = {}) {
  return { id, zoneId: 'fixture:moradon', position: { x, y: 0, z }, ...extra };
}

test('fixture data is explicitly separated from real data and creates stable spawn ids', () => {
  const definition = validateWorldDefinition(fixture);
  assert.equal(definition.dataClass, 'fixture');
  const h = makeHarness();
  const mobs = h.service.initialize(0);
  assert.deepEqual(mobs.map((mob) => mob.id), [
    'fixture:moradon-training-group-a/a1',
    'fixture:moradon-training-group-a/a2',
  ]);
  assert.equal(h.calls.spawn.length, 2);
  assert.equal(mobs[0].state, MobState.IDLE);
  assert.equal(mobs[0].hp, 120);
});

test('target selection is deterministic: nearest candidate wins, id breaks ties', () => {
  const beta = target('beta', 103, 100);
  const alpha = target('alpha', 103, 100);
  const farther = target('farther', 107, 100);
  const h = makeHarness({ candidates: [beta, farther, alpha], targets: [beta, farther, alpha] });
  h.service.initialize(0);
  const mobId = firstId(h.service);
  h.service.tick(100);
  const mob = h.service.get(mobId);
  assert.equal(mob.state, MobState.CHASING);
  assert.equal(mob.targetId, 'alpha');
  assert.equal(h.calls.chase.length, 2, 'both fixture mobs independently acquire the same nearest target');
  assert.equal(h.calls.chase[0].targetId, 'alpha');
});

test('combat policy can veto aggro without importing combat implementation', () => {
  const candidate = target('player-1', 101, 100);
  const h = makeHarness({
    candidates: [candidate],
    targets: [candidate],
    canAggro: () => false,
  });
  h.service.initialize(0);
  h.service.tick(10);
  assert.equal(h.service.get(firstId(h.service)).state, MobState.IDLE);
  assert.equal(h.calls.chase.length, 0);
});

test('leash violation transitions to returning and delegates movement', () => {
  const candidate = target('player-1', 101, 100);
  const h = makeHarness({ candidates: [candidate], targets: [candidate] });
  h.service.initialize(0);
  h.service.tick(1);
  const mobId = firstId(h.service);
  h.service.syncPosition(mobId, { x: 120, y: 0, z: 100, heading: 0 }, 2);
  h.service.tick(3);
  const mob = h.service.get(mobId);
  assert.equal(mob.state, MobState.RETURNING);
  assert.equal(mob.targetId, null);
  assert.equal(h.calls.returnHome.length, 1);
  assert.equal(h.calls.returnHome[0].reason, 'mob-leash-exceeded');
});

test('return-home completes only after movement adapter syncs position near home', () => {
  const candidate = target('player-1', 101, 100);
  const h = makeHarness({ candidates: [candidate], targets: [candidate] });
  h.service.initialize(0);
  h.service.tick(1);
  const mobId = firstId(h.service);
  h.service.syncPosition(mobId, { x: 119, y: 0, z: 100, heading: 0 }, 2);
  h.service.tick(3);
  assert.equal(h.service.get(mobId).state, MobState.RETURNING);
  h.setCandidates([]);
  h.service.syncPosition(mobId, { x: 100.2, y: 0, z: 100, heading: 0 }, 4);
  h.service.tick(5);
  const mob = h.service.get(mobId);
  assert.equal(mob.state, MobState.IDLE);
  assert.deepEqual(mob.position, { x: 100, y: 0, z: 100, heading: 0 });
  assert.equal(h.calls.stop.at(-1).reason, 'home-reached');
});

test('death, corpse despawn and respawn are deterministic and restore home/full HP', () => {
  const h = makeHarness();
  h.service.initialize(0);
  const mobId = firstId(h.service);
  h.service.applyHealth(mobId, 0, 1000, { sourceId: 'fixture:test' });
  let mob = h.service.get(mobId);
  assert.equal(mob.state, MobState.DEAD);
  assert.equal(mob.corpseDespawnAt, 4000);
  assert.equal(mob.respawnAt, 11000);
  assert.equal(h.calls.stop.at(-1).reason, 'dead');

  h.service.tick(3999);
  assert.equal(h.service.get(mobId).state, MobState.DEAD);
  h.service.tick(4000);
  assert.equal(h.service.get(mobId).state, MobState.DESPAWNED);
  assert.equal(h.calls.despawn.length, 1);

  h.service.tick(10999);
  assert.equal(h.service.get(mobId).state, MobState.DESPAWNED);
  h.service.tick(11000);
  mob = h.service.get(mobId);
  assert.equal(mob.state, MobState.IDLE);
  assert.equal(mob.hp, 120);
  assert.equal(mob.respawnAt, null);
  assert.deepEqual(mob.position, mob.home);
  assert.equal(h.calls.spawn.filter((entry) => entry.event.type === 'respawn').length, 1);
});

test('dead target is cleared and movement is stopped without damage logic in this domain', () => {
  const candidate = target('player-1', 101, 100);
  let alive = true;
  const h = makeHarness({ candidates: [candidate], targets: [candidate], isTargetAlive: () => alive });
  h.service.initialize(0);
  h.service.tick(1);
  const mobId = firstId(h.service);
  assert.equal(h.service.get(mobId).state, MobState.CHASING);
  alive = false;
  h.setCandidates([]);
  h.service.tick(2);
  assert.equal(h.service.get(mobId).state, MobState.IDLE);
  assert.equal(h.calls.stop.at(-1).reason, 'target-invalid');
});

test('invalid timing configuration is rejected instead of creating ambiguous lifecycle', () => {
  const bad = JSON.parse(JSON.stringify(fixture));
  bad.templates[0].respawnDelayMs = 1000;
  bad.templates[0].corpseDespawnMs = 3000;
  assert.throws(() => validateWorldDefinition(bad), /respawnDelayMs must be >= corpseDespawnMs/);
});

test('real data requires provenance and fixture prefixes are enforced', () => {
  const badFixture = JSON.parse(JSON.stringify(fixture));
  badFixture.templates[0].templateId = '9999';
  badFixture.spawnGroups[0].templateId = '9999';
  assert.throws(() => validateWorldDefinition(badFixture), /fixture templateId must start with fixture:/);

  const real = JSON.parse(JSON.stringify(fixture));
  real.dataClass = 'real';
  real.zoneId = 'moradon';
  real.templates[0].dataClass = 'real';
  real.templates[0].templateId = 'external:mob-template';
  delete real.templates[0].sourceRef;
  real.spawnGroups[0].groupId = 'external:group';
  real.spawnGroups[0].templateId = 'external:mob-template';
  assert.throws(() => validateWorldDefinition(real), /sourceRef is required for real data/);
});
