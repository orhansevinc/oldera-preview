'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const authority = require('../../workstreams/ws19/PLAYABLE_PVE_AUTHORITY.json');
const {
  PVE_EVENT,
  PVE_RESULT,
  SLASH_RANGE_AUTHORITY,
  PlayablePveCombatService,
  calculateArmorClass,
  calculateAttackPower,
  calculateEvasionRate,
  calculateHitRate,
  calculateMaxHp,
  calculateMaxMp,
  resolveMobVsPlayerNormalAttack,
  resolvePlayerVsMobNormalAttack,
  resolvePlayerVsMobType1,
} = require('../../services/ko1298-combat');

function playerFixture(id = 'karus-warrior-3') {
  const f = authority.deterministic_player_fixture;
  const d = f.derived_combat;
  return {
    id, zoneId: 21, position: { x: 237.5, y: 0, z: 326 }, nationId: 1, classId: 101, level: 3,
    hp: d.max_hp, maxHp: d.max_hp, mp: 0, maxMp: 0, sp: d.max_resource, maxSp: d.max_resource,
    resourceKind: d.resource_kind, lifeState: 'ALIVE',
    combat: { ap: d.ap, ac: d.ac, hitRate: d.hit_rate, evasionRate: d.evasion_rate },
  };
}

function equipmentFixture() {
  const w = authority.canonical_slice.weapon;
  return { weaponRange: w.weapon_range, attackDelayMs: w.attack_delay_ms, damage: w.damage, weaponItemId: w.item_id, weaponType: w.weapon_type };
}

function mobFixture(runtimeId = 12000) {
  const m = authority.canonical_slice.mob;
  return {
    id: runtimeId, runtimeId, instanceId: runtimeId, sourceIdentity: 'ko1298:mob:21:850:test', templateId: 'ko1298:monster:850',
    zoneId: 21, position: { x: 238, y: 0, z: 326 }, level: m.level, hp: m.hp, maxHp: m.max_hp, mp: m.mp,
    defense: { ac: m.ac, evasionRate: m.evade_rate },
    attack: { attack: m.attack, hitRate: m.hit_rate, baseDamage: m.damage, attackDelayMs: m.attack_delay_ms, attackRange: m.attack_range },
    alive: true, targetable: true, attackable: true,
  };
}

function distance2d(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }

function harness({ rng = () => 0 } = {}) {
  const player = playerFixture();
  const mob = mobFixture();
  const mobLedger = new Set(), healthLedger = new Set(), resourceLedger = new Set();
  let mobDeathTransitions = 0, playerDeathTransitions = 0;
  const currentMob = () => ({ ...mob, defense: { ...mob.defense }, attack: { ...mob.attack }, position: { ...mob.position } });
  const currentPlayer = () => ({ ...player, combat: { ...player.combat }, position: { ...player.position } });
  const mobCombatPort = {
    getCombatSnapshot(identifier) { return String(identifier) === String(mob.runtimeId) || String(identifier) === String(mob.id) ? currentMob() : null; },
    applyCombatResult(identifier, result) {
      const key = `${result.attackerId ?? result.sourceId}:${result.requestKey}:${identifier}`;
      if (mobLedger.has(key)) return { applied: false, duplicate: true, mob: currentMob() };
      mobLedger.add(key);
      const before = mob.hp; mob.hp = result.absoluteTargetHp;
      const deathTransition = before > 0 && mob.hp === 0;
      if (deathTransition) { mob.alive = false; mob.targetable = false; mob.attackable = false; mobDeathTransitions += 1; }
      return { applied: true, duplicate: false, absoluteHp: mob.hp, deathTransition, mob: currentMob() };
    },
  };
  const playerCombatPort = {
    getCombatSnapshot(identifier) { return String(identifier) === String(player.id) ? currentPlayer() : null; },
    applyHealthResult(result) {
      const key = `${result.sourceId}:${result.requestKey}:${result.targetId}`;
      if (healthLedger.has(key)) return { applied: false, duplicate: true, player: currentPlayer() };
      healthLedger.add(key);
      const before = player.hp; player.hp = result.absoluteHp;
      const deathTransition = before > 0 && player.hp === 0;
      if (deathTransition) { player.lifeState = 'DEAD'; playerDeathTransitions += 1; }
      return { applied: true, duplicate: false, deathTransition, player: currentPlayer() };
    },
    applyResourceResult(result) {
      const key = `${result.sourceId}:${result.requestKey}:${result.targetId}:${result.kind}`;
      if (resourceLedger.has(key)) return { applied: false, duplicate: true, player: currentPlayer() };
      resourceLedger.add(key);
      const field = result.kind === 'SP' ? 'sp' : 'mp'; player[field] = result.absoluteValue;
      return { applied: true, duplicate: false, player: currentPlayer() };
    },
  };
  const equipmentPort = { getCombatSnapshot: () => equipmentFixture() };
  const worldPort = {
    validateAttackRange({ attacker, target, weaponRange }) { const distance = distance2d(attacker.position, target.position); return { ok: distance <= weaponRange, reason: distance <= weaponRange ? null : 'OUT_OF_RANGE', distance, maxRange: weaponRange }; },
    validateMobAttackRange({ source, target, attackRange }) { const distance = distance2d(source.position, target.position); return { ok: distance <= attackRange, reason: distance <= attackRange ? null : 'OUT_OF_RANGE', distance, maxRange: attackRange }; },
  };
  const events = [];
  const service = new PlayablePveCombatService({ mobCombatPort, playerCombatPort, equipmentPort, worldPort, eventPort: { onEvent: event => events.push(event) }, rng, clock: () => 0 });
  return { service, player, mob, events, mobDeathTransitions: () => mobDeathTransitions, playerDeathTransitions: () => playerDeathTransitions };
}

test('canonical level-3 Karus Warrior combat fixture is derived from exact 1298 source rows', () => {
  const f = authority.deterministic_player_fixture, s = f.effective_stats, c = f.class_coefficient, w = authority.canonical_slice.weapon;
  assert.equal(calculateAttackPower({ level: 3, effectiveStr: s.str, effectiveDex: s.dex, weaponCoefficient: c.sword, itemHit: w.damage }), f.derived_combat.ap);
  assert.equal(calculateArmorClass({ armorCoefficient: c.ac, bodyAc: 3, itemAc: 0 }), f.derived_combat.ac);
  assert.equal(calculateHitRate({ hitRateCoefficient: c.hit_rate, level: 3, effectiveDex: s.dex }), f.derived_combat.hit_rate);
  assert.equal(calculateEvasionRate({ evasionCoefficient: c.evasion_rate, level: 3, effectiveDex: s.dex }), f.derived_combat.evasion_rate);
  assert.equal(calculateMaxHp({ level: 3, effectiveSta: s.sta, coefficient: { hitPoint: c.hp } }), f.derived_combat.max_hp);
  assert.deepEqual(calculateMaxMp({ level: 3, effectiveInt: s.int, effectiveSta: s.sta, coefficient: { manaPoint: c.mp, sp: c.sp } }), { mode: 'SP', value: f.derived_combat.max_resource });
});

test('exact Bandicoot PvE normal attack formula uses player AP versus mob AC/evasion with no PvP /3', () => {
  const result = resolvePlayerVsMobNormalAttack({ player: playerFixture(), mob: mobFixture(), rng: () => 0 });
  assert.equal(result.hitB, 4); assert.equal(result.hitOutcome, 'GREAT_SUCCESS'); assert.equal(result.damage, 3);
});

test('exact Slash Type1 PvE formula is 120% HitB and server-side relative hit for Type=0', () => {
  const result = resolvePlayerVsMobType1({ player: playerFixture(), mob: mobFixture(), type1: { type: 0, hitRateMod: 100, damageMod: 120 }, rng: () => 0 });
  assert.equal(result.hitB, 4); assert.equal(result.skillHit, 4); assert.equal(result.hitOutcome, 'GREAT_SUCCESS'); assert.equal(result.damage, 4);
});

test('exact Bandicoot mob-to-player formula uses sDamage=3, total player AC and GREAT_SUCCESS scaling', () => {
  const result = resolveMobVsPlayerNormalAttack({ mob: mobFixture(), player: playerFixture(), rng: () => 0 });
  assert.equal(result.hitB, 2); assert.equal(result.maxDamage, 7); assert.equal(result.hitOutcome, 'GREAT_SUCCESS'); assert.equal(result.damage, 1);
});

test('real playable flow: Short Sword normal hit, Slash resource cost, target HP authority and one death transition', () => {
  const h = harness({ rng: () => 0 }), runtimeId = h.mob.runtimeId;
  const normal = h.service.normalAttack({ sourceId: h.player.id, targetId: runtimeId, requestKey: 'normal-1', now: 0 });
  assert.equal(normal.ok, true); assert.equal(normal.damage, 3); assert.equal(normal.oldTargetHp, 11); assert.equal(normal.newTargetHp, 8); assert.equal(h.mob.hp, 8);
  assert.deepEqual(normal.events.map(e => e.type), [PVE_EVENT.NORMAL_ATTACK_RESULT, PVE_EVENT.TARGET_HP_CHANGED]);
  const duplicateNormal = h.service.normalAttack({ sourceId: h.player.id, targetId: runtimeId, requestKey: 'normal-1', now: 0 });
  assert.equal(duplicateNormal.reason, PVE_RESULT.DUPLICATE_REQUEST); assert.equal(h.mob.hp, 8);
  const slash1 = h.service.slash({ sourceId: h.player.id, targetId: runtimeId, requestKey: 'slash-1', now: 100 });
  assert.equal(slash1.ok, true); assert.equal(slash1.damage, 4); assert.equal(slash1.oldResource, 33); assert.equal(slash1.newResource, 29); assert.equal(h.player.sp, 29); assert.equal(h.mob.hp, 4);
  assert.equal(slash1.clientRecastMs, 3100); assert.equal(slash1.serverCooldownAuthority, 'NO_SERVER_COOLDOWN_ENFORCEMENT_IN_PINNED_1298_SOURCE'); assert.equal(slash1.rangeAuthority.clientRule, 'RIGHT_HAND_WEAPON_RANGE_PLUS_TARGET_RADIUS_PLUS_1'); assert.equal(slash1.rangeAuthority.serverEnforced, false);
  const lethal = h.service.slash({ sourceId: h.player.id, targetId: runtimeId, requestKey: 'slash-2', now: 101 });
  assert.equal(lethal.ok, true); assert.equal(lethal.damage, 4); assert.equal(lethal.newTargetHp, 0); assert.equal(lethal.dead, true); assert.equal(h.mobDeathTransitions(), 1); assert.equal(lethal.events.filter(e => e.type === PVE_EVENT.TARGET_DIED).length, 1);
  const duplicateLethal = h.service.slash({ sourceId: h.player.id, targetId: runtimeId, requestKey: 'slash-2', now: 101 });
  assert.equal(duplicateLethal.reason, PVE_RESULT.DUPLICATE_REQUEST); assert.equal(h.player.sp, 25); assert.equal(h.mob.hp, 0); assert.equal(h.mobDeathTransitions(), 1);
});

test('Slash accepts EFFECTING only and does not enforce client 3.1s as server cooldown', () => {
  const h = harness({ rng: () => 0 });
  const invalidPhase = h.service.slash({ sourceId: h.player.id, targetId: h.mob.runtimeId, requestKey: 'casting', phase: 'CASTING', now: 1 });
  assert.equal(invalidPhase.reason, PVE_RESULT.INVALID_SKILL_PHASE); assert.equal(h.player.sp, 33);
  const first = h.service.slash({ sourceId: h.player.id, targetId: h.mob.runtimeId, requestKey: 'a', now: 10 });
  const second = h.service.slash({ sourceId: h.player.id, targetId: h.mob.runtimeId, requestKey: 'b', now: 10 });
  assert.equal(first.ok, true); assert.equal(second.ok, true); assert.equal(h.player.sp, 25);
});

test('Short Sword normalized attackDelayMs is server attack timer input and duplicate key is checked before cooldown', () => {
  const h = harness({ rng: () => 0 });
  assert.equal(h.service.normalAttack({ sourceId: h.player.id, targetId: h.mob.runtimeId, requestKey: 'one', now: 0 }).ok, true);
  assert.equal(h.service.normalAttack({ sourceId: h.player.id, targetId: h.mob.runtimeId, requestKey: 'two', now: 1139 }).reason, PVE_RESULT.ATTACK_COOLDOWN);
  assert.equal(h.service.normalAttack({ sourceId: h.player.id, targetId: h.mob.runtimeId, requestKey: 'three', now: 1140 }).ok, true);
});

test('WS25 attackIntent exact Bandicoot stats and positions resolve to player HP mutation through playerCombatPort', () => {
  const h = harness({ rng: () => 0 }), m = authority.canonical_slice.mob;
  const result = h.service.resolveMobAttackIntent({ mobId: h.mob.sourceIdentity, runtimeId: h.mob.runtimeId, targetId: h.player.id, zoneId: 21, position: { ...h.mob.position }, sourceAttack: { sAtk: m.attack, sHitRate: m.hit_rate, sDamage: m.damage, sAttackDelay: m.attack_delay_ms, byAttackRange: m.attack_range }, atMs: 1700 });
  assert.equal(result.ok, true); assert.equal(result.damage, 1); assert.equal(result.oldTargetHp, 33); assert.equal(result.newTargetHp, 32); assert.equal(h.player.hp, 32);
  assert.deepEqual(result.events.map(e => e.type), [PVE_EVENT.NORMAL_ATTACK_RESULT, PVE_EVENT.PLAYER_HP_CHANGED]);
});

test('5000 deterministic source-backed Bandicoot PvE attack resolutions remain stable and bounded', () => {
  let seed = 0x1298; const rng = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 0x100000000);
  const player = playerFixture(), mob = mobFixture(); let positive = 0, miss = 0;
  for (let i = 0; i < 5000; i += 1) { const result = resolvePlayerVsMobNormalAttack({ player, mob, rng }); assert.ok(Number.isInteger(result.damage)); assert.ok(result.damage >= 0 && result.damage <= 4); if (result.damage > 0) positive += 1; else miss += 1; }
  assert.ok(positive > 0); assert.ok(miss > 0);
});

test('Slash range authority is resolved, not UNKNOWN', () => {
  assert.equal(SLASH_RANGE_AUTHORITY.rawValidDistance, 0); assert.equal(SLASH_RANGE_AUTHORITY.clientRule, 'RIGHT_HAND_WEAPON_RANGE_PLUS_TARGET_RADIUS_PLUS_1'); assert.equal(SLASH_RANGE_AUTHORITY.serverEnforced, false); assert.match(SLASH_RANGE_AUTHORITY.serverPolicy, /NO_TYPE1_TARGET_DISTANCE_GATE/);
});
