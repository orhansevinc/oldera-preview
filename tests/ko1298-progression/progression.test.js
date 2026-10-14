const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEATH_STATE,
  VERIFIED_MAX_LEVEL_1298,
  VERIFIED_RESPAWN_BLINK_MS_1298,
  ProgressionError,
  ProgressionService,
  Verified1298PveDeathLossPolicy,
  compute1298LevelPointRewards,
} = require('../../services/ko1298-progression');

// Synthetic fixture only. Production XP thresholds remain a verified-data adapter.
function syntheticLevelTable() {
  const caps = new Map();
  for (let level = 1; level <= VERIFIED_MAX_LEVEL_1298; level += 1) caps.set(level, BigInt(level * 100));
  return {
    getMaxLevel: () => VERIFIED_MAX_LEVEL_1298,
    getLevelXpCap: (level) => caps.get(level),
  };
}

function harness(overrides = {}) {
  const levelUps = [];
  const vitals = [];
  const respawnVitals = [];
  const movementResets = [];
  const rewards = overrides.rewards || new Map();
  const service = new ProgressionService({
    levelTable: overrides.levelTable || syntheticLevelTable(),
    levelRewardPort: overrides.levelRewardPort || {
      onLevelUp(e) { levelUps.push(e); return { delegated: true }; },
    },
    vitalsPort: overrides.vitalsPort || {
      recalculateOnLevelChange(e) { vitals.push(e); return { recalculated: true }; },
    },
    killRewardPort: overrides.killRewardPort || {
      resolveXp(kill) { return rewards.has(kill.eventId) ? rewards.get(kill.eventId) : (kill.syntheticXp ?? 0n); },
    },
    partyXpPort: overrides.partyXpPort || {
      allocate({ baseXp, members }) {
        const each = baseXp / BigInt(members.length);
        return members.map((m) => ({ characterId: m.characterId, xp: each }));
      },
    },
    respawnPointPort: overrides.respawnPointPort || {
      resolve: ({ zoneId }) => ({ zoneId, x: 100, z: 100, pointId: 'synthetic-test-spawn' }),
    },
    respawnVitalsPort: overrides.respawnVitalsPort || {
      restoreOnRespawn(e) { respawnVitals.push(e); return { hp: 'max', mp: 'preserve' }; },
    },
    movementBaselinePort: overrides.movementBaselinePort || {
      resetOnRespawn(e) { movementResets.push(e); return { reset: true }; },
    },
    deathLossPolicy: overrides.deathLossPolicy || new Verified1298PveDeathLossPolicy(),
    nationPointPort: overrides.nationPointPort || null,
    clock: overrides.clock || (() => 1_000_000),
  });
  return { service, levelUps, vitals, respawnVitals, movementResets };
}

function state(level = 1, experience = 0n, extra = {}) {
  return {
    characterId: extra.characterId || 'char-1',
    level,
    experience,
    deathState: extra.deathState || DEATH_STATE.ALIVE,
    death: extra.death || null,
    version: extra.version ?? 0,
    appliedEventIds: extra.appliedEventIds || [],
    respawnRequest: extra.respawnRequest || null,
    immunityUntilMs: extra.immunityUntilMs ?? null,
    ...(extra.hp !== undefined ? { hp: extra.hp } : {}),
    ...(extra.maxHp !== undefined ? { maxHp: extra.maxHp } : {}),
    ...(extra.mp !== undefined ? { mp: extra.mp } : {}),
    ...(extra.maxMp !== undefined ? { maxMp: extra.maxMp } : {}),
  };
}

function kill(eventId, syntheticXp, extra = {}) {
  return { eventId, syntheticXp, mobInstanceId: `mob-${eventId}`, mobTemplateId: 101, killerCharacterId: 'char-1', zoneId: 21, ...extra };
}

test('verified target max level is 80 and mismatched table fails closed', () => {
  assert.equal(VERIFIED_MAX_LEVEL_1298, 80);
  const { service } = harness({ levelTable: { getMaxLevel: () => 70, getLevelXpCap: () => 100n } });
  assert.throws(() => service.applyExperienceDelta(state(), 1n),
    (e) => e instanceof ProgressionError && e.code === 'INVALID_LEVEL_TABLE');
});

test('exact XP threshold boundary levels once and carries remainder', () => {
  const { service } = harness();
  const result = service.awardMonsterKill(state(1, 90n), kill('boundary', 10n));
  assert.equal(result.state.level, 2);
  assert.equal(result.state.experience, 0n);
  assert.equal(result.events.filter((e) => e.type === 'progression.level_up').length, 1);
});

test('single reward event never grants multiple levels even with mass XP', () => {
  const { service, levelUps } = harness();
  const result = service.awardMonsterKill(state(1, 90n), kill('mass-one-event', 1000n));
  assert.equal(result.state.level, 2);
  assert.equal(result.state.experience, 990n);
  assert.equal(levelUps.length, 1);
});

test('subsequent reward events can consume carried XP one level per event', () => {
  const { service } = harness();
  let current = service.awardMonsterKill(state(1, 90n), kill('m1', 1000n)).state;
  current = service.awardMonsterKill(current, kill('m2', 1n)).state;
  assert.equal(current.level, 3);
  assert.equal(current.experience, 791n);
});

test('max-level XP saturates instead of overflowing', () => {
  const { service } = harness();
  const result = service.applyExperienceDelta(state(80, 7990n), 999999999999999999999999n);
  assert.equal(result.state.experience, 8000n);
  assert.ok(result.events.some((e) => e.type === 'progression.xp_saturated' && e.discardedXp > 0n));
});

test('unsafe numeric and negative kill XP are rejected', () => {
  const { service } = harness();
  assert.throws(() => service.applyExperienceDelta(state(), Number.MAX_SAFE_INTEGER + 1),
    (e) => e instanceof ProgressionError && e.code === 'INVALID_XP');
  const negative = harness({ killRewardPort: { resolveXp: () => -1n } }).service;
  assert.throws(() => negative.awardMonsterKill(state(), kill('negative', 0n)),
    (e) => e instanceof ProgressionError && e.code === 'INVALID_XP');
});

test('invalid level-table cap fails closed', () => {
  const bad = syntheticLevelTable();
  bad.getLevelXpCap = () => 0n;
  const { service } = harness({ levelTable: bad });
  assert.throws(() => service.applyExperienceDelta(state(), 1n),
    (e) => e instanceof ProgressionError && e.code === 'INVALID_LEVEL_TABLE');
});

test('level-up point rule matches verified conditional +3 stat and +2 skill semantics', () => {
  assert.deepEqual(compute1298LevelPointRewards({
    toLevel: 10,
    unspentStatPoints: 0,
    baseStatTotal: 300,
    skillPointTotal: 0,
  }), { statPointGain: 3, skillPointGain: 2, statThreshold: 327, skillThreshold: 2 });
  assert.deepEqual(compute1298LevelPointRewards({
    toLevel: 10,
    unspentStatPoints: 27,
    baseStatTotal: 300,
    skillPointTotal: 2,
  }), { statPointGain: 0, skillPointGain: 0, statThreshold: 327, skillThreshold: 2 });
});

test('level mutation calls reward/vitals ports and emits client sync contract', () => {
  const { service, levelUps, vitals } = harness();
  const result = service.awardMonsterKill(state(9, 899n), kill('level10', 1n), {
    pointSnapshot: { unspentStatPoints: 0, baseStatTotal: 300, skillPointTotal: 0 },
  });
  assert.equal(result.state.level, 10);
  assert.equal(levelUps.length, 1);
  assert.deepEqual(levelUps[0].pointAward, { statPointGain: 3, skillPointGain: 2, statThreshold: 327, skillThreshold: 2 });
  assert.equal(vitals.length, 1);
  assert.ok(result.events.some((e) => e.type === 'progression.client_sync_required' && e.reason === 'level_change'));
});

test('duplicate kill reward is replay-safe and grants XP once', () => {
  const { service } = harness();
  const first = service.awardMonsterKill(state(1, 0n), kill('dup-kill', 50n));
  const replay = service.awardMonsterKill(first.state, kill('dup-kill', 50n));
  assert.equal(replay.replay, true);
  assert.equal(replay.state.experience, 50n);
  assert.equal(replay.state.version, first.state.version);
  assert.ok(replay.events.some((e) => e.type === 'progression.replay_ignored'));
});

test('party XP split is delegated and applied per member', () => {
  const { service } = harness({
    killRewardPort: { resolveXp: () => 100n },
    partyXpPort: { allocate: ({ members }) => [
      { characterId: members[0].characterId, xp: 70n },
      { characterId: members[1].characterId, xp: 30n },
    ] },
  });
  const result = service.awardPartyMonsterKill([
    state(1, 0n, { characterId: 'a' }),
    state(1, 0n, { characterId: 'b' }),
  ], kill('party', 0n));
  assert.equal(result[0].state.experience, 70n);
  assert.equal(result[1].state.experience, 30n);
});

test('malformed party allocation fails closed', () => {
  const { service } = harness({
    killRewardPort: { resolveXp: () => 100n },
    partyXpPort: { allocate: () => [{ characterId: 'a', xp: 100n }] },
  });
  assert.throws(() => service.awardPartyMonsterKill([
    state(1, 0n, { characterId: 'a' }), state(1, 0n, { characterId: 'b' }),
  ], kill('bad-party', 0n)), (e) => e instanceof ProgressionError && e.code === 'INVALID_PARTY_ALLOCATION');
});

test('verified 1% PvE death loss is applied only when adapter identifies divisor 100', () => {
  const { service } = harness();
  const result = service.markDead(state(10, 500n), {
    eventId: 'death-1pct', kind: 'monster', killerId: 'mob', zoneId: 21, xpLossDivisor: 100,
  });
  assert.equal(result.state.deathState, DEATH_STATE.DEAD);
  assert.equal(result.state.experience, 490n);
});

test('verified 5% PvE death branch can be selected explicitly', () => {
  const { service } = harness();
  const result = service.markDead(state(10, 500n), {
    eventId: 'death-5pct', kind: 'monster', zoneId: 21, xpLossDivisor: 20,
  });
  assert.equal(result.state.experience, 450n);
});

test('death-loss mapping is fail-closed when combat/zone adapter did not identify a verified branch', () => {
  const { service } = harness();
  const result = service.markDead(state(10, 500n), { eventId: 'death-unknown', kind: 'monster', zoneId: 21 });
  assert.equal(result.state.experience, 500n);
});

test('levels below six do not lose PvE death XP', () => {
  const { service } = harness();
  const result = service.markDead(state(5, 123n), {
    eventId: 'death-low', kind: 'monster', zoneId: 1, xpLossDivisor: 20,
  });
  assert.equal(result.state.experience, 123n);
});

test('zone/rules layer can suppress death XP loss', () => {
  const { service } = harness();
  const result = service.markDead(state(10, 500n), {
    eventId: 'death-suppress', kind: 'monster', zoneId: 999, xpLossDivisor: 20,
  }, { allowXpLoss: false });
  assert.equal(result.state.experience, 500n);
});

test('death loss can delevel once and recalculates vitals', () => {
  const { service, vitals } = harness({ deathLossPolicy: { computeLoss: () => 20n } });
  const result = service.markDead(state(6, 5n), { eventId: 'delevel', kind: 'monster', zoneId: 1 });
  assert.equal(result.state.level, 5);
  assert.equal(result.state.experience, 485n);
  assert.equal(vitals.length, 1);
  assert.ok(result.events.some((e) => e.type === 'progression.level_down'));
});

test('duplicate death while already dead is ignored without second loss or version mutation', () => {
  const { service } = harness();
  const first = service.markDead(state(10, 500n), {
    eventId: 'death-once', kind: 'monster', xpLossDivisor: 100,
  });
  const duplicate = service.markDead(first.state, {
    eventId: 'different-delivery', kind: 'monster', xpLossDivisor: 100,
  });
  assert.equal(duplicate.state.experience, first.state.experience);
  assert.equal(duplicate.state.version, first.state.version);
  assert.ok(duplicate.events.some((e) => e.type === 'progression.death_ignored'));
});

test('nation point behavior remains an owner handoff and item loss is absent', () => {
  const calls = [];
  const { service } = harness({ nationPointPort: { onDeath(payload) { calls.push(payload); return { delegated: true }; } } });
  const result = service.markDead(state(10, 500n), { eventId: 'pvp-death', kind: 'player', killerId: 'enemy', zoneId: 201 });
  assert.equal(calls.length, 1);
  assert.equal(result.events.find((e) => e.type === 'progression.nation_point_handoff').result.delegated, true);
  assert.equal(result.events.some((e) => /item/i.test(e.type)), false);
});

test('respawn has explicit request state before completion', () => {
  const { service } = harness();
  const dead = service.markDead(state(7, 400n), { eventId: 'd-respawn', kind: 'monster', zoneId: 21 }).state;
  const requested = service.requestRespawn(dead, { requestId: 'r1' });
  assert.equal(requested.state.deathState, DEATH_STATE.RESPAWN_REQUESTED);
  assert.deepEqual(requested.state.respawnRequest.point, { zoneId: 21, x: 100, z: 100, pointId: 'synthetic-test-spawn' });
});

test('repeated respawn request is ignored idempotently', () => {
  const { service } = harness();
  const dead = service.markDead(state(7, 400n), { eventId: 'd-repeat', kind: 'monster', zoneId: 21 }).state;
  const requested = service.requestRespawn(dead, { requestId: 'r-repeat' });
  const repeated = service.requestRespawn(requested.state, { requestId: 'r-new' });
  assert.equal(repeated.replay, true);
  assert.equal(repeated.state.version, requested.state.version);
  assert.ok(repeated.events.some((e) => e.type === 'progression.respawn_request_ignored'));
});

test('normal respawn restores HP, preserves MP, resets movement and starts verified 10s blink immunity', () => {
  const { service, respawnVitals, movementResets } = harness({ clock: () => 5_000 });
  const dead = service.markDead(state(7, 400n, { hp: 0, maxHp: 900, mp: 123, maxMp: 500 }),
    { eventId: 'd-complete', kind: 'monster', zoneId: 21 }).state;
  const requested = service.requestRespawn(dead, { requestId: 'r-complete' }).state;
  const result = service.completeRespawn(requested, { nowMs: 5_000 });
  assert.equal(result.state.deathState, DEATH_STATE.ALIVE);
  assert.equal(result.state.hp, 900);
  assert.equal(result.state.mp, 123);
  assert.equal(result.state.immunityUntilMs, 5_000 + VERIFIED_RESPAWN_BLINK_MS_1298);
  assert.equal(respawnVitals.length, 1);
  assert.equal(movementResets.length, 1);
});

test('dead blocks movement/combat; blinking respawn blocks combat but not movement', () => {
  const { service } = harness();
  const dead = service.markDead(state(7, 400n), { eventId: 'd-guard', kind: 'monster', zoneId: 21 }).state;
  assert.throws(() => service.assertGameplayAllowed(dead, 'movement'),
    (e) => e instanceof ProgressionError && e.code === 'DEAD_ACTION_FORBIDDEN');
  assert.throws(() => service.assertGameplayAllowed(dead, 'combat'),
    (e) => e instanceof ProgressionError && e.code === 'DEAD_ACTION_FORBIDDEN');
  const alive = service.respawn(dead, { requestId: 'r-guard' }, { nowMs: 1_000 }).state;
  assert.equal(service.assertGameplayAllowed(alive, 'movement', { nowMs: 1_001 }), true);
  assert.throws(() => service.assertGameplayAllowed(alive, 'combat', { nowMs: 1_001 }),
    (e) => e instanceof ProgressionError && e.code === 'RESPAWN_IMMUNITY');
  assert.equal(service.assertGameplayAllowed(alive, 'combat', { nowMs: 11_000 }), true);
});

test('disconnect/reconnect persistence preserves dead state and replay ledger', () => {
  const { service } = harness();
  const dead = service.markDead(state(10, 500n), {
    eventId: 'persist-death', kind: 'monster', xpLossDivisor: 100,
  }).state;
  const snapshot = service.toPersistenceSnapshot(dead);
  const restored = service.restorePersistenceSnapshot(JSON.parse(JSON.stringify(snapshot)));
  assert.equal(restored.deathState, DEATH_STATE.DEAD);
  assert.equal(restored.experience, 490n);
  const replay = service.markDead(restored, {
    eventId: 'persist-death', kind: 'monster', xpLossDivisor: 100,
  });
  assert.equal(replay.replay, true);
  assert.equal(replay.state.experience, 490n);
});

test('optimistic version contract rejects stale simultaneous mutation', () => {
  const { service } = harness();
  const base = state(1, 0n, { version: 7 });
  const first = service.awardMonsterKill(base, kill('cas-1', 10n), { expectedVersion: 7 });
  assert.deepEqual(first.persistence.expectedVersion, 7);
  assert.deepEqual(first.persistence.nextVersion, 8);
  assert.throws(() => service.awardMonsterKill(first.state, kill('cas-2', 10n), { expectedVersion: 7 }),
    (e) => e instanceof ProgressionError && e.code === 'VERSION_CONFLICT');
});

test('1000 deterministic kill progression simulation is stable and capped', () => {
  function run() {
    const { service } = harness();
    let current = state(1, 0n);
    for (let i = 0; i < 1000; i += 1) {
      current = service.awardMonsterKill(current, kill(`sim-${i}`, BigInt(25 + (i % 17)))).state;
    }
    return service.toPersistenceSnapshot(current);
  }
  const a = run();
  const b = run();
  assert.deepEqual(a, b);
  assert.ok(a.level >= 1 && a.level <= VERIFIED_MAX_LEVEL_1298);
  assert.equal(a.version, 1000);
});
