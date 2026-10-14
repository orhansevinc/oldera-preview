const { ProgressionError, invariant } = require('./errors');

const VERIFIED_MAX_LEVEL_1298 = 80;
const VERIFIED_RESPAWN_BLINK_MS_1298 = 10_000;
const DEATH_STATE = Object.freeze({
  ALIVE: 'alive',
  DEAD: 'dead',
  RESPAWN_REQUESTED: 'respawn_requested',
});
const XP_SOURCE = Object.freeze({
  MOB_KILL: 'mob_kill',
  PARTY_MOB_KILL: 'party_mob_kill',
  DEATH_LOSS: 'death_loss',
  EXTERNAL: 'external',
});

function toXp(value, fieldName = 'xp') {
  let xp;
  if (typeof value === 'bigint') xp = value;
  else if (typeof value === 'number') {
    invariant(Number.isSafeInteger(value), 'INVALID_XP', `${fieldName} must be a safe integer or bigint`);
    xp = BigInt(value);
  } else if (typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value)) xp = BigInt(value);
  else throw new ProgressionError('INVALID_XP', `${fieldName} must be a non-negative integer-like value`);
  invariant(xp >= 0n, 'INVALID_XP', `${fieldName} cannot be negative`);
  return xp;
}

function toSignedXp(value, fieldName = 'xp') {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    invariant(Number.isSafeInteger(value), 'INVALID_XP', `${fieldName} must be a safe integer or bigint`);
    return BigInt(value);
  }
  if (typeof value === 'string' && /^-?(0|[1-9]\d*)$/.test(value)) return BigInt(value);
  throw new ProgressionError('INVALID_XP', `${fieldName} must be an integer-like value`);
}

function toNonNegativeInt(value, fieldName) {
  invariant(Number.isSafeInteger(value) && value >= 0, 'INVALID_LEVEL_REWARD_INPUT',
    `${fieldName} must be a non-negative safe integer`);
  return value;
}

/**
 * Source-faithful point eligibility from the pinned 1298 server source.
 * The caller supplies the already-owned totals; WS27 does not guess character stat storage.
 */
function compute1298LevelPointRewards({ toLevel, unspentStatPoints, baseStatTotal, skillPointTotal }) {
  invariant(Number.isInteger(toLevel) && toLevel >= 1 && toLevel <= VERIFIED_MAX_LEVEL_1298,
    'INVALID_LEVEL', 'toLevel is outside 1298 bounds');
  const unspent = toNonNegativeInt(unspentStatPoints, 'unspentStatPoints');
  const baseStats = toNonNegativeInt(baseStatTotal, 'baseStatTotal');
  const skillTotal = toNonNegativeInt(skillPointTotal, 'skillPointTotal');

  const statThreshold = 300 + (3 * (toLevel - 1));
  const skillThreshold = Math.max(0, 2 * (toLevel - 9));
  return {
    statPointGain: (unspent + baseStats) < statThreshold ? 3 : 0,
    skillPointGain: toLevel > 9 && skillTotal < skillThreshold ? 2 : 0,
    statThreshold,
    skillThreshold,
  };
}

/**
 * The source contains both 1% (divisor 100) and 5% (divisor 20) NPC-death branches.
 * Mapping a concrete death to one of those branches belongs to the combat/zone adapter.
 * WS27 therefore applies no loss unless the incoming death context carries a verified divisor.
 */
class Verified1298PveDeathLossPolicy {
  computeLoss({ state, death, levelXpCap, allowXpLoss = true }) {
    if (!allowXpLoss || !death || death.kind !== 'monster' || state.level < 6) return 0n;
    if (death.xpLossDivisor === undefined || death.xpLossDivisor === null) return 0n;
    invariant(death.xpLossDivisor === 100 || death.xpLossDivisor === 20,
      'UNVERIFIED_DEATH_LOSS_RULE', '1298 source only verifies the wired 1%/5% NPC-death divisors');
    return toXp(levelXpCap, 'levelXpCap') / BigInt(death.xpLossDivisor);
  }
}

class ProgressionService {
  constructor({
    levelTable,
    levelRewardPort,
    vitalsPort,
    killRewardPort,
    partyXpPort,
    respawnPointPort,
    respawnVitalsPort,
    movementBaselinePort,
    nationPointPort = null,
    deathLossPolicy = new Verified1298PveDeathLossPolicy(),
    clock = () => Date.now(),
  }) {
    invariant(levelTable && typeof levelTable.getMaxLevel === 'function', 'MISSING_PORT', 'levelTable.getMaxLevel is required');
    invariant(levelTable && typeof levelTable.getLevelXpCap === 'function', 'MISSING_PORT', 'levelTable.getLevelXpCap is required');
    invariant(levelRewardPort && typeof levelRewardPort.onLevelUp === 'function', 'MISSING_PORT', 'levelRewardPort.onLevelUp is required');
    invariant(vitalsPort && typeof vitalsPort.recalculateOnLevelChange === 'function', 'MISSING_PORT',
      'vitalsPort.recalculateOnLevelChange is required');
    invariant(killRewardPort && typeof killRewardPort.resolveXp === 'function', 'MISSING_PORT', 'killRewardPort.resolveXp is required');
    invariant(partyXpPort && typeof partyXpPort.allocate === 'function', 'MISSING_PORT', 'partyXpPort.allocate is required');
    invariant(respawnPointPort && typeof respawnPointPort.resolve === 'function', 'MISSING_PORT', 'respawnPointPort.resolve is required');
    invariant(respawnVitalsPort && typeof respawnVitalsPort.restoreOnRespawn === 'function', 'MISSING_PORT',
      'respawnVitalsPort.restoreOnRespawn is required');
    invariant(movementBaselinePort && typeof movementBaselinePort.resetOnRespawn === 'function', 'MISSING_PORT',
      'movementBaselinePort.resetOnRespawn is required');
    invariant(typeof clock === 'function', 'MISSING_PORT', 'clock is required');
    this.levelTable = levelTable;
    this.levelRewardPort = levelRewardPort;
    this.vitalsPort = vitalsPort;
    this.killRewardPort = killRewardPort;
    this.partyXpPort = partyXpPort;
    this.respawnPointPort = respawnPointPort;
    this.respawnVitalsPort = respawnVitalsPort;
    this.movementBaselinePort = movementBaselinePort;
    this.nationPointPort = nationPointPort;
    this.deathLossPolicy = deathLossPolicy;
    this.clock = clock;
  }

  _maxLevel() {
    const max = this.levelTable.getMaxLevel();
    invariant(max === VERIFIED_MAX_LEVEL_1298, 'INVALID_LEVEL_TABLE',
      `1298 runtime max level must be ${VERIFIED_MAX_LEVEL_1298}`);
    return VERIFIED_MAX_LEVEL_1298;
  }

  _levelCap(level) {
    invariant(Number.isInteger(level) && level >= 1 && level <= VERIFIED_MAX_LEVEL_1298,
      'INVALID_LEVEL', 'level is outside verified 1298 bounds');
    const cap = toXp(this.levelTable.getLevelXpCap(level), `levelXpCap(${level})`);
    invariant(cap > 0n, 'INVALID_LEVEL_TABLE', 'level XP cap must be positive', { level });
    return cap;
  }

  _validateState(input) {
    invariant(input && typeof input === 'object', 'INVALID_STATE', 'state is required');
    invariant(input.characterId !== undefined && input.characterId !== null, 'INVALID_STATE', 'characterId is required');
    const maxLevel = this._maxLevel();
    invariant(Number.isInteger(input.level) && input.level >= 1 && input.level <= maxLevel,
      'INVALID_LEVEL', 'state.level is outside configured bounds');
    const experience = toSignedXp(input.experience, 'state.experience');
    const cap = this._levelCap(input.level);
    if (input.level === maxLevel) {
      invariant(experience >= 0n && experience <= cap, 'INVALID_XP', 'max-level experience must be inside its cap');
    }
    const deathState = input.deathState || DEATH_STATE.ALIVE;
    invariant(Object.values(DEATH_STATE).includes(deathState), 'INVALID_DEATH_STATE', 'invalid deathState');
    const version = input.version === undefined ? 0 : input.version;
    invariant(Number.isSafeInteger(version) && version >= 0, 'INVALID_VERSION', 'state.version must be a non-negative safe integer');
    const appliedEventIds = input.appliedEventIds === undefined ? [] : input.appliedEventIds;
    invariant(Array.isArray(appliedEventIds) && appliedEventIds.every((id) => typeof id === 'string' && id.length > 0),
      'INVALID_REPLAY_STATE', 'appliedEventIds must be an array of non-empty strings');
    const immunityUntilMs = input.immunityUntilMs ?? null;
    invariant(immunityUntilMs === null || (Number.isSafeInteger(immunityUntilMs) && immunityUntilMs >= 0),
      'INVALID_IMMUNITY_STATE', 'immunityUntilMs must be null or a non-negative integer');
    const respawnRequest = input.respawnRequest ? { ...input.respawnRequest,
      point: input.respawnRequest.point ? { ...input.respawnRequest.point } : null } : null;
    if (deathState === DEATH_STATE.RESPAWN_REQUESTED) {
      invariant(respawnRequest && respawnRequest.requestId, 'INVALID_RESPAWN_STATE', 'respawn_requested requires respawnRequest');
    }
    return {
      ...input,
      experience,
      deathState,
      version,
      appliedEventIds: [...appliedEventIds],
      death: input.death ? { ...input.death } : null,
      respawnRequest,
      immunityUntilMs,
    };
  }

  _eventKey(kind, eventId) {
    if (eventId === undefined || eventId === null) return null;
    invariant((typeof eventId === 'string' || typeof eventId === 'number') && String(eventId).length > 0,
      'INVALID_EVENT_ID', 'eventId must be non-empty');
    return `${kind}:${String(eventId)}`;
  }

  _checkExpectedVersion(state, expectedVersion) {
    if (expectedVersion === undefined || expectedVersion === null) return;
    invariant(Number.isSafeInteger(expectedVersion) && expectedVersion >= 0, 'INVALID_VERSION', 'expectedVersion must be non-negative');
    invariant(state.version === expectedVersion, 'VERSION_CONFLICT', 'progression state version does not match expectedVersion',
      { expectedVersion, actualVersion: state.version });
  }

  _replayResult(state, eventKey) {
    return {
      state,
      events: [{ type: 'progression.replay_ignored', characterId: state.characterId, eventKey }],
      replay: true,
      persistence: {
        expectedVersion: state.version,
        nextVersion: state.version,
        snapshot: this.toPersistenceSnapshot(state),
      },
    };
  }

  _beginMutation(inputState, { expectedVersion, eventKey } = {}) {
    const state = this._validateState(inputState);
    this._checkExpectedVersion(state, expectedVersion);
    if (eventKey && state.appliedEventIds.includes(eventKey)) return { state, replay: this._replayResult(state, eventKey) };
    return { state, replay: null };
  }

  _finishMutation(state, previousVersion, eventKey, events) {
    if (eventKey && !state.appliedEventIds.includes(eventKey)) state.appliedEventIds.push(eventKey);
    state.version = previousVersion + 1;
    return {
      state,
      events,
      replay: false,
      persistence: {
        expectedVersion: previousVersion,
        nextVersion: state.version,
        snapshot: this.toPersistenceSnapshot(state),
      },
    };
  }

  toPersistenceSnapshot(inputState) {
    const state = this._validateState(inputState);
    return {
      characterId: state.characterId,
      level: state.level,
      experience: state.experience.toString(),
      deathState: state.deathState,
      death: state.death ? { ...state.death } : null,
      respawnRequest: state.respawnRequest ? { ...state.respawnRequest,
        point: state.respawnRequest.point ? { ...state.respawnRequest.point } : null } : null,
      immunityUntilMs: state.immunityUntilMs,
      version: state.version,
      appliedEventIds: [...state.appliedEventIds],
    };
  }

  restorePersistenceSnapshot(snapshot) {
    return this._validateState(snapshot);
  }

  _levelMutationEvents(state, fromLevel, source, metadata, levelUp) {
    const toLevel = state.level;
    let pointAward = null;
    if (levelUp && metadata && metadata.pointSnapshot) {
      pointAward = compute1298LevelPointRewards({ toLevel, ...metadata.pointSnapshot });
    }
    const reward = levelUp ? this.levelRewardPort.onLevelUp({
      characterId: state.characterId,
      fromLevel,
      toLevel,
      source,
      metadata,
      pointAward,
    }) : null;
    const vitals = this.vitalsPort.recalculateOnLevelChange({
      characterId: state.characterId,
      fromLevel,
      toLevel,
      levelUp,
      state: { ...state },
      source,
      metadata,
    });
    return [
      {
        type: levelUp ? 'progression.level_up' : 'progression.level_down',
        characterId: state.characterId,
        fromLevel,
        toLevel,
        pointAward,
        reward: reward ?? null,
        source,
      },
      {
        type: 'progression.level_mutated',
        characterId: state.characterId,
        fromLevel,
        toLevel,
        levelUp,
        vitals: vitals ?? null,
      },
      {
        type: 'progression.client_sync_required',
        characterId: state.characterId,
        reason: 'level_change',
        level: state.level,
        experience: state.experience,
        maxExperience: this._levelCap(state.level),
      },
    ];
  }

  applyExperienceDelta(inputState, delta, {
    source = XP_SOURCE.EXTERNAL,
    metadata = {},
    allowNegative = false,
    eventId = null,
    expectedVersion = null,
  } = {}) {
    const eventKey = this._eventKey('xp', eventId);
    const begun = this._beginMutation(inputState, { expectedVersion, eventKey });
    if (begun.replay) return begun.replay;
    const state = begun.state;
    const previousVersion = state.version;
    const amount = toSignedXp(delta, 'delta');
    const events = amount < 0n
      ? (() => {
        invariant(allowNegative, 'NEGATIVE_XP_NOT_ALLOWED', 'negative XP requires an authorized internal path');
        return this._applyLoss(state, -amount, { source, metadata });
      })()
      : this._applyGain(state, amount, { source, metadata });
    return this._finishMutation(state, previousVersion, eventKey, events);
  }

  _applyGain(state, gain, { source, metadata }) {
    const events = [];
    const maxLevel = this._maxLevel();
    const before = this._absoluteProgress(state.level, state.experience);
    state.experience += gain;

    if (state.level >= maxLevel) {
      const cap = this._levelCap(state.level);
      if (state.experience > cap) {
        const discardedXp = state.experience - cap;
        state.experience = cap;
        events.push({ type: 'progression.xp_saturated', characterId: state.characterId,
          discardedXp, level: state.level, source });
      }
    } else {
      const cap = this._levelCap(state.level);
      // Source ExpChange() performs one LevelChange() and returns. Do not loop.
      if (state.experience >= cap) {
        state.experience -= cap;
        const fromLevel = state.level;
        state.level += 1;
        events.push(...this._levelMutationEvents(state, fromLevel, source, metadata, true));
      }
    }

    const after = this._absoluteProgress(state.level, state.experience);
    events.push({
      type: 'progression.xp_changed',
      characterId: state.characterId,
      requestedDelta: gain,
      appliedDelta: after - before,
      level: state.level,
      experience: state.experience,
      maxExperience: this._levelCap(state.level),
      source,
    });
    return events;
  }

  _applyLoss(state, loss, { source, metadata }) {
    const events = [];
    if (state.level < 6) {
      events.push({ type: 'progression.xp_loss_suppressed', characterId: state.characterId, reason: 'level_below_6', source });
      return events;
    }
    const before = this._absoluteProgress(state.level, state.experience);
    state.experience -= loss;
    if (state.experience < 0n && state.level > 5) {
      const fromLevel = state.level;
      state.level -= 1;
      state.experience += this._levelCap(state.level);
      events.push(...this._levelMutationEvents(state, fromLevel, source, metadata, false));
    }
    const after = this._absoluteProgress(state.level, state.experience);
    events.push({
      type: 'progression.xp_changed',
      characterId: state.characterId,
      requestedDelta: -loss,
      appliedDelta: after - before,
      level: state.level,
      experience: state.experience,
      maxExperience: this._levelCap(state.level),
      source,
    });
    return events;
  }

  _absoluteProgress(level, experience) {
    let total = toSignedXp(experience, 'experience');
    for (let current = 1; current < level; current += 1) total += this._levelCap(current);
    return total;
  }

  _resolveKillXp(kill) {
    invariant(kill && typeof kill === 'object', 'INVALID_KILL', 'kill event is required');
    invariant(kill.eventId !== undefined && kill.eventId !== null, 'INVALID_KILL', 'kill.eventId is required for idempotency');
    const resolved = this.killRewardPort.resolveXp(kill);
    invariant(!(resolved && typeof resolved.then === 'function'), 'ASYNC_PORT_UNSUPPORTED', 'killRewardPort.resolveXp must be synchronous');
    return toXp(resolved, 'resolvedKillXp');
  }

  awardMonsterKill(inputState, kill, { expectedVersion = null, pointSnapshot = null } = {}) {
    const xp = this._resolveKillXp(kill);
    return this.applyExperienceDelta(inputState, xp, {
      source: XP_SOURCE.MOB_KILL,
      eventId: `kill:${kill.eventId}`,
      expectedVersion,
      metadata: {
        eventId: kill.eventId,
        mobInstanceId: kill.mobInstanceId ?? null,
        mobTemplateId: kill.mobTemplateId ?? null,
        killerCharacterId: kill.killerCharacterId ?? null,
        zoneId: kill.zoneId ?? null,
        pointSnapshot,
      },
    });
  }

  awardPartyMonsterKill(memberStates, kill, { pointSnapshots = new Map() } = {}) {
    invariant(Array.isArray(memberStates) && memberStates.length > 0, 'INVALID_PARTY', 'memberStates required');
    const baseXp = this._resolveKillXp(kill);
    const allocations = this.partyXpPort.allocate({
      baseXp,
      members: memberStates.map((s) => ({ characterId: s.characterId, level: s.level })),
      kill,
    });
    invariant(Array.isArray(allocations), 'INVALID_PARTY_ALLOCATION', 'allocator must return an array');
    const byId = new Map();
    for (const allocation of allocations) {
      invariant(allocation && allocation.characterId !== undefined, 'INVALID_PARTY_ALLOCATION', 'characterId required');
      invariant(!byId.has(allocation.characterId), 'INVALID_PARTY_ALLOCATION', 'duplicate party allocation');
      byId.set(allocation.characterId, toXp(allocation.xp, 'allocation.xp'));
    }
    return memberStates.map((memberState) => {
      invariant(byId.has(memberState.characterId), 'INVALID_PARTY_ALLOCATION', 'missing party allocation');
      const pointSnapshot = pointSnapshots instanceof Map ? pointSnapshots.get(memberState.characterId) : null;
      return {
        characterId: memberState.characterId,
        ...this.applyExperienceDelta(memberState, byId.get(memberState.characterId), {
          source: XP_SOURCE.PARTY_MOB_KILL,
          eventId: `party-kill:${kill.eventId}`,
          metadata: { eventId: kill.eventId, mobInstanceId: kill.mobInstanceId ?? null, pointSnapshot },
        }),
      };
    });
  }

  markDead(inputState, death, { allowXpLoss = true, expectedVersion = null } = {}) {
    invariant(death && typeof death === 'object', 'INVALID_DEATH', 'death context is required');
    const eventKey = this._eventKey('death', death.eventId ?? null);
    const begun = this._beginMutation(inputState, { expectedVersion, eventKey });
    if (begun.replay) return begun.replay;
    const state = begun.state;
    if (state.deathState !== DEATH_STATE.ALIVE) {
      return {
        state,
        events: [{ type: 'progression.death_ignored', characterId: state.characterId, reason: 'already_dead' }],
        replay: true,
        persistence: { expectedVersion: state.version, nextVersion: state.version, snapshot: this.toPersistenceSnapshot(state) },
      };
    }
    const previousVersion = state.version;
    state.deathState = DEATH_STATE.DEAD;
    state.death = {
      eventId: death.eventId ?? null,
      kind: death.kind || 'unknown',
      killerId: death.killerId ?? null,
      zoneId: death.zoneId ?? null,
      occurredAt: death.occurredAt ?? null,
      xpLossDivisor: death.xpLossDivisor ?? null,
    };
    state.respawnRequest = null;
    state.immunityUntilMs = null;

    const events = [{ type: 'progression.death', characterId: state.characterId, death: { ...state.death } }];
    const loss = toXp(this.deathLossPolicy.computeLoss({
      state,
      death: state.death,
      levelXpCap: this._levelCap(state.level),
      allowXpLoss,
    }), 'deathLoss');
    if (loss > 0n) events.push(...this._applyLoss(state, loss, { source: XP_SOURCE.DEATH_LOSS, metadata: { death: state.death } }));

    if (this.nationPointPort && typeof this.nationPointPort.onDeath === 'function') {
      events.push({
        type: 'progression.nation_point_handoff',
        characterId: state.characterId,
        result: this.nationPointPort.onDeath({ characterId: state.characterId, death: state.death }) ?? null,
      });
    }
    events.push({ type: 'progression.client_sync_required', characterId: state.characterId, reason: 'death' });
    return this._finishMutation(state, previousVersion, eventKey, events);
  }

  requestRespawn(inputState, request = {}, { expectedVersion = null } = {}) {
    invariant(request && (typeof request.requestId === 'string' || typeof request.requestId === 'number')
      && String(request.requestId).length > 0, 'INVALID_RESPAWN_REQUEST', 'request.requestId is required');
    const eventKey = this._eventKey('respawn_request', request.requestId);
    const begun = this._beginMutation(inputState, { expectedVersion, eventKey });
    if (begun.replay) return begun.replay;
    const state = begun.state;
    if (state.deathState === DEATH_STATE.RESPAWN_REQUESTED) {
      return {
        state,
        events: [{ type: 'progression.respawn_request_ignored', characterId: state.characterId, reason: 'already_requested' }],
        replay: true,
        persistence: { expectedVersion: state.version, nextVersion: state.version, snapshot: this.toPersistenceSnapshot(state) },
      };
    }
    invariant(state.deathState === DEATH_STATE.DEAD, 'NOT_DEAD', 'character must be dead before respawn request');
    const previousVersion = state.version;
    const point = this.respawnPointPort.resolve({
      characterId: state.characterId,
      level: state.level,
      death: state.death,
      requestedPointId: request.requestedPointId ?? null,
      zoneId: request.zoneId ?? state.death?.zoneId ?? null,
    });
    invariant(point && typeof point === 'object', 'INVALID_RESPAWN_POINT', 'respawn point required');
    state.deathState = DEATH_STATE.RESPAWN_REQUESTED;
    state.respawnRequest = {
      requestId: String(request.requestId),
      requestedPointId: request.requestedPointId ?? null,
      requestedAt: request.requestedAt ?? null,
      point: { ...point },
    };
    return this._finishMutation(state, previousVersion, eventKey, [{
      type: 'progression.respawn_requested',
      characterId: state.characterId,
      requestId: state.respawnRequest.requestId,
      point: { ...point },
    }]);
  }

  completeRespawn(inputState, { nowMs = this.clock(), expectedVersion = null } = {}) {
    const initial = this._validateState(inputState);
    invariant(initial.deathState === DEATH_STATE.RESPAWN_REQUESTED, 'RESPAWN_NOT_REQUESTED',
      'character must have a pending respawn request');
    const requestId = initial.respawnRequest.requestId;
    const eventKey = this._eventKey('respawn_complete', requestId);
    const begun = this._beginMutation(initial, { expectedVersion, eventKey });
    if (begun.replay) return begun.replay;
    const state = begun.state;
    const previousVersion = state.version;
    invariant(Number.isSafeInteger(nowMs) && nowMs >= 0, 'INVALID_TIME', 'nowMs must be a non-negative integer');
    const previousDeath = state.death ? { ...state.death } : null;
    const point = { ...state.respawnRequest.point };

    const vitals = this.respawnVitalsPort.restoreOnRespawn({
      characterId: state.characterId,
      state: { ...state },
      point,
      rule: { hp: 'restore_to_max', mp: 'preserve_for_normal_regene' },
    });
    const movement = this.movementBaselinePort.resetOnRespawn({ characterId: state.characterId, point });

    if (state.maxHp !== undefined && state.maxHp !== null) state.hp = state.maxHp;
    // Source normal Regene path does not establish an MP refill rule; preserve current MP.
    state.deathState = DEATH_STATE.ALIVE;
    state.death = null;
    state.respawnRequest = null;
    state.immunityUntilMs = nowMs + VERIFIED_RESPAWN_BLINK_MS_1298;

    const events = [
      { type: 'progression.respawn', characterId: state.characterId, point, previousDeath, vitals: vitals ?? null },
      { type: 'progression.movement_baseline_reset', characterId: state.characterId, point, result: movement ?? null },
      { type: 'progression.respawn_immunity_started', characterId: state.characterId,
        immunityUntilMs: state.immunityUntilMs, durationMs: VERIFIED_RESPAWN_BLINK_MS_1298 },
      { type: 'progression.client_sync_required', characterId: state.characterId, reason: 'respawn' },
    ];
    return this._finishMutation(state, previousVersion, eventKey, events);
  }

  respawn(inputState, request = {}, { nowMs = this.clock(), expectedVersion = null } = {}) {
    const requested = this.requestRespawn(inputState, request, { expectedVersion });
    if (requested.replay) return requested;
    const completed = this.completeRespawn(requested.state, { nowMs, expectedVersion: requested.state.version });
    return {
      ...completed,
      events: [...requested.events, ...completed.events],
      persistence: completed.persistence,
    };
  }

  assertGameplayAllowed(inputState, action, { nowMs = this.clock() } = {}) {
    const state = this._validateState(inputState);
    invariant(action === 'movement' || action === 'combat', 'INVALID_ACTION', 'action must be movement or combat');
    invariant(state.deathState === DEATH_STATE.ALIVE, 'DEAD_ACTION_FORBIDDEN', `${action} is forbidden while dead`);
    if (action === 'combat' && state.immunityUntilMs !== null && nowMs < state.immunityUntilMs) {
      throw new ProgressionError('RESPAWN_IMMUNITY', 'combat is forbidden during verified respawn blinking/immunity',
        { immunityUntilMs: state.immunityUntilMs, nowMs });
    }
    return true;
  }
}

module.exports = {
  DEATH_STATE,
  XP_SOURCE,
  VERIFIED_MAX_LEVEL_1298,
  VERIFIED_RESPAWN_BLINK_MS_1298,
  ProgressionService,
  Verified1298PveDeathLossPolicy,
  compute1298LevelPointRewards,
  toXp,
  toSignedXp,
};
