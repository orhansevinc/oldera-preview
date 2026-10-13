'use strict';

const {
  ProtocolError,
  classifyMoveFlag,
  decodeMovePayload,
  decodeRotatePayload,
  encodeMoveBroadcast,
  encodeRotateBroadcast,
} = require('./protocol');
const { SlidingWindowFloodGuard } = require('./flood-guard');
const { isFinitePosition } = require('./zone-bounds');

const DEFAULT_CONFIG = Object.freeze({
  absoluteMaxSpeed: 50,
  speedToleranceMultiplier: 1.35,
  positionSlack: 1.5,
  startPredictionSeconds: 1.25,
  stopPredictionSeconds: 1.25,
  networkGraceSeconds: 0.25,
  maxUpdateGapSeconds: 3,
  maxVerticalDeltaPerPacket: 64,
  includeSenderInBroadcast: true,
});

class MovementRejectedError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'MovementRejectedError';
    this.code = code;
    this.details = details;
  }
}

function clonePosition(position) {
  return { x: position.x, y: position.y, z: position.z };
}

function cloneState(state) {
  return {
    sessionId: state.sessionId,
    entityId: state.entityId,
    zoneId: state.zoneId,
    position: clonePosition(state.position),
    targetPosition: clonePosition(state.targetPosition),
    headingRaw: state.headingRaw,
    moving: state.moving,
    speed: state.speed,
    moveFlag: state.moveFlag,
    sequence: state.sequence,
    lastAcceptedAtMs: state.lastAcceptedAtMs,
    lastMoveAtMs: state.lastMoveAtMs,
    teleportGeneration: state.teleportGeneration,
    maxSpeed: state.maxSpeed,
  };
}

function horizontalDistance(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function ensureSessionId(sessionId) {
  if ((typeof sessionId !== 'string' && typeof sessionId !== 'number') || String(sessionId).length === 0) {
    throw new TypeError('sessionId must be a non-empty string or number');
  }
}

class MovementService {
  constructor({
    zoneBounds,
    broadcast = () => {},
    onTeleport = () => {},
    onDisconnect = () => {},
    clock = () => Date.now(),
    speedPolicy = null,
    floodGuard = null,
    config = {},
  } = {}) {
    if (!zoneBounds || typeof zoneBounds.isValidPosition !== 'function') {
      throw new TypeError('zoneBounds.isValidPosition(zoneId, position) is required');
    }
    if (typeof broadcast !== 'function') throw new TypeError('broadcast must be a function');
    if (typeof onTeleport !== 'function') throw new TypeError('onTeleport must be a function');
    if (typeof onDisconnect !== 'function') throw new TypeError('onDisconnect must be a function');
    if (typeof clock !== 'function') throw new TypeError('clock must be a function');
    if (speedPolicy !== null && typeof speedPolicy !== 'function') throw new TypeError('speedPolicy must be a function');

    this.zoneBounds = zoneBounds;
    this.broadcast = broadcast;
    this.onTeleport = onTeleport;
    this.onDisconnect = onDisconnect;
    this.clock = clock;
    this.speedPolicy = speedPolicy;
    this.floodGuard = floodGuard || new SlidingWindowFloodGuard();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.#validateConfig();
    this.sessions = new Map();
  }

  registerSession({ sessionId, entityId, zoneId, position, headingRaw = 0, maxSpeed = null }) {
    ensureSessionId(sessionId);
    if (!Number.isInteger(entityId) || entityId < 0 || entityId > 0xffff) {
      throw new RangeError('entityId must fit uint16');
    }
    if (!Number.isInteger(zoneId)) throw new TypeError('zoneId must be an integer');
    this.#assertFiniteAndWirePosition(position);
    if (!this.zoneBounds.isValidPosition(zoneId, position)) {
      throw new MovementRejectedError('zone_bounds', 'initial position is outside zone bounds');
    }
    if (!Number.isInteger(headingRaw) || headingRaw < -0x8000 || headingRaw > 0x7fff) {
      throw new RangeError('headingRaw must fit int16');
    }
    if (maxSpeed !== null && (!Number.isFinite(maxSpeed) || maxSpeed < 0)) {
      throw new TypeError('maxSpeed must be finite and >= 0');
    }

    const nowMs = this.#now();
    const state = {
      sessionId,
      entityId,
      zoneId,
      position: clonePosition(position),
      targetPosition: clonePosition(position),
      headingRaw,
      moving: false,
      speed: 0,
      moveFlag: 0,
      sequence: 0,
      lastAcceptedAtMs: nowMs,
      lastMoveAtMs: null,
      teleportGeneration: 0,
      maxSpeed,
    };
    this.sessions.set(sessionId, state);
    return cloneState(state);
  }

  hasSession(sessionId) {
    return this.sessions.has(sessionId);
  }

  getState(sessionId) {
    const state = this.sessions.get(sessionId);
    return state ? cloneState(state) : null;
  }

  handleMovePacket(sessionId, payload) {
    let decoded;
    try {
      decoded = decodeMovePayload(payload);
    } catch (error) {
      if (error instanceof ProtocolError) {
        throw new MovementRejectedError(error.code, error.message);
      }
      throw error;
    }
    return this.handleMove(sessionId, decoded);
  }

  handleMove(sessionId, move) {
    const state = this.#requireState(sessionId);
    const nowMs = this.#now();
    this.#checkFlood(sessionId, 'move', nowMs);
    this.#validateMoveShape(move);
    this.#assertFiniteAndWirePosition(move.position);

    if (!this.zoneBounds.isValidPosition(state.zoneId, move.position)) {
      throw new MovementRejectedError('zone_bounds', 'movement target is outside zone bounds', { position: move.position });
    }

    const allowedMaxSpeed = this.#allowedMaxSpeed(state);
    if (move.speed > allowedMaxSpeed) {
      throw new MovementRejectedError('speed_limit', 'reported speed exceeds authoritative limit', {
        speed: move.speed,
        allowedMaxSpeed,
      });
    }

    if (move.phase === 'end' && move.rawSpeed !== 0) {
      throw new MovementRejectedError('stop_with_speed', 'stop packet must report zero speed');
    }
    if (move.moving && move.rawSpeed === 0) {
      throw new MovementRejectedError('moving_with_zero_speed', 'moving packet must report non-zero speed');
    }

    this.#validateMovementRange(state, move, nowMs);

    if (move.moving) {
      // 1298 semantics: previous predicted target becomes authoritative current position,
      // and this packet becomes the next predicted target.
      state.position = clonePosition(state.targetPosition);
      state.targetPosition = clonePosition(move.position);
      state.moving = true;
      state.speed = move.speed;
    } else {
      state.position = clonePosition(move.position);
      state.targetPosition = clonePosition(move.position);
      state.moving = false;
      state.speed = 0;
    }

    state.moveFlag = move.flag;
    state.sequence += 1;
    state.lastMoveAtMs = nowMs;
    state.lastAcceptedAtMs = nowMs;

    const packet = encodeMoveBroadcast(state.entityId, move);
    const recipients = this.#sameZoneRecipients(state.zoneId, sessionId);
    this.broadcast({
      kind: 'move',
      zoneId: state.zoneId,
      senderSessionId: sessionId,
      recipients,
      packet,
      state: cloneState(state),
      phase: move.phase,
    });

    return {
      accepted: true,
      phase: move.phase,
      recipients,
      packet,
      state: cloneState(state),
    };
  }

  handleRotatePacket(sessionId, payload) {
    let decoded;
    try {
      decoded = decodeRotatePayload(payload);
    } catch (error) {
      if (error instanceof ProtocolError) throw new MovementRejectedError(error.code, error.message);
      throw error;
    }
    return this.handleRotate(sessionId, decoded.headingRaw);
  }

  handleRotate(sessionId, headingRaw) {
    const state = this.#requireState(sessionId);
    const nowMs = this.#now();
    this.#checkFlood(sessionId, 'rotate', nowMs);
    if (!Number.isInteger(headingRaw) || headingRaw < -0x8000 || headingRaw > 0x7fff) {
      throw new MovementRejectedError('invalid_heading', 'headingRaw must fit int16');
    }

    state.headingRaw = headingRaw;
    state.sequence += 1;
    state.lastAcceptedAtMs = nowMs;

    const packet = encodeRotateBroadcast(state.entityId, headingRaw);
    const recipients = this.#sameZoneRecipients(state.zoneId, sessionId);
    this.broadcast({
      kind: 'rotate',
      zoneId: state.zoneId,
      senderSessionId: sessionId,
      recipients,
      packet,
      state: cloneState(state),
    });

    return { accepted: true, recipients, packet, state: cloneState(state) };
  }

  teleport(sessionId, { zoneId, position, headingRaw = null, reason = 'world-authorized' }) {
    const state = this.#requireState(sessionId);
    if (!Number.isInteger(zoneId)) throw new MovementRejectedError('invalid_zone', 'teleport zoneId must be an integer');
    this.#assertFiniteAndWirePosition(position);
    if (!this.zoneBounds.isValidPosition(zoneId, position)) {
      throw new MovementRejectedError('zone_bounds', 'teleport destination is outside zone bounds', { zoneId, position });
    }
    if (headingRaw !== null && (!Number.isInteger(headingRaw) || headingRaw < -0x8000 || headingRaw > 0x7fff)) {
      throw new MovementRejectedError('invalid_heading', 'teleport headingRaw must fit int16');
    }

    const previous = cloneState(state);
    const nowMs = this.#now();
    state.zoneId = zoneId;
    state.position = clonePosition(position);
    state.targetPosition = clonePosition(position);
    if (headingRaw !== null) state.headingRaw = headingRaw;
    state.moving = false;
    state.speed = 0;
    state.moveFlag = 0;
    state.sequence += 1;
    state.lastMoveAtMs = null;
    state.lastAcceptedAtMs = nowMs;
    state.teleportGeneration += 1;

    const next = cloneState(state);
    // Deliberately no WIZ_MOVE broadcast here. WIZ_WARP/zone transition belongs to the
    // world/session layer; this only resets the authoritative movement baseline.
    this.onTeleport({ sessionId, reason, previous, state: next });
    return next;
  }

  disconnect(sessionId) {
    const state = this.sessions.get(sessionId);
    if (!state) return false;
    const snapshot = cloneState(state);
    this.sessions.delete(sessionId);
    if (this.floodGuard && typeof this.floodGuard.cleanup === 'function') {
      this.floodGuard.cleanup(sessionId);
    }
    this.onDisconnect({ sessionId, state: snapshot });
    return true;
  }

  #requireState(sessionId) {
    const state = this.sessions.get(sessionId);
    if (!state) throw new MovementRejectedError('unknown_session', 'movement session is not registered');
    return state;
  }

  #now() {
    const value = Number(this.clock());
    if (!Number.isFinite(value) || value < 0) throw new Error('clock must return a finite non-negative millisecond timestamp');
    return value;
  }

  #checkFlood(sessionId, kind, nowMs) {
    if (!this.floodGuard || typeof this.floodGuard.check !== 'function') return;
    const result = this.floodGuard.check({ sessionId, kind, nowMs });
    if (result === false || (result && result.allow === false)) {
      throw new MovementRejectedError('packet_flood', result?.reason || 'packet flood rejected', result?.event || {});
    }
  }

  #allowedMaxSpeed(state) {
    let limit = state.maxSpeed;
    if (this.speedPolicy) {
      const dynamicLimit = this.speedPolicy(cloneState(state));
      if (!Number.isFinite(dynamicLimit) || dynamicLimit < 0) {
        throw new Error('speedPolicy must return a finite non-negative speed');
      }
      limit = limit === null ? dynamicLimit : Math.min(limit, dynamicLimit);
    }
    if (limit === null) limit = this.config.absoluteMaxSpeed;
    return Math.min(limit, this.config.absoluteMaxSpeed);
  }

  #validateMoveShape(move) {
    if (!move || typeof move !== 'object') throw new MovementRejectedError('invalid_move', 'move must be an object');

    for (const [key, min, max] of [
      ['rawX', 0, 0xffff],
      ['rawZ', 0, 0xffff],
      ['rawY', -0x8000, 0x7fff],
      ['rawSpeed', 0, 0xffff],
      ['flag', 0, 0xff],
    ]) {
      if (!Number.isInteger(move[key]) || move[key] < min || move[key] > max) {
        throw new MovementRejectedError('integer_overflow', `${key} is outside its 1298 wire range`);
      }
    }

    let classified;
    try {
      classified = classifyMoveFlag(move.flag);
    } catch (error) {
      if (error instanceof ProtocolError) throw new MovementRejectedError(error.code, error.message);
      throw error;
    }

    if (!Number.isFinite(move.speed) || move.speed < 0) {
      throw new MovementRejectedError('invalid_speed', 'speed must be finite and non-negative');
    }
    if (move.phase !== classified.phase
      || move.moving !== classified.moving
      || Boolean(move.continuous) !== classified.continuous) {
      throw new MovementRejectedError('invalid_phase', 'movement metadata is inconsistent with the wire flag');
    }
    if (!isFinitePosition(move.position)) {
      throw new MovementRejectedError('non_finite_coordinate', 'position contains NaN or Infinity');
    }

    const epsilon = 1e-9;
    if (Math.abs(move.position.x - move.rawX / 10) > epsilon
      || Math.abs(move.position.z - move.rawZ / 10) > epsilon
      || Math.abs(move.position.y - move.rawY / 10) > epsilon) {
      throw new MovementRejectedError('wire_position_mismatch', 'decoded position does not match raw 1298 coordinates');
    }
    if (Math.abs(move.speed - move.rawSpeed / 10) > epsilon) {
      throw new MovementRejectedError('wire_speed_mismatch', 'decoded speed does not match raw 1298 speed');
    }
  }

  #validateConfig() {
    for (const key of [
      'absoluteMaxSpeed',
      'speedToleranceMultiplier',
      'positionSlack',
      'startPredictionSeconds',
      'stopPredictionSeconds',
      'networkGraceSeconds',
      'maxUpdateGapSeconds',
      'maxVerticalDeltaPerPacket',
    ]) {
      const value = this.config[key];
      if (!Number.isFinite(value) || value < 0) {
        throw new TypeError(`config.${key} must be finite and non-negative`);
      }
    }
    if (this.config.speedToleranceMultiplier === 0) {
      throw new TypeError('config.speedToleranceMultiplier must be > 0');
    }
    if (typeof this.config.includeSenderInBroadcast !== 'boolean') {
      throw new TypeError('config.includeSenderInBroadcast must be boolean');
    }
  }

  #assertFiniteAndWirePosition(position) {
    if (!isFinitePosition(position)) {
      throw new MovementRejectedError('non_finite_coordinate', 'position contains NaN or Infinity');
    }
    // 1298 wire representation: X/Z uint16 and Y int16, all scaled by 10.
    const rawX = position.x * 10;
    const rawZ = position.z * 10;
    const rawY = position.y * 10;
    if (rawX < 0 || rawX > 0xffff || rawZ < 0 || rawZ > 0xffff || rawY < -0x8000 || rawY > 0x7fff) {
      throw new MovementRejectedError('coordinate_overflow', 'position cannot be represented by the 1298 movement packet');
    }
  }

  #validateMovementRange(state, move, nowMs) {
    const elapsedSeconds = state.lastMoveAtMs === null
      ? 0
      : Math.max(0, Math.min((nowMs - state.lastMoveAtMs) / 1000, this.config.maxUpdateGapSeconds));

    let anchor;
    let budgetSeconds;
    let speedForBudget = move.speed;

    if (move.phase === 'start') {
      anchor = state.position;
      budgetSeconds = this.config.startPredictionSeconds + this.config.networkGraceSeconds;
    } else if (move.phase === 'update') {
      anchor = state.targetPosition;
      budgetSeconds = elapsedSeconds + this.config.networkGraceSeconds;
    } else {
      const distanceToCurrent = horizontalDistance(state.position, move.position);
      const distanceToTarget = horizontalDistance(state.targetPosition, move.position);
      const previousSpeed = state.speed;
      const budget = previousSpeed * (this.config.stopPredictionSeconds + elapsedSeconds + this.config.networkGraceSeconds)
        * this.config.speedToleranceMultiplier + this.config.positionSlack;
      if (Math.min(distanceToCurrent, distanceToTarget) > budget) {
        throw new MovementRejectedError('range_limit', 'stop position is outside the accepted movement envelope', {
          distanceToCurrent,
          distanceToTarget,
          allowedDistance: budget,
        });
      }
      const verticalDelta = Math.min(
        Math.abs(move.position.y - state.position.y),
        Math.abs(move.position.y - state.targetPosition.y),
      );
      if (verticalDelta > this.config.maxVerticalDeltaPerPacket) {
        throw new MovementRejectedError('vertical_range_limit', 'vertical displacement is too large', { verticalDelta });
      }
      return;
    }

    const distance = horizontalDistance(anchor, move.position);
    const allowedDistance = speedForBudget * budgetSeconds * this.config.speedToleranceMultiplier + this.config.positionSlack;
    if (distance > allowedDistance) {
      throw new MovementRejectedError('range_limit', 'movement target is outside the accepted speed/range envelope', {
        distance,
        allowedDistance,
        elapsedSeconds,
        phase: move.phase,
      });
    }

    const verticalDelta = Math.abs(move.position.y - anchor.y);
    if (verticalDelta > this.config.maxVerticalDeltaPerPacket) {
      throw new MovementRejectedError('vertical_range_limit', 'vertical displacement is too large', { verticalDelta });
    }
  }

  #sameZoneRecipients(zoneId, senderSessionId) {
    const recipients = [];
    for (const state of this.sessions.values()) {
      if (state.zoneId !== zoneId) continue;
      if (!this.config.includeSenderInBroadcast && state.sessionId === senderSessionId) continue;
      recipients.push(state.sessionId);
    }
    return recipients;
  }
}

module.exports = {
  DEFAULT_CONFIG,
  MovementRejectedError,
  MovementService,
  horizontalDistance,
};
