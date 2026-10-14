'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const moradonVerified = require('../../world-data/mobs/verified/moradon-zone21.verified.json');
const { MobService, MobState, loadVerifiedWorldDefinition } = require('../../services/ko1298-mobs');

function singleWormDefinition() {
  const world = loadVerifiedWorldDefinition(moradonVerified);
  const group = world.spawnGroups.find((entry) => entry.templateId === 'ko1298:monster:750');
  return {
    ...world,
    spawnGroups: [{ ...group, spawns: [group.spawns[0]] }],
  };
}

function allocator(start = 12000) {
  let next = start;
  const bySource = new Map();
  return {
    claim(request) {
      if (!bySource.has(request.sourceIdentity)) bySource.set(request.sourceIdentity, next++);
      return bySource.get(request.sourceIdentity);
    },
  };
}

function targetNear(mob, id = 'player-1') {
  return {
    id,
    zoneId: '21',
    position: { x: mob.position.x + 1, y: mob.position.y, z: mob.position.z },
  };
}

function makeRealHarness(definition = singleWormDefinition()) {
  const visibilityEvents = [];
  const attackIntents = [];
  const targetMap = new Map();
  let heightCalls = 0;
  const visible = (player, mob) => (
    String(player.zoneId) === String(mob.zoneId)
    && player.position
    && Math.abs(player.position.x - mob.position.x) <= 48
    && Math.abs(player.position.z - mob.position.z) <= 48
  );
  const service = new MobService(definition, {
    runtimeIds: allocator(),
    terrain: {
      resolveHeight: () => {
        heightCalls += 1;
        return { status: 'authoritative', height: 11.25, surface: 'terrain', policy: 'test-authority' };
      },
    },
    world: {
      listAggroCandidates: () => [],
      getTargetSnapshot: (id) => targetMap.get(String(id)) ?? null,
      isMobVisibleToPlayer: visible,
    },
    combat: {
      isTargetAlive: (target) => target?.alive !== false,
      canAggro: () => true,
      canAttack: () => true,
      attackIntent: (intent) => attackIntents.push(intent),
    },
    visibility: {
      onEvent: (event) => visibilityEvents.push(event),
    },
  });
  return { service, targetMap, visibilityEvents, attackIntents, get heightCalls() { return heightCalls; } };
}

test('all 135 verified Moradon mobs expose targetable source-backed combat snapshots', () => {
  const world = loadVerifiedWorldDefinition(moradonVerified);
  const h = makeRealHarness(world);
  h.service.initialize(0);
  const snapshots = h.service.combatSnapshots();
  assert.equal(snapshots.length, 135);
  assert.equal(new Set(snapshots.map((entry) => entry.runtimeId)).size, 135);
  assert.equal(snapshots.every((entry) => Number.isInteger(entry.runtimeId)), true);
  assert.equal(snapshots.every((entry) => entry.position && [entry.position.x, entry.position.y, entry.position.z].every(Number.isFinite)), true);
  assert.equal(snapshots.every((entry) => entry.alive && entry.targetable && entry.attackable), true);

  const worm = snapshots.find((entry) => entry.templateId === 'ko1298:monster:750');
  assert.ok(worm);
  assert.equal(worm.level, 1);
  assert.equal(worm.hp, 7);
  assert.equal(worm.maxHp, 7);
  assert.equal(worm.mp, 25);
  assert.equal(worm.defense.ac, 5);
  assert.equal(worm.defense.evasionRate, 1);
  assert.equal(worm.attack.attack, 0, 'sAtk=0 is an exact source value, not a fallback');
  assert.equal(worm.attack.hitRate, 1);
  assert.equal(worm.attack.baseDamage, 4);
  assert.equal(worm.attack.attackDelayMs, 2000);
  assert.equal(worm.attack.attackRange, 5);
  assert.equal(worm.sourceRefs.combat.includes('Open-KO/OpenKO-db@bec619466938d278339c30e5b1a4bff3c9413bab'), true);
});

test('real Worm combat result is idempotent, retaliates, emits intent, dies once, OUTs and respawns IN at full HP', () => {
  const h = makeRealHarness();
  const [initial] = h.service.initialize(0);
  const runtimeId = initial.runtimeId;
  const sourceIdentity = initial.sourceIdentity;
  let mob = h.service.combatSnapshot(runtimeId);
  const player = targetNear(mob);
  h.targetMap.set(player.id, player);
  h.service.playerEnteredRegion(player, 1);

  const beforeRevision = mob.revision;
  const first = h.service.applyCombatResult(runtimeId, {
    absoluteTargetHp: 6,
    result: { ok: true, requestKey: 'player-hit-1', attackerId: player.id, targetId: runtimeId },
  }, 10);
  assert.equal(first.applied, true);
  assert.equal(first.retaliation, true);
  assert.equal(first.mob.hp, 6);
  assert.equal(first.mob.state, MobState.AGGRO);
  assert.equal(first.mob.revision, beforeRevision + 1, 'one accepted non-lethal combat result owns one WS25 revision');

  const duplicate = h.service.applyCombatResult(runtimeId, {
    absoluteTargetHp: 5,
    result: { ok: true, requestKey: 'player-hit-1', attackerId: player.id, targetId: runtimeId },
  }, 10.5);
  assert.equal(duplicate.applied, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.mob.hp, 6);
  assert.equal(duplicate.mob.revision, first.mob.revision);

  h.service.tick(11);
  assert.equal(h.attackIntents.length, 1);
  assert.equal(h.attackIntents[0].runtimeId, runtimeId);
  assert.equal(h.attackIntents[0].sourceAttack.sAtk, 0);
  assert.equal(h.attackIntents[0].sourceAttack.sDamage, 4);
  assert.equal(h.attackIntents[0].sourceAttack.sHitRate, 1);
  assert.equal(h.attackIntents[0].sourceAttack.sAttackDelay, 2000);
  assert.equal(h.attackIntents[0].sourceAttack.byAttackRange, 5);

  const far = { ...player, position: { x: mob.position.x + 100, y: mob.position.y, z: mob.position.z + 100 } };
  h.targetMap.set(player.id, far);
  h.service.playerEnteredRegion(far, 12);
  assert.equal(h.service.combatSnapshot(runtimeId).targetId, null, 'region crossing clears stale mob target');

  h.targetMap.set(player.id, player);
  h.service.playerEnteredRegion(player, 13);
  const second = h.service.applyCombatResult(runtimeId, {
    absoluteTargetHp: 5,
    result: { ok: true, requestKey: 'player-hit-2', attackerId: player.id, targetId: runtimeId },
  }, 14);
  assert.equal(second.retaliation, true);
  h.service.playerDisconnected(player.id, 15);
  assert.equal(h.service.combatSnapshot(runtimeId).targetId, null, 'disconnect clears mob player target');

  h.targetMap.set(player.id, player);
  h.service.playerEnteredRegion(player, 16);
  const beforeDeathRevision = h.service.combatSnapshot(runtimeId).revision;
  const death = h.service.applyCombatResult(runtimeId, {
    absoluteTargetHp: 0,
    deathEvent: { type: 'DEATH', targetId: runtimeId, killerId: player.id, sequence: 1 },
    result: { ok: true, requestKey: 'player-hit-kill', attackerId: player.id, targetId: runtimeId },
  }, 20);
  assert.equal(death.applied, true);
  assert.equal(death.deathTransition, true);
  assert.equal(death.mob.revision, beforeDeathRevision + 1, 'death result is one WS25 revision and one death transition');
  assert.equal(death.mob.state, MobState.DEAD);
  assert.equal(death.mob.alive, false);
  assert.equal(death.mob.targetable, false);
  assert.equal(death.mob.attackable, false);

  const duplicateDeath = h.service.applyCombatResult(runtimeId, {
    absoluteTargetHp: 0,
    result: { ok: true, requestKey: 'player-hit-kill', attackerId: player.id, targetId: runtimeId },
  }, 20.5);
  assert.equal(duplicateDeath.duplicate, true);
  assert.equal(duplicateDeath.mob.revision, death.mob.revision);

  h.service.tick(21);
  assert.equal(h.service.combatSnapshot(runtimeId).state, MobState.CORPSE);
  assert.equal(h.visibilityEvents.some((event) => event.type === 'STATE' && event.semantic === 'DEATH' && event.runtimeId === runtimeId), true);
  assert.equal(h.visibilityEvents.some((event) => event.type === 'STATE' && event.semantic === 'CORPSE' && event.runtimeId === runtimeId), true);

  h.service.tick(30020);
  assert.equal(h.service.combatSnapshot(runtimeId).state, MobState.DESPAWNED);
  assert.equal(h.visibilityEvents.some((event) => event.type === 'OUT' && event.scope === 'world' && event.runtimeId === runtimeId), true);

  const heightCallsBeforeRespawn = h.heightCalls;
  h.service.tick(30021);
  const respawned = h.service.combatSnapshot(runtimeId);
  assert.equal(respawned.state, MobState.IDLE);
  assert.equal(respawned.hp, respawned.maxHp);
  assert.equal(respawned.sourceIdentity, sourceIdentity);
  assert.equal(respawned.runtimeId, runtimeId);
  assert.equal(respawned.position.y, 11.25);
  assert.equal(h.heightCalls, heightCallsBeforeRespawn + 1, 'respawn re-resolves authoritative terrain height');
  assert.equal(h.visibilityEvents.some((event) => event.type === 'IN' && event.scope === 'world' && event.reason === 'respawn' && event.runtimeId === runtimeId), true);
});

test('exact pinned WS19 normal-attack core consumes the WS25 mob defense snapshot and WS25 applies only its absolute result', { skip: !process.env.WS25_WS19_COMBAT_MODULE }, () => {
  assert.equal(process.env.WS25_WS19_PROVIDER_SHA, '28eb4f38753ffbc54c60abbd2a32832301284c06');
  const ws19 = require(path.join(process.env.WS25_WS19_COMBAT_MODULE, 'index.js'));
  const h = makeRealHarness();
  const [initial] = h.service.initialize(0);
  const mob = h.service.combatSnapshot(initial.runtimeId);
  const playerSnapshot = targetNear(mob);
  h.targetMap.set(playerSnapshot.id, playerSnapshot);
  h.service.playerEnteredRegion(playerSnapshot, 1);

  const attacker = ws19.createCombatant({
    id: playerSnapshot.id,
    hp: 100,
    maxHp: 100,
    zoneId: '21',
    position: playerSnapshot.position,
    combat: { ap: 30, attackAmount: 100, hitRate: 100, evasionRate: 10 },
  });
  const target = ws19.createCombatant({
    id: mob.runtimeId,
    hp: mob.hp,
    maxHp: mob.maxHp,
    zoneId: mob.zoneId,
    position: mob.position,
    level: mob.level,
    combat: { ac: mob.combat.ac, evasionRate: mob.combat.evasionRate, hitRate: mob.combat.hitRate },
  });
  const damagePolicy = new ws19.OpenKo1298NormalAttackDamagePolicy({ rng: () => 0 });
  const combat = new ws19.CombatService({
    damagePolicy,
    rng: () => 0,
    clock: () => 100,
    requireRangeValidation: false,
    requireEquipmentSnapshot: false,
    requireAttackTimer: false,
  });
  const result = combat.normalAttack(attacker, target, { requestKey: 'ws19-player-worm-1' });
  assert.equal(result.ok, true);
  assert.ok(target.hp < mob.hp);

  const applied = h.service.applyCombatResult(mob.runtimeId, {
    result,
    absoluteTargetHp: target.hp,
    deathEvent: result.deathEvent,
  }, 100);
  assert.equal(applied.applied, true);
  assert.equal(applied.absoluteHp, target.hp);
  assert.equal(h.service.combatSnapshot(mob.runtimeId).hp, target.hp);
});
