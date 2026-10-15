'use strict';

const { HIT_OUTCOME, rollHitOutcome } = require('./hit-rate');
const { createGoldenSkillTable } = require('./verified-skill-data');

const OPENKO_1298_PVE_SOURCE = Object.freeze({
  server: 'Open-KO/KnightOnline@7d6cf81093e142c928c2ac9510512b2b182178b5',
  database: 'Open-KO/OpenKO-db@bec619466938d278339c30e5b1a4bff3c9413bab',
  clientAssets: 'Open-KO/ko-client-assets@b4636332c7cd818b0ce171eccc973dd3d6b2e56d',
});

const PVE_EVENT = Object.freeze({
  NORMAL_ATTACK_RESULT: 'NORMAL_ATTACK_RESULT',
  TARGET_HP_CHANGED: 'TARGET_HP_CHANGED',
  MAGIC_PROCESS_RESULT: 'MAGIC_PROCESS_RESULT',
  PLAYER_HP_CHANGED: 'PLAYER_HP_CHANGED',
  TARGET_DIED: 'TARGET_DIED',
});

const PVE_RESULT = Object.freeze({
  SUCCESS: 'SUCCESS',
  TARGET_DEAD: 'TARGET_DEAD',
  DUPLICATE_REQUEST: 'DUPLICATE_REQUEST',
  SOURCE_DEAD: 'SOURCE_DEAD',
  TARGET_NOT_ATTACKABLE: 'TARGET_NOT_ATTACKABLE',
  ZONE_MISMATCH: 'ZONE_MISMATCH',
  RANGE_AUTHORITY_UNAVAILABLE: 'RANGE_AUTHORITY_UNAVAILABLE',
  OUT_OF_RANGE: 'OUT_OF_RANGE',
  EQUIPMENT_AUTHORITY_UNAVAILABLE: 'EQUIPMENT_AUTHORITY_UNAVAILABLE',
  PLAYER_AUTHORITY_UNAVAILABLE: 'PLAYER_AUTHORITY_UNAVAILABLE',
  MOB_AUTHORITY_UNAVAILABLE: 'MOB_AUTHORITY_UNAVAILABLE',
  ATTACK_COOLDOWN: 'ATTACK_COOLDOWN',
  INVALID_SKILL_PHASE: 'INVALID_SKILL_PHASE',
  SKILL_REQUIREMENT: 'SKILL_REQUIREMENT',
  WEAPON_REQUIREMENT: 'WEAPON_REQUIREMENT',
  INSUFFICIENT_RESOURCE: 'INSUFFICIENT_RESOURCE',
  SKILL_COOLDOWN: 'SKILL_COOLDOWN',
  AUTHORITY_REJECTED: 'AUTHORITY_REJECTED',
});

const SLASH_ID = 101003;
const SLASH_RANGE_AUTHORITY = Object.freeze({
  skillId: SLASH_ID,
  rawValidDistance: 0,
  clientRule: 'RIGHT_HAND_WEAPON_RANGE_PLUS_TARGET_RADIUS_PLUS_1',
  clientFormula: 'rightHand.weaponRange + targetRadius + 1.0',
  clientSource: `${OPENKO_1298_PVE_SOURCE.server}:src/Client/WarFare/MagicSkillMng.cpp::CheckValidDistance`,
  serverEnforced: false,
  serverPolicy: 'NO_TYPE1_TARGET_DISTANCE_GATE_IN_PINNED_1298_SERVER_PATH',
  serverSource: Object.freeze([
    `${OPENKO_1298_PVE_SOURCE.server}:src/Server/Ebenezer/MagicProcess.cpp::IsAvailable`,
    `${OPENKO_1298_PVE_SOURCE.server}:src/Server/AIServer/MagicProcess.cpp::ExecuteType1`,
  ]),
});

function finite(name, value, { min = -Infinity, integer = false } = {}) {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  if (integer && !Number.isInteger(value)) throw new TypeError(`${name} must be an integer`);
  if (value < min) throw new RangeError(`${name} must be >= ${min}`);
  return value;
}

function id(name, value) {
  if (typeof value !== 'string' && typeof value !== 'number') throw new TypeError(`${name} is required`);
  const out = String(value);
  if (!out) throw new TypeError(`${name} is required`);
  return out;
}

function requestKey(value) {
  if (value === null || value === undefined || String(value).trim() === '') {
    throw new TypeError('requestKey is required');
  }
  return String(value);
}

function validPosition(position) {
  return !!position && [position.x, position.y, position.z].every(Number.isFinite);
}

function requirePlayerSnapshot(snapshot, expectedId) {
  if (!snapshot || typeof snapshot !== 'object') throw new TypeError('player combat snapshot is required');
  if (expectedId !== undefined && String(snapshot.id) !== String(expectedId)) {
    throw new RangeError(`player snapshot id ${snapshot.id} does not match ${expectedId}`);
  }
  if (!validPosition(snapshot.position)) throw new TypeError('player authoritative position is required');
  finite('player.hp', snapshot.hp, { min: 0, integer: true });
  finite('player.maxHp', snapshot.maxHp, { min: 1, integer: true });
  finite('player.level', snapshot.level, { min: 1, integer: true });
  if (!snapshot.combat || typeof snapshot.combat !== 'object') throw new TypeError('player combat stats are required');
  finite('player.combat.ap', snapshot.combat.ap, { min: 0 });
  finite('player.combat.ac', snapshot.combat.ac, { min: 0 });
  finite('player.combat.hitRate', snapshot.combat.hitRate, { min: Number.EPSILON });
  finite('player.combat.evasionRate', snapshot.combat.evasionRate, { min: Number.EPSILON });
  if (snapshot.hp > snapshot.maxHp) throw new RangeError('player hp exceeds maxHp');
  return snapshot;
}

function requireMobSnapshot(snapshot, expectedId) {
  if (!snapshot || typeof snapshot !== 'object') throw new TypeError('WS25 combat snapshot is required');
  const accepted = new Set([String(snapshot.id), String(snapshot.runtimeId), String(snapshot.instanceId)]);
  if (expectedId !== undefined && !accepted.has(String(expectedId))) {
    throw new RangeError(`mob snapshot does not match target ${expectedId}`);
  }
  if (!Number.isInteger(snapshot.runtimeId)) throw new TypeError('mob runtimeId is required');
  if (!validPosition(snapshot.position)) throw new TypeError('mob authoritative position is required');
  finite('mob.hp', snapshot.hp, { min: 0, integer: true });
  finite('mob.maxHp', snapshot.maxHp, { min: 1, integer: true });
  if (snapshot.hp > snapshot.maxHp) throw new RangeError('mob hp exceeds maxHp');
  if (!snapshot.defense || typeof snapshot.defense !== 'object') throw new TypeError('mob defense authority is required');
  finite('mob.defense.ac', snapshot.defense.ac, { min: 0 });
  finite('mob.defense.evasionRate', snapshot.defense.evasionRate, { min: Number.EPSILON });
  if (!snapshot.attack || typeof snapshot.attack !== 'object') throw new TypeError('mob attack authority is required');
  finite('mob.attack.attack', snapshot.attack.attack, { min: 0 });
  finite('mob.attack.hitRate', snapshot.attack.hitRate, { min: Number.EPSILON });
  finite('mob.attack.baseDamage', snapshot.attack.baseDamage, { min: 0 });
  finite('mob.attack.attackDelayMs', snapshot.attack.attackDelayMs, { min: 0 });
  finite('mob.attack.attackRange', snapshot.attack.attackRange, { min: 0 });
  if (typeof snapshot.alive !== 'boolean' || typeof snapshot.targetable !== 'boolean'
    || typeof snapshot.attackable !== 'boolean') {
    throw new TypeError('mob alive/targetable/attackable authority is required');
  }
  return snapshot;
}

function requireEquipmentSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') throw new TypeError('normalized equipment combat snapshot is required');
  finite('equipment.weaponRange', snapshot.weaponRange, { min: 0 });
  finite('equipment.attackDelayMs', snapshot.attackDelayMs, { min: 0 });
  finite('equipment.damage', snapshot.damage, { min: 0 });
  const weaponItemId = snapshot.weaponItemId ?? snapshot.itemId ?? snapshot.weapon?.itemId;
  if (!Number.isSafeInteger(Number(weaponItemId)) || Number(weaponItemId) <= 0) {
    throw new TypeError('normalized equipment weaponItemId is required');
  }
  const weaponType = snapshot.weaponType ?? snapshot.weapon?.type;
  if (weaponType === null || weaponType === undefined || weaponType === '') {
    throw new TypeError('normalized equipment weaponType is required');
  }
  return Object.freeze({ ...snapshot, weaponItemId: Number(weaponItemId), weaponType });
}

function sourceHitB(attackPower, defenderAc) {
  finite('attackPower', attackPower, { min: 0 });
  finite('defenderAc', defenderAc, { min: 0 });
  return Math.trunc((attackPower * 200) / (defenderAc + 240));
}

function randomInclusive(max, rng = Math.random) {
  finite('max', max, { min: 0, integer: true });
  const roll = rng();
  if (!(roll >= 0 && roll < 1)) throw new RangeError('rng must return [0,1)');
  return Math.floor(roll * (max + 1));
}

function resolvePlayerVsMobNormalAttack({ player, mob, rng = Math.random }) {
  requirePlayerSnapshot(player);
  requireMobSnapshot(mob);
  const hitB = sourceHitB(player.combat.ap, mob.defense.ac);
  const hitRateRatio = player.combat.hitRate / mob.defense.evasionRate;
  const hitOutcome = rollHitOutcome(hitRateRatio, rng);
  if (hitOutcome === HIT_OUTCOME.FAIL || hitB <= 0) {
    return Object.freeze({ damage: 0, hitOutcome, hitRateRatio, hitB, randomDamage: 0 });
  }
  const randomDamage = randomInclusive(hitB, rng);
  const damage = Math.trunc((0.85 * hitB) + (0.3 * randomDamage));
  return Object.freeze({ damage, hitOutcome, hitRateRatio, hitB, randomDamage });
}

function resolvePlayerVsMobType1({ player, mob, type1, rng = Math.random }) {
  requirePlayerSnapshot(player);
  requireMobSnapshot(mob);
  if (!type1 || typeof type1 !== 'object') throw new TypeError('verified Type1 row is required');
  finite('type1.type', type1.type, { min: 0, integer: true });
  finite('type1.hitRateMod', type1.hitRateMod, { min: 0 });
  finite('type1.damageMod', type1.damageMod, { min: 0 });
  const hitB = sourceHitB(player.combat.ap, mob.defense.ac);
  const skillHit = Math.trunc(hitB * type1.damageMod / 100);
  let hitOutcome;
  let hitRateRatio = null;
  if (type1.type === 0) {
    hitRateRatio = (player.combat.hitRate / mob.defense.evasionRate) * (type1.hitRateMod / 100);
    hitOutcome = rollHitOutcome(hitRateRatio, rng);
  } else {
    const roll = rng();
    if (!(roll >= 0 && roll < 1)) throw new RangeError('rng must return [0,1)');
    const sourceRoll = Math.floor(roll * 101);
    hitOutcome = type1.hitRateMod > sourceRoll ? HIT_OUTCOME.SUCCESS : HIT_OUTCOME.FAIL;
  }
  if (hitOutcome === HIT_OUTCOME.FAIL || skillHit <= 0) {
    return Object.freeze({ damage: 0, hitOutcome, hitRateRatio, hitB, skillHit, randomDamage: 0 });
  }
  const randomDamage = randomInclusive(skillHit, rng);
  const damage = Math.trunc(skillHit + (0.3 * randomDamage) + 0.99);
  return Object.freeze({ damage, hitOutcome, hitRateRatio, hitB, skillHit, randomDamage });
}

function resolveMobVsPlayerNormalAttack({ mob, player, rng = Math.random }) {
  requireMobSnapshot(mob);
  requirePlayerSnapshot(player);
  const hit = mob.attack.baseDamage;
  const hitB = sourceHitB(hit, player.combat.ac);
  const hitRateRatio = mob.attack.hitRate / player.combat.evasionRate;
  const hitOutcome = rollHitOutcome(hitRateRatio, rng);
  let damage = 0;
  let randomDamage = 0;
  if (hitOutcome !== HIT_OUTCOME.FAIL && hitB > 0) {
    randomDamage = randomInclusive(hitB, rng);
    damage = Math.trunc(0.3 * randomDamage) + Math.trunc(0.85 * hitB);
    if (hitOutcome === HIT_OUTCOME.GREAT_SUCCESS) damage = Math.trunc((damage * 3) / 2);
  }
  const maxDamage = Math.trunc(2.6 * mob.attack.baseDamage);
  if (damage > maxDamage) damage = maxDamage;
  return Object.freeze({ damage, hitOutcome, hitRateRatio, hitB, randomDamage, maxDamage });
}

function resourceState(player) {
  const kind = player.resourceKind;
  if (kind !== 'MP' && kind !== 'SP') throw new TypeError('player.resourceKind must be MP or SP');
  const field = kind === 'SP' ? 'sp' : 'mp';
  const maxField = kind === 'SP' ? 'maxSp' : 'maxMp';
  finite(`player.${field}`, player[field], { min: 0, integer: true });
  finite(`player.${maxField}`, player[maxField], { min: 0, integer: true });
  return Object.freeze({ kind, field, maxField, value: player[field], max: player[maxField] });
}

function event(type, payload) { return Object.freeze({ type, ...payload }); }

class PlayablePveCombatService {
  constructor({ mobCombatPort, playerCombatPort, equipmentPort, worldPort, eventPort = null, rng = Math.random, clock = Date.now, skillTable = createGoldenSkillTable(), skillCooldownPolicy = null } = {}) {
    if (!mobCombatPort || typeof mobCombatPort.getCombatSnapshot !== 'function' || typeof mobCombatPort.applyCombatResult !== 'function') throw new TypeError('mobCombatPort.getCombatSnapshot/applyCombatResult are required');
    if (!playerCombatPort || typeof playerCombatPort.getCombatSnapshot !== 'function' || typeof playerCombatPort.applyHealthResult !== 'function' || typeof playerCombatPort.applyResourceResult !== 'function') throw new TypeError('playerCombatPort get/apply health/resource authority is required');
    if (!equipmentPort || typeof equipmentPort.getCombatSnapshot !== 'function') throw new TypeError('normalized equipmentPort.getCombatSnapshot is required');
    if (!worldPort || typeof worldPort.validateAttackRange !== 'function' || typeof worldPort.validateMobAttackRange !== 'function') throw new TypeError('authoritative world range port is required');
    if (typeof rng !== 'function' || typeof clock !== 'function') throw new TypeError('rng/clock must be functions');
    this.mobCombatPort = mobCombatPort;
    this.playerCombatPort = playerCombatPort;
    this.equipmentPort = equipmentPort;
    this.worldPort = worldPort;
    this.eventPort = eventPort;
    this.rng = rng;
    this.clock = clock;
    this.skillTable = skillTable;
    this.skillCooldownPolicy = skillCooldownPolicy;
    this.requests = new Map();
    this.attackReadyAt = new Map();
    this.skillReadyAt = new Map();
  }

  normalAttack({ sourceId, targetId, requestKey: rawRequestKey, now = this.clock() }) {
    const source = id('sourceId', sourceId), target = id('targetId', targetId), key = requestKey(rawRequestKey);
    const dedupe = this._duplicate('NORMAL', source, key); if (dedupe) return dedupe;
    const player = this._player(source);
    if (player.hp <= 0 || player.lifeState === 'DEAD') return this._reject(PVE_RESULT.SOURCE_DEAD, source, target, key);
    const mob = this._mob(target);
    if (!mob.alive || !mob.targetable || !mob.attackable || mob.hp <= 0) return this._reject(PVE_RESULT.TARGET_NOT_ATTACKABLE, source, target, key);
    if (String(player.zoneId) !== String(mob.zoneId)) return this._reject(PVE_RESULT.ZONE_MISMATCH, source, target, key);
    let equipment;
    try { equipment = requireEquipmentSnapshot(this.equipmentPort.getCombatSnapshot(player)); }
    catch (error) { return this._reject(PVE_RESULT.EQUIPMENT_AUTHORITY_UNAVAILABLE, source, target, key, { error: error.message }); }
    const readyAt = this.attackReadyAt.get(source) ?? -Infinity;
    if (now < readyAt) return this._reject(PVE_RESULT.ATTACK_COOLDOWN, source, target, key, { readyAt, now });
    const range = this.worldPort.validateAttackRange({ attacker: player, target: mob, weaponRange: equipment.weaponRange });
    if (!range || range.ok !== true) return this._reject(range?.reason === 'OUT_OF_RANGE' || range?.ok === false && Number.isFinite(range?.distance) ? PVE_RESULT.OUT_OF_RANGE : PVE_RESULT.RANGE_AUTHORITY_UNAVAILABLE, source, target, key, { range: range ?? null });
    const resolved = resolvePlayerVsMobNormalAttack({ player, mob, rng: this.rng });
    const newTargetHp = Math.max(0, mob.hp - resolved.damage);
    const authority = this.mobCombatPort.applyCombatResult(mob.runtimeId, { ok: true, sourceId: source, attackerId: source, targetId: mob.runtimeId, requestKey: key, absoluteTargetHp: newTargetHp, damage: resolved.damage, attackType: 'NORMAL', hitOutcome: resolved.hitOutcome }, now, { sourceId: source, targetId: mob.runtimeId, requestKey: key });
    if (!authority || authority.applied !== true) return this._reject(authority?.duplicate ? PVE_RESULT.DUPLICATE_REQUEST : PVE_RESULT.AUTHORITY_REJECTED, source, target, key, { authority: authority ?? null });
    this.attackReadyAt.set(source, now + equipment.attackDelayMs);
    const dead = authority.deathTransition === true || authority.mob?.alive === false;
    const resultEvents = [event(PVE_EVENT.NORMAL_ATTACK_RESULT, { source, target: mob.runtimeId, attackType: 'NORMAL', result: dead ? PVE_RESULT.TARGET_DEAD : PVE_RESULT.SUCCESS, damage: resolved.damage, hitOutcome: resolved.hitOutcome, requestKey: key })];
    if (newTargetHp !== mob.hp) resultEvents.push(event(PVE_EVENT.TARGET_HP_CHANGED, { source, target: mob.runtimeId, oldTargetHp: mob.hp, newTargetHp, damage: resolved.damage, requestKey: key }));
    if (authority.deathTransition === true) resultEvents.push(event(PVE_EVENT.TARGET_DIED, { source, target: mob.runtimeId, requestKey: key }));
    const result = Object.freeze({ ok: true, source, target: mob.runtimeId, attackType: 'NORMAL', result: dead ? PVE_RESULT.TARGET_DEAD : PVE_RESULT.SUCCESS, damage: resolved.damage, oldTargetHp: mob.hp, newTargetHp, dead, requestKey: key, hitOutcome: resolved.hitOutcome, hitRateRatio: resolved.hitRateRatio, equipment: Object.freeze({ weaponItemId: equipment.weaponItemId, weaponType: equipment.weaponType, damage: equipment.damage, weaponRange: equipment.weaponRange, attackDelayMs: equipment.attackDelayMs }), authority, events: Object.freeze(resultEvents) });
    this._remember('NORMAL', source, key, result); this._emit(resultEvents); return result;
  }

  skill({ skillId, phase = 'EFFECTING', sourceId, targetId, requestKey: rawRequestKey, now = this.clock() }) {
    if (Number(skillId) !== SLASH_ID) return Object.freeze({ ok: false, reason: PVE_RESULT.SKILL_REQUIREMENT, skillId: Number(skillId) });
    return this.slash({ sourceId, targetId, requestKey: rawRequestKey, phase, now });
  }

  slash({ sourceId, targetId, requestKey: rawRequestKey, phase = 'EFFECTING', now = this.clock() }) {
    const source = id('sourceId', sourceId), target = id('targetId', targetId), key = requestKey(rawRequestKey);
    const dedupe = this._duplicate(`SKILL:${SLASH_ID}`, source, key); if (dedupe) return dedupe;
    if (phase !== 'EFFECTING' && phase !== 3) return this._reject(PVE_RESULT.INVALID_SKILL_PHASE, source, target, key, { skillId: SLASH_ID, phase });
    const skill = this.skillTable.get(SLASH_ID);
    if (!skill || skill.sourceKind !== 'VERIFIED_1298' || skill.primaryType !== 1 || skill.secondaryType !== 0 || !skill.primaryTypeData || skill.moral !== 7 || skill.resourceCost !== 4 || skill.requiredLevel !== 3 || skill.primaryTypeData.hitRateMod !== 100 || skill.primaryTypeData.damageMod !== 120) return this._reject(PVE_RESULT.SKILL_REQUIREMENT, source, target, key, { skillId: SLASH_ID });
    const player = this._player(source);
    if (player.hp <= 0 || player.lifeState === 'DEAD') return this._reject(PVE_RESULT.SOURCE_DEAD, source, target, key);
    if (player.level < skill.requiredLevel) return this._reject(PVE_RESULT.SKILL_REQUIREMENT, source, target, key, { requiredLevel: skill.requiredLevel });
    const mob = this._mob(target);
    if (!mob.alive || !mob.targetable || !mob.attackable || mob.hp <= 0) return this._reject(PVE_RESULT.TARGET_NOT_ATTACKABLE, source, target, key);
    if (String(player.zoneId) !== String(mob.zoneId)) return this._reject(PVE_RESULT.ZONE_MISMATCH, source, target, key);
    let equipment;
    try { equipment = requireEquipmentSnapshot(this.equipmentPort.getCombatSnapshot(player)); }
    catch (error) { return this._reject(PVE_RESULT.EQUIPMENT_AUTHORITY_UNAVAILABLE, source, target, key, { error: error.message }); }
    if (!equipment.weaponItemId) return this._reject(PVE_RESULT.WEAPON_REQUIREMENT, source, target, key);
    let resource;
    try { resource = resourceState(player); }
    catch (error) { return this._reject(PVE_RESULT.PLAYER_AUTHORITY_UNAVAILABLE, source, target, key, { error: error.message }); }
    if (resource.value < skill.resourceCost) return this._reject(PVE_RESULT.INSUFFICIENT_RESOURCE, source, target, key, { resourceKind: resource.kind, required: skill.resourceCost, available: resource.value });
    let serverCooldownMs = null;
    if (this.skillCooldownPolicy) {
      serverCooldownMs = this.skillCooldownPolicy.resolveCooldownMs({ skillId: SLASH_ID, player, skill, now });
      if (!Number.isFinite(serverCooldownMs) || serverCooldownMs < 0) throw new TypeError('skillCooldownPolicy must return a non-negative finite cooldown');
      const readyAt = this.skillReadyAt.get(`${source}:${SLASH_ID}`) ?? -Infinity;
      if (now < readyAt) return this._reject(PVE_RESULT.SKILL_COOLDOWN, source, target, key, { readyAt, now });
    }
    const resourceAfter = resource.value - skill.resourceCost;
    const resourceAuthority = this.playerCombatPort.applyResourceResult({ targetId: source, sourceId: source, requestKey: key, cause: `SKILL:${SLASH_ID}`, kind: resource.kind, absoluteValue: resourceAfter, delta: -skill.resourceCost });
    if (!resourceAuthority || resourceAuthority.applied !== true) return this._reject(resourceAuthority?.duplicate ? PVE_RESULT.DUPLICATE_REQUEST : PVE_RESULT.AUTHORITY_REJECTED, source, target, key, { authority: resourceAuthority ?? null });
    const resolved = resolvePlayerVsMobType1({ player, mob, type1: skill.primaryTypeData, rng: this.rng });
    const newTargetHp = Math.max(0, mob.hp - resolved.damage);
    const authority = this.mobCombatPort.applyCombatResult(mob.runtimeId, { ok: true, sourceId: source, attackerId: source, targetId: mob.runtimeId, requestKey: key, absoluteTargetHp: newTargetHp, damage: resolved.damage, attackType: 'TYPE1', skillId: SLASH_ID, hitOutcome: resolved.hitOutcome }, now, { sourceId: source, targetId: mob.runtimeId, requestKey: key, skillId: SLASH_ID });
    if (!authority || authority.applied !== true) { const rejected = this._reject(authority?.duplicate ? PVE_RESULT.DUPLICATE_REQUEST : PVE_RESULT.AUTHORITY_REJECTED, source, target, key, { authority: authority ?? null, resourceAuthority }); this._remember(`SKILL:${SLASH_ID}`, source, key, rejected); return rejected; }
    if (serverCooldownMs !== null) this.skillReadyAt.set(`${source}:${SLASH_ID}`, now + serverCooldownMs);
    const dead = authority.deathTransition === true || authority.mob?.alive === false;
    const resultEvents = [event(PVE_EVENT.MAGIC_PROCESS_RESULT, { source, target: mob.runtimeId, skillId: SLASH_ID, phase: 'EFFECTING', result: dead ? PVE_RESULT.TARGET_DEAD : PVE_RESULT.SUCCESS, damage: resolved.damage, hitOutcome: resolved.hitOutcome, resourceKind: resource.kind, resourceDelta: -skill.resourceCost, requestKey: key })];
    if (newTargetHp !== mob.hp) resultEvents.push(event(PVE_EVENT.TARGET_HP_CHANGED, { source, target: mob.runtimeId, oldTargetHp: mob.hp, newTargetHp, damage: resolved.damage, skillId: SLASH_ID, requestKey: key }));
    if (authority.deathTransition === true) resultEvents.push(event(PVE_EVENT.TARGET_DIED, { source, target: mob.runtimeId, skillId: SLASH_ID, requestKey: key }));
    const result = Object.freeze({ ok: true, source, target: mob.runtimeId, attackType: 'TYPE1', skillId: SLASH_ID, phase: 'EFFECTING', result: dead ? PVE_RESULT.TARGET_DEAD : PVE_RESULT.SUCCESS, damage: resolved.damage, oldTargetHp: mob.hp, newTargetHp, dead, requestKey: key, hitOutcome: resolved.hitOutcome, hitRateRatio: resolved.hitRateRatio, oldResource: resource.value, newResource: resourceAfter, resourceKind: resource.kind, resourceCost: skill.resourceCost, clientRecastMs: skill.clientRecastMs, serverCooldownAuthority: serverCooldownMs === null ? 'NO_SERVER_COOLDOWN_ENFORCEMENT_IN_PINNED_1298_SOURCE' : 'INJECTED_SERVER_POLICY', serverCooldownMs, rangeAuthority: SLASH_RANGE_AUTHORITY, equipment: Object.freeze({ weaponItemId: equipment.weaponItemId, weaponType: equipment.weaponType, damage: equipment.damage, weaponRange: equipment.weaponRange }), resourceAuthority, authority, events: Object.freeze(resultEvents) });
    this._remember(`SKILL:${SLASH_ID}`, source, key, result); this._emit(resultEvents); return result;
  }

  resolveMobAttackIntent(intent, { requestKey: explicitRequestKey } = {}) {
    if (!intent || typeof intent !== 'object') throw new TypeError('WS25 attackIntent is required');
    const target = id('targetId', intent.targetId), sourceIdentifier = intent.runtimeId ?? intent.instanceId ?? intent.mobId;
    const mob = this._mob(sourceIdentifier), source = String(mob.runtimeId), key = requestKey(explicitRequestKey ?? `ws25:${source}:${target}:${intent.atMs}`);
    const dedupe = this._duplicate('MOB_NORMAL', source, key); if (dedupe) return dedupe;
    const player = this._player(target);
    if (player.hp <= 0 || player.lifeState === 'DEAD') return this._reject(PVE_RESULT.TARGET_NOT_ATTACKABLE, source, target, key);
    if (!mob.alive || mob.hp <= 0) return this._reject(PVE_RESULT.SOURCE_DEAD, source, target, key);
    if (String(player.zoneId) !== String(mob.zoneId) || String(intent.zoneId) !== String(mob.zoneId)) return this._reject(PVE_RESULT.ZONE_MISMATCH, source, target, key);
    const supplied = intent.sourceAttack;
    if (!supplied || typeof supplied !== 'object') return this._reject(PVE_RESULT.MOB_AUTHORITY_UNAVAILABLE, source, target, key, { reasonDetail: 'sourceAttack missing' });
    const exactChecks = [['sAtk', supplied.sAtk, mob.attack.attack], ['sHitRate', supplied.sHitRate, mob.attack.hitRate], ['sDamage', supplied.sDamage, mob.attack.baseDamage], ['sAttackDelay', supplied.sAttackDelay, mob.attack.attackDelayMs], ['byAttackRange', supplied.byAttackRange, mob.attack.attackRange]];
    for (const [field, actual, expected] of exactChecks) if (!Number.isFinite(actual) || actual !== expected) return this._reject(PVE_RESULT.MOB_AUTHORITY_UNAVAILABLE, source, target, key, { reasonDetail: `${field} mismatch`, actual, expected });
    if (!validPosition(intent.position) || intent.position.x !== mob.position.x || intent.position.y !== mob.position.y || intent.position.z !== mob.position.z) return this._reject(PVE_RESULT.MOB_AUTHORITY_UNAVAILABLE, source, target, key, { reasonDetail: 'position mismatch' });
    const range = this.worldPort.validateMobAttackRange({ source: mob, target: player, attackRange: mob.attack.attackRange });
    if (!range || range.ok !== true) return this._reject(range?.reason === 'OUT_OF_RANGE' || range?.ok === false && Number.isFinite(range?.distance) ? PVE_RESULT.OUT_OF_RANGE : PVE_RESULT.RANGE_AUTHORITY_UNAVAILABLE, source, target, key, { range: range ?? null });
    const resolved = resolveMobVsPlayerNormalAttack({ mob, player, rng: this.rng });
    const newPlayerHp = Math.max(0, player.hp - resolved.damage);
    const authority = this.playerCombatPort.applyHealthResult({ targetId: target, sourceId: source, requestKey: key, cause: 'MOB_NORMAL_ATTACK', absoluteHp: newPlayerHp, damage: resolved.damage });
    if (!authority || authority.applied !== true) return this._reject(authority?.duplicate ? PVE_RESULT.DUPLICATE_REQUEST : PVE_RESULT.AUTHORITY_REJECTED, source, target, key, { authority: authority ?? null });
    const dead = authority.deathTransition === true || authority.player?.hp === 0;
    const resultEvents = [event(PVE_EVENT.NORMAL_ATTACK_RESULT, { source, target, attackType: 'MOB_NORMAL', result: dead ? PVE_RESULT.TARGET_DEAD : PVE_RESULT.SUCCESS, damage: resolved.damage, hitOutcome: resolved.hitOutcome, requestKey: key })];
    if (newPlayerHp !== player.hp) resultEvents.push(event(PVE_EVENT.PLAYER_HP_CHANGED, { source, target, oldPlayerHp: player.hp, newPlayerHp, damage: resolved.damage, requestKey: key }));
    if (authority.deathTransition === true) resultEvents.push(event(PVE_EVENT.TARGET_DIED, { source, target, requestKey: key }));
    const result = Object.freeze({ ok: true, source, target, attackType: 'MOB_NORMAL', result: dead ? PVE_RESULT.TARGET_DEAD : PVE_RESULT.SUCCESS, damage: resolved.damage, oldTargetHp: player.hp, newTargetHp: newPlayerHp, dead, requestKey: key, hitOutcome: resolved.hitOutcome, hitRateRatio: resolved.hitRateRatio, authority, events: Object.freeze(resultEvents) });
    this._remember('MOB_NORMAL', source, key, result); this._emit(resultEvents); return result;
  }

  _player(playerId) { const snapshot = this.playerCombatPort.getCombatSnapshot(playerId); return requirePlayerSnapshot(snapshot, playerId); }
  _mob(mobId) { const snapshot = this.mobCombatPort.getCombatSnapshot(mobId); return requireMobSnapshot(snapshot, mobId); }
  _ledgerKey(kind, source, key) { return `${kind}:${source}:${key}`; }
  _duplicate(kind, source, key) { const ledgerKey = this._ledgerKey(kind, source, key); if (!this.requests.has(ledgerKey)) return null; const previous = this.requests.get(ledgerKey); return Object.freeze({ ok: false, duplicate: true, reason: PVE_RESULT.DUPLICATE_REQUEST, source, requestKey: key, originalResult: previous, events: Object.freeze([]) }); }
  _remember(kind, source, key, result) { this.requests.set(this._ledgerKey(kind, source, key), result); while (this.requests.size > 4096) this.requests.delete(this.requests.keys().next().value); }
  _reject(reason, source, target, key, extra = {}) { return Object.freeze({ ok: false, reason, source, target, requestKey: key, events: Object.freeze([]), ...extra }); }
  _emit(events) { if (!this.eventPort) return; const fn = this.eventPort.onEvent ?? this.eventPort.emit; if (typeof fn !== 'function') return; for (const semanticEvent of events) fn(semanticEvent); }
}

function createPlayablePveCombatPort({ service }) {
  if (!(service instanceof PlayablePveCombatService)) throw new TypeError('PlayablePveCombatService is required');
  return Object.freeze({ normalAttack(request) { return service.normalAttack(request); }, skill(request) { return service.skill(request); }, slash(request) { return service.slash(request); }, resolveMobAttackIntent(intent, context) { return service.resolveMobAttackIntent(intent, context); } });
}

module.exports = { OPENKO_1298_PVE_SOURCE, PVE_EVENT, PVE_RESULT, SLASH_ID, SLASH_RANGE_AUTHORITY, PlayablePveCombatService, createPlayablePveCombatPort, requireEquipmentSnapshot, resolveMobVsPlayerNormalAttack, resolvePlayerVsMobNormalAttack, resolvePlayerVsMobType1, sourceHitB };
