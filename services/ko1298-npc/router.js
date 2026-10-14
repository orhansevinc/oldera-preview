'use strict';

const {
  OPCODES,
  encodeNpcRegion,
  encodeNpcIn,
  encodeNpcOut,
  parseNpcInRequest,
  encodeNpcInResponse,
  parseNpcEventRequest,
  parseTargetHpRequest,
  encodeTargetHpResponse,
} = require('./protocol');

class NpcInteractionError extends Error {
  constructor(code, message, details = {}) {
    super(message || code);
    this.name = 'NpcInteractionError';
    this.code = code;
    this.details = details;
  }
}

function reject(reason, instanceId = null, details = {}) {
  return { kind: 'reject', reason, ...(instanceId == null ? {} : { instanceId }), ...details };
}

function distance2d(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function normalizeRoute(npc) {
  if (npc.interactionRoute) return npc.interactionRoute;
  if (npc.sellingGroup > 0) return 'merchant';
  if (npc.npcType === 31) return 'inn';
  return 'none';
}

class NpcInteractionRouter {
  constructor({
    world,
    merchant = null,
    quest = null,
    inn = null,
    worldTransition = null,
    target = null,
    interactionRange = null,
    interactionPolicy = null,
  } = {}) {
    if (!world) throw new TypeError('world is required');
    if (interactionRange != null && (!Number.isFinite(interactionRange) || interactionRange <= 0)) {
      throw new TypeError('interactionRange must be a positive finite number or null');
    }
    if (interactionPolicy != null && typeof interactionPolicy !== 'function') throw new TypeError('interactionPolicy must be a function');
    this.world = world;
    this.merchant = merchant;
    this.quest = quest;
    this.inn = inn;
    this.worldTransition = worldTransition;
    this.target = target;
    this.interactionRange = interactionRange;
    this.interactionPolicy = interactionPolicy;
  }

  nearbyPacket({ zoneId, x, z }) {
    return encodeNpcRegion(this.world.nearby(zoneId, x, z).map(n => n.instanceId));
  }

  regionSync({ zoneId, x, z }, previousIds = []) {
    const delta = this.world.regionDelta(zoneId, x, z, previousIds);
    return {
      ...delta,
      regionPacket: encodeNpcRegion(delta.ids),
      enterPackets: delta.enter.map(encodeNpcIn),
      leavePackets: delta.leave.map(encodeNpcOut),
    };
  }

  validateInteraction(session, npc) {
    if (!npc) return reject('unknown-npc');
    if (session?.zoneId == null) return reject('session-zone-unavailable', npc.instanceId);
    if (session.zoneId !== npc.zoneId) return reject('wrong-zone', npc.instanceId);
    if (npc.enabled === false) return reject('npc-disabled', npc.instanceId);
    if (npc.dead === true) return reject('npc-dead', npc.instanceId);
    if (npc.interactionVerified === false) return reject('interaction-unverified', npc.instanceId, { route: normalizeRoute(npc) });

    if (this.interactionPolicy) {
      const outcome = this.interactionPolicy({ session, npc });
      if (outcome === true || outcome?.ok === true) return { ok: true };
      const reason = typeof outcome === 'string' ? outcome : outcome?.reason || 'interaction-policy-rejected';
      return reject(reason, npc.instanceId);
    }

    if (this.interactionRange == null) return reject('range-policy-unconfigured', npc.instanceId);
    if (!Number.isFinite(session.x) || !Number.isFinite(session.z)) return reject('session-position-unavailable', npc.instanceId);
    const distance = distance2d(session, npc);
    if (distance > this.interactionRange) return reject('out-of-range', npc.instanceId, { distance, maxDistance: this.interactionRange });
    return { ok: true, distance };
  }

  assertInteraction({ session, npcId }) {
    const npc = this.world.get(npcId);
    const validation = this.validateInteraction(session, npc);
    if (validation.kind === 'reject') throw new NpcInteractionError(validation.reason, validation.reason, validation);
    return npc;
  }

  _wrapHandoff(route, npc, result) {
    return {
      kind: 'npc-interaction',
      status: 'handled',
      route,
      instanceId: npc.instanceId,
      templateSid: npc.templateSid ?? null,
      result,
    };
  }

  _handoff(route, context) {
    const handler = route === 'merchant' ? this.merchant
      : route === 'quest' ? this.quest
        : route === 'inn' ? this.inn
          : route === 'world' ? this.worldTransition
            : null;

    if (!handler) {
      return {
        kind: 'npc-interaction',
        status: 'unhandled',
        route,
        instanceId: context.npc.instanceId,
        templateSid: context.npc.templateSid ?? null,
      };
    }
    const result = handler(context);
    if (result && typeof result.then === 'function') return result.then(value => this._wrapHandoff(route, context.npc, value));
    return this._wrapHandoff(route, context.npc, result);
  }

  route(packet, session) {
    let buffer;
    try { buffer = Buffer.isBuffer(packet) ? packet : Buffer.from(packet); }
    catch { return reject('malformed-packet'); }
    const opcode = buffer.length ? buffer[0] : null;
    try {
      if (opcode === OPCODES.REQ_NPCIN) {
        const { instanceIds } = parseNpcInRequest(buffer);
        const npcs = instanceIds
          .map(id => this.world.get(id))
          .filter(npc => npc && (session?.zoneId == null || npc.zoneId === session.zoneId));
        return { kind: 'packets', packets: [encodeNpcInResponse(npcs)] };
      }
      if (opcode === OPCODES.NPC_EVENT) {
        const { instanceId } = parseNpcEventRequest(buffer);
        const npc = this.world.get(instanceId);
        if (!npc) return reject('unknown-npc', instanceId);
        const validation = this.validateInteraction(session, npc);
        if (validation.kind === 'reject') return validation;
        const interactionRoute = normalizeRoute(npc);
        if (interactionRoute === 'none') {
          return { kind: 'npc-interaction', status: 'unhandled', route: 'none', instanceId, templateSid: npc.templateSid ?? null };
        }
        return this._handoff(interactionRoute, { session, npc, action: 'interact' });
      }
      if (opcode === OPCODES.TARGET_HP) {
        const request = parseTargetHpRequest(buffer);
        const npc = this.world.get(request.instanceId);
        if (!npc) return reject('unknown-npc', request.instanceId);
        if (session?.zoneId != null && session.zoneId !== npc.zoneId) return reject('wrong-zone', npc.instanceId);
        if (this.target) return this.target({ session, npc, request });
        if (Number.isInteger(npc.maxHp) && Number.isInteger(npc.hp)) {
          return { kind: 'packets', packets: [encodeTargetHpResponse({ instanceId: npc.instanceId, immediate: request.immediate, maxHp: npc.maxHp, hp: npc.hp, change: 0 })] };
        }
        return { kind: 'target', npc, request };
      }
      return { kind: 'unhandled', opcode };
    } catch (error) {
      if (error instanceof NpcInteractionError) throw error;
      return reject('malformed-packet', null, { opcode, error: error.message });
    }
  }
}

module.exports = { NpcInteractionRouter, NpcInteractionError };
