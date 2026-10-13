const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEATH_STATE,
  ProgressionError,
  ProgressionService,
  Verified1298PveDeathLossPolicy,
} = require('../../services/ko1298-progression');

function harness(overrides = {}) {
  const caps = new Map([[1,100n],[2,200n],[3,300n],[4,400n],[5,500n],[6,600n],[7,700n],[8,800n],[9,900n],[10,1000n]]);
  const levelUps = [];
  const service = new ProgressionService({
    levelTable: overrides.levelTable || { getMaxLevel: () => 10, getLevelXpCap: (level) => caps.get(level) },
    levelRewardPort: overrides.levelRewardPort || { onLevelUp(e) { levelUps.push(e); return { delegated: true }; } },
    partyXpPort: overrides.partyXpPort || { allocate({ baseXp, members }) { const each = baseXp / BigInt(members.length); return members.map(m => ({ characterId: m.characterId, xp: each })); } },
    respawnPointPort: overrides.respawnPointPort || { resolve: ({ zoneId }) => ({ zoneId, x: 100, z: 100, pointId: 'test-spawn' }) },
    deathLossPolicy: overrides.deathLossPolicy || new Verified1298PveDeathLossPolicy(),
    nationPointPort: overrides.nationPointPort || null,
  });
  return { service, levelUps };
}

function state(level = 1, experience = 0n, extra = {}) {
  return { characterId: extra.characterId || 'char-1', level, experience,
    deathState: extra.deathState || DEATH_STATE.ALIVE, death: extra.death || null };
}

test('mob XP crosses multiple configured level caps', () => {
  const { service, levelUps } = harness();
  const result = service.awardMonsterKill(state(1, 90n), { xp: 230n, mobInstanceId: 'm7', mobTemplateId: 101 });
  assert.equal(result.state.level, 3);
  assert.equal(result.state.experience, 20n);
  assert.deepEqual(levelUps.map(e => [e.fromLevel, e.toLevel]), [[1,2],[2,3]]);
});

test('max-level XP saturates instead of overflowing', () => {
  const { service } = harness();
  const result = service.applyExperienceDelta(state(10, 990n), 999999999999999999999999n);
  assert.equal(result.state.experience, 1000n);
  assert.ok(result.events.some(e => e.type === 'progression.xp_saturated' && e.discardedXp > 0n));
});

test('unsafe numeric XP is rejected', () => {
  const { service } = harness();
  assert.throws(() => service.applyExperienceDelta(state(), Number.MAX_SAFE_INTEGER + 1),
    e => e instanceof ProgressionError && e.code === 'INVALID_XP');
});

test('invalid level-table caps fail closed', () => {
  const { service } = harness({ levelTable: { getMaxLevel: () => 10, getLevelXpCap: () => 0n } });
  assert.throws(() => service.applyExperienceDelta(state(), 1n),
    e => e instanceof ProgressionError && e.code === 'INVALID_LEVEL_TABLE');
});

test('verified PvE death loss is 1% of configured current-level cap', () => {
  const { service } = harness();
  const result = service.markDead(state(10, 500n), { kind: 'monster', killerId: 'mob', zoneId: 21 });
  assert.equal(result.state.deathState, DEATH_STATE.DEAD);
  assert.equal(result.state.experience, 490n);
  assert.equal(result.events.find(e => e.type === 'progression.xp_changed').delta, -10n);
});

test('levels below six do not lose PvE death XP', () => {
  const { service } = harness();
  const result = service.markDead(state(5, 123n), { kind: 'monster', zoneId: 1 });
  assert.equal(result.state.experience, 123n);
});

test('zone/rules layer can suppress death XP loss', () => {
  const { service } = harness();
  const result = service.markDead(state(10, 500n), { kind: 'monster', zoneId: 999 }, { allowXpLoss: false });
  assert.equal(result.state.experience, 500n);
});

test('default policy does not guess PvP XP loss', () => {
  const { service } = harness();
  const result = service.markDead(state(10, 500n), { kind: 'player', killerId: 'enemy', zoneId: 201 });
  assert.equal(result.state.experience, 500n);
});

test('death loss may delevel level 6 to level 5', () => {
  const { service } = harness({ deathLossPolicy: { computeLoss: () => 20n } });
  const result = service.markDead(state(6, 5n), { kind: 'monster', zoneId: 1 });
  assert.equal(result.state.level, 5);
  assert.equal(result.state.experience, 485n);
  assert.ok(result.events.some(e => e.type === 'progression.level_down'));
});

test('party XP split is delegated and applied per member', () => {
  const { service } = harness({ partyXpPort: { allocate({ members }) { return [
    { characterId: members[0].characterId, xp: 70n }, { characterId: members[1].characterId, xp: 30n }
  ]; } } });
  const result = service.awardPartyMonsterKill([
    state(1, 0n, { characterId: 'a' }), state(1, 0n, { characterId: 'b' })
  ], { xp: 100n, mobTemplateId: 10 });
  assert.equal(result[0].state.experience, 70n);
  assert.equal(result[1].state.experience, 30n);
});

test('malformed party allocation fails closed', () => {
  const { service } = harness({ partyXpPort: { allocate: () => [{ characterId: 'a', xp: 100n }] } });
  assert.throws(() => service.awardPartyMonsterKill([
    state(1, 0n, { characterId: 'a' }), state(1, 0n, { characterId: 'b' })
  ], { xp: 100n }), e => e instanceof ProgressionError && e.code === 'INVALID_PARTY_ALLOCATION');
});

test('respawn resolves a point and transitions dead to alive', () => {
  const { service } = harness();
  const dead = service.markDead(state(7, 400n), { kind: 'monster', zoneId: 21 }).state;
  const result = service.respawn(dead);
  assert.equal(result.state.deathState, DEATH_STATE.ALIVE);
  assert.equal(result.state.death, null);
  assert.deepEqual(result.events[0].point, { zoneId: 21, x: 100, z: 100, pointId: 'test-spawn' });
});

test('invalid death/respawn transitions fail closed', () => {
  const { service } = harness();
  assert.throws(() => service.respawn(state()), e => e instanceof ProgressionError && e.code === 'NOT_DEAD');
  const dead = { ...state(), deathState: DEATH_STATE.DEAD, death: { kind: 'monster', zoneId: 1 } };
  assert.throws(() => service.markDead(dead, { kind: 'monster' }), e => e instanceof ProgressionError && e.code === 'ALREADY_DEAD');
});

test('nation point behavior is only a handoff port', () => {
  const calls = [];
  const { service } = harness({ nationPointPort: { onDeath(payload) { calls.push(payload); return { delegated: 'ws24' }; } } });
  const result = service.markDead(state(10, 500n), { kind: 'player', killerId: 'enemy', zoneId: 201 });
  assert.equal(calls.length, 1);
  assert.equal(result.events.find(e => e.type === 'progression.nation_point_handoff').result.delegated, 'ws24');
});
