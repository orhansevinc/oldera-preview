const { ProgressionError, invariant } = require('./errors');

const DEATH_STATE = Object.freeze({ ALIVE: 'alive', DEAD: 'dead' });
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

class Verified1298PveDeathLossPolicy {
  computeLoss({ state, death, levelXpCap, allowXpLoss = true }) {
    if (!allowXpLoss || !death || death.kind !== 'monster' || state.level < 6) return 0n;
    return toXp(levelXpCap, 'levelXpCap') / 100n;
  }
}

class ProgressionService {
  constructor({ levelTable, levelRewardPort, partyXpPort, respawnPointPort, nationPointPort = null,
    deathLossPolicy = new Verified1298PveDeathLossPolicy(), minimumDelevelLevel = 6 }) {
    invariant(levelTable && typeof levelTable.getMaxLevel === 'function', 'MISSING_PORT', 'levelTable.getMaxLevel is required');
    invariant(levelTable && typeof levelTable.getLevelXpCap === 'function', 'MISSING_PORT', 'levelTable.getLevelXpCap is required');
    invariant(levelRewardPort && typeof levelRewardPort.onLevelUp === 'function', 'MISSING_PORT', 'levelRewardPort.onLevelUp is required');
    invariant(partyXpPort && typeof partyXpPort.allocate === 'function', 'MISSING_PORT', 'partyXpPort.allocate is required');
    invariant(respawnPointPort && typeof respawnPointPort.resolve === 'function', 'MISSING_PORT', 'respawnPointPort.resolve is required');
    invariant(Number.isInteger(minimumDelevelLevel) && minimumDelevelLevel >= 1, 'INVALID_POLICY', 'minimumDelevelLevel must be positive');
    this.levelTable = levelTable;
    this.levelRewardPort = levelRewardPort;
    this.partyXpPort = partyXpPort;
    this.respawnPointPort = respawnPointPort;
    this.nationPointPort = nationPointPort;
    this.deathLossPolicy = deathLossPolicy;
    this.minimumDelevelLevel = minimumDelevelLevel;
  }

  _maxLevel() {
    const max = this.levelTable.getMaxLevel();
    invariant(Number.isInteger(max) && max >= 1 && max <= 255, 'INVALID_LEVEL_TABLE', 'max level must be in [1,255]');
    return max;
  }

  _levelCap(level) {
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
    const experience = toXp(input.experience, 'state.experience');
    const cap = this._levelCap(input.level);
    invariant(experience <= cap, 'INVALID_XP', 'state.experience exceeds configured level cap');
    const deathState = input.deathState || DEATH_STATE.ALIVE;
    invariant(deathState === DEATH_STATE.ALIVE || deathState === DEATH_STATE.DEAD,
      'INVALID_DEATH_STATE', 'deathState must be alive or dead');
    return { ...input, experience, deathState, death: input.death ? { ...input.death } : null };
  }

  applyExperienceDelta(inputState, delta, { source = XP_SOURCE.EXTERNAL, metadata = {}, allowNegative = false } = {}) {
    const state = this._validateState(inputState);
    const amount = toSignedXp(delta, 'delta');
    if (amount < 0n) {
      invariant(allowNegative, 'NEGATIVE_XP_NOT_ALLOWED', 'negative XP requires allowNegative=true');
      return this._applyLoss(state, -amount, { source, metadata });
    }
    return this._applyGain(state, amount, { source, metadata });
  }

  _applyGain(state, gain, { source, metadata }) {
    const events = [];
    const maxLevel = this._maxLevel();
    let remaining = gain;
    while (remaining > 0n) {
      const cap = this._levelCap(state.level);
      if (state.level >= maxLevel) {
        const room = cap - state.experience;
        const applied = remaining > room ? room : remaining;
        state.experience += applied;
        remaining -= applied;
        if (remaining > 0n) events.push({ type: 'progression.xp_saturated', characterId: state.characterId,
          discardedXp: remaining, level: state.level, source });
        remaining = 0n;
        break;
      }
      const room = cap - state.experience;
      if (remaining < room) {
        state.experience += remaining;
        remaining = 0n;
        break;
      }
      remaining -= room;
      state.experience = 0n;
      const fromLevel = state.level++;
      const reward = this.levelRewardPort.onLevelUp({ characterId: state.characterId, fromLevel,
        toLevel: state.level, source, metadata });
      events.push({ type: 'progression.level_up', characterId: state.characterId, fromLevel,
        toLevel: state.level, reward: reward ?? null, source });
    }
    events.push({ type: 'progression.xp_changed', characterId: state.characterId, delta: gain,
      level: state.level, experience: state.experience, source });
    return { state, events };
  }

  _applyLoss(state, loss, { source, metadata }) {
    const events = [];
    const before = this._absoluteProgress(state.level, state.experience);
    let remaining = loss;
    while (remaining > 0n) {
      if (state.level < this.minimumDelevelLevel) {
        state.experience = 0n;
        break;
      }
      if (remaining <= state.experience) {
        state.experience -= remaining;
        remaining = 0n;
        break;
      }
      remaining -= state.experience;
      const fromLevel = state.level;
      state.level -= 1;
      const previousCap = this._levelCap(state.level);
      if (remaining >= previousCap) {
        state.experience = 0n;
        remaining -= previousCap;
      } else {
        state.experience = previousCap - remaining;
        remaining = 0n;
      }
      events.push({ type: 'progression.level_down', characterId: state.characterId,
        fromLevel, toLevel: state.level, source, metadata });
    }
    const after = this._absoluteProgress(state.level, state.experience);
    events.push({ type: 'progression.xp_changed', characterId: state.characterId, delta: -(before - after),
      level: state.level, experience: state.experience, source });
    return { state, events };
  }

  _absoluteProgress(level, experience) {
    let total = toXp(experience, 'experience');
    for (let current = 1; current < level; current += 1) total += this._levelCap(current);
    return total;
  }

  awardMonsterKill(state, kill) {
    invariant(kill && typeof kill === 'object', 'INVALID_KILL', 'kill event is required');
    return this.applyExperienceDelta(state, toXp(kill.xp, 'kill.xp'), { source: XP_SOURCE.MOB_KILL,
      metadata: { mobInstanceId: kill.mobInstanceId ?? null, mobTemplateId: kill.mobTemplateId ?? null } });
  }

  awardPartyMonsterKill(memberStates, kill) {
    invariant(Array.isArray(memberStates) && memberStates.length > 0, 'INVALID_PARTY', 'memberStates required');
    invariant(kill && typeof kill === 'object', 'INVALID_KILL', 'kill event is required');
    const allocations = this.partyXpPort.allocate({ baseXp: toXp(kill.xp, 'kill.xp'),
      members: memberStates.map((s) => ({ characterId: s.characterId, level: s.level })), kill });
    invariant(Array.isArray(allocations), 'INVALID_PARTY_ALLOCATION', 'allocator must return an array');
    const byId = new Map();
    for (const a of allocations) {
      invariant(a && a.characterId !== undefined, 'INVALID_PARTY_ALLOCATION', 'characterId required');
      invariant(!byId.has(a.characterId), 'INVALID_PARTY_ALLOCATION', 'duplicate party allocation');
      byId.set(a.characterId, toXp(a.xp, 'allocation.xp'));
    }
    return memberStates.map((s) => {
      invariant(byId.has(s.characterId), 'INVALID_PARTY_ALLOCATION', 'missing party allocation');
      return { characterId: s.characterId, ...this.applyExperienceDelta(s, byId.get(s.characterId),
        { source: XP_SOURCE.PARTY_MOB_KILL, metadata: { mobInstanceId: kill.mobInstanceId ?? null } }) };
    });
  }

  markDead(inputState, death, { allowXpLoss = true } = {}) {
    const state = this._validateState(inputState);
    invariant(state.deathState === DEATH_STATE.ALIVE, 'ALREADY_DEAD', 'character is already dead');
    invariant(death && typeof death === 'object', 'INVALID_DEATH', 'death context is required');
    state.deathState = DEATH_STATE.DEAD;
    state.death = { kind: death.kind || 'unknown', killerId: death.killerId ?? null,
      zoneId: death.zoneId ?? null, occurredAt: death.occurredAt ?? null };
    const loss = toXp(this.deathLossPolicy.computeLoss({ state, death: state.death,
      levelXpCap: this._levelCap(state.level), allowXpLoss }), 'deathLoss');
    const lossResult = loss > 0n ? this._applyLoss(state, loss,
      { source: XP_SOURCE.DEATH_LOSS, metadata: { death: state.death } }) : { state, events: [] };
    const events = [{ type: 'progression.death', characterId: state.characterId, death: state.death },
      ...lossResult.events];
    if (this.nationPointPort && typeof this.nationPointPort.onDeath === 'function') {
      events.push({ type: 'progression.nation_point_handoff', characterId: state.characterId,
        result: this.nationPointPort.onDeath({ characterId: state.characterId, death: state.death }) ?? null });
    }
    return { state, events };
  }

  respawn(inputState, request = {}) {
    const state = this._validateState(inputState);
    invariant(state.deathState === DEATH_STATE.DEAD, 'NOT_DEAD', 'character must be dead before respawn');
    const point = this.respawnPointPort.resolve({ characterId: state.characterId, level: state.level,
      death: state.death, requestedPointId: request.requestedPointId ?? null,
      zoneId: request.zoneId ?? state.death?.zoneId ?? null });
    invariant(point && typeof point === 'object', 'INVALID_RESPAWN_POINT', 'respawn point required');
    const previousDeath = state.death;
    state.deathState = DEATH_STATE.ALIVE;
    state.death = null;
    return { state, events: [{ type: 'progression.respawn', characterId: state.characterId, point, previousDeath }] };
  }
}

module.exports = { DEATH_STATE, XP_SOURCE, ProgressionService, Verified1298PveDeathLossPolicy, toXp, toSignedXp };
