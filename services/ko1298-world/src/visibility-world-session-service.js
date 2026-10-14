'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');
const { WorldSessionService: BaseWorldSessionService } = require('./world-session-service');
const { OPCODE, GAMESTART_PHASE, ZONE_CHANGE_PHASE, WORLD_STATE } = require('./constants');
const {
  runtimeIdOf,
  buildRegionNpcIds,
  parseNpcInRequest,
  buildSurroundingNpcs,
  buildNpcIn,
  buildNpcOut,
  assertUniqueRuntimeIds,
} = require('./visibility-protocol');

const DETAIL_STATES = new Set([
  WORLD_STATE.WAIT_GAMESTART_LOADED,
  WORLD_STATE.WORLD_READY,
  WORLD_STATE.LOADED,
]);

function requireFiniteVisibilityY(record, label) {
  const detail = record?.visibilityRecord || record?.detailRecord || record?.packetReadyDetail || record;
  const position = detail?.position || record?.position || detail;
  if (!position || !Number.isFinite(position.y)) {
    throw new Error(`${label} runtimeId ${String(safeRuntimeId(record))} requires finite authoritative Y`);
  }
  const authority = detail?.positionAuthority || record?.positionAuthority || detail?.heightAuthority || record?.heightAuthority;
  if (authority && authority.status !== 'authoritative') {
    throw new Error(`${label} runtimeId ${String(safeRuntimeId(record))} requires authoritative Y`);
  }
}

function safeRuntimeId(record) {
  try { return runtimeIdOf(record); } catch (_) { return record?.runtimeId ?? record?.instanceId ?? record?.nid ?? record?.id ?? 'unknown'; }
}

function cloneArray(value) {
  return Array.isArray(value) ? value.slice() : [];
}

function adaptNpcForLegacyBase(record) {
  const id = runtimeIdOf(record);
  if (record && record.nid === id) return record;
  return { ...record, nid: id };
}

class VisibilityWorldSessionService {
  constructor(options = {}) {
    if (!options.repository) throw new Error('repository is required');
    this.repository = options.repository;
    this.mobPort = options.mobPort || {};
    this.capture = new AsyncLocalStorage();
    this.visibility = new Map();

    const repository = new Proxy(this.repository, {
      get: (target, prop, receiver) => {
        if (prop === 'getSurroundingNpcs') {
          return async (args) => {
            const fn = Reflect.get(target, prop, receiver);
            if (typeof fn !== 'function') return [];
            const records = cloneArray(await fn.call(target, args));
            const store = this.capture.getStore();
            if (store) store.npcs = records;
            return records.map(adaptNpcForLegacyBase);
          };
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });

    const mobPort = new Proxy(this.mobPort, {
      get: (target, prop, receiver) => {
        if (prop === 'getNearby') {
          return async (args) => {
            const fn = Reflect.get(target, prop, receiver);
            const records = typeof fn === 'function' ? cloneArray(await fn.call(target, args)) : [];
            const store = this.capture.getStore();
            if (store) store.mobs = records;
            return [];
          };
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });

    this.base = new BaseWorldSessionService({
      ...options,
      repository,
      mobPort,
      bootstrapPort: {},
    });
  }

  beginSelectedCharacter(args) { return this.base.beginSelectedCharacter(args); }
  beginWorldEntry(args) { return this.base.beginWorldEntry(args); }
  restoreAuthoritativeSession(args) { return this.base.restoreAuthoritativeSession(args); }
  planWorldReposition(args) { return this.base.planWorldReposition(args); }
  beginMoradonZoneChange(...args) { return this.base.beginMoradonZoneChange(...args); }
  getSession(...args) { return this.base.getSession(...args); }
  getAuditTrail(...args) { return this.base.getAuditTrail(...args); }
  getCapabilities(...args) { return this.base.getCapabilities(...args); }

  requestZoneChange(args) {
    const response = this.base.requestZoneChange(args);
    const state = this.visibility.get(args.socketId);
    if (!state || !response.clientEntityCleanup) return response;
    response.clientEntityCleanup = {
      ...response.clientEntityCleanup,
      npcIds: Object.freeze([...state.npcs.keys()]),
      mobIds: Object.freeze([...state.mobs.keys()]),
    };
    return response;
  }

  disconnect(socketId, reason) {
    const response = this.base.disconnect(socketId, reason);
    this.visibility.delete(socketId);
    return response;
  }

  async handleClientPacket(socketId, packet) {
    const p = Buffer.from(packet);
    if (p.length === 0) throw new Error('empty packet');

    if (p[0] === OPCODE.REQUEST_NPC_IN) return this.#handleNpcInfoRequest(socketId, p);

    const isGameStartLoading = p[0] === OPCODE.GAMESTART && p[1] === GAMESTART_PHASE.LOADING;
    const isZoneLoading = p[0] === OPCODE.ZONE_CHANGE && p[1] === ZONE_CHANGE_PHASE.LOADING;
    if (!isGameStartLoading && !isZoneLoading) return this.base.handleClientPacket(socketId, p);

    const store = { socketId, npcs: [], mobs: [] };
    const response = await this.capture.run(store, () => this.base.handleClientPacket(socketId, p));
    const state = this.#materializeVisibilityState(store.npcs, store.mobs);
    this.visibility.set(socketId, state);
    response.clientPackets = replaceBootstrapRegionPacket(response.clientPackets, state);
    return response;
  }

  async #handleNpcInfoRequest(socketId, packet) {
    const session = this.base.getSession(socketId);
    if (!session) throw new Error(`world session not found for socket ${socketId}`);
    if (!DETAIL_STATES.has(session.state)) throw new Error(`WIZ_REQ_NPCIN invalid in state ${session.state}`);
    const ids = parseNpcInRequest(packet);
    const state = this.visibility.get(socketId) || { npcs: new Map(), mobs: new Map() };
    const details = [];
    for (const id of ids) {
      if (state.npcs.has(id)) {
        details.push(state.npcs.get(id));
        continue;
      }
      if (!state.mobs.has(id)) continue;
      let record = state.mobs.get(id);
      if (typeof this.mobPort.getDetail === 'function') {
        const resolved = await this.mobPort.getDetail(id, { socketId, zoneId: session.zoneId });
        if (resolved) record = resolved;
      }
      if (runtimeIdOf(record) !== id) throw new Error(`mob detail runtimeId mismatch for ${id}`);
      details.push(record);
    }
    return responseLike(session, [buildSurroundingNpcs(details)]);
  }

  enterNpcVisibility(socketId, npcRecord) {
    return this.#enterVisibility(socketId, 'npc', npcRecord);
  }

  leaveNpcVisibility(socketId, runtimeId) {
    return this.#leaveVisibility(socketId, 'npc', runtimeId);
  }

  consumeMobVisibilityEvent(socketId, mobRecord, event) {
    if (!event || typeof event.type !== 'string') throw new TypeError('WS25 visibility event.type is required');
    if (event.type === 'nearby-spawn') return this.#enterVisibility(socketId, 'mob', mobRecord);
    if (event.type === 'nearby-despawn') return this.#leaveVisibility(socketId, 'mob', runtimeIdOf(mobRecord));
    throw new Error(`unsupported WS25 visibility event ${event.type}`);
  }

  #materializeVisibilityState(npcs, mobs) {
    assertUniqueRuntimeIds(npcs, mobs);
    const npcMap = new Map();
    const mobMap = new Map();
    for (const npc of npcs) {
      requireFiniteVisibilityY(npc, 'NPC');
      npcMap.set(runtimeIdOf(npc), npc);
    }
    for (const mob of mobs) {
      requireFiniteVisibilityY(mob, 'mob');
      mobMap.set(runtimeIdOf(mob), mob);
    }
    return { npcs: npcMap, mobs: mobMap };
  }

  #enterVisibility(socketId, kind, record) {
    const session = this.base.getSession(socketId);
    if (!session || !DETAIL_STATES.has(session.state)) throw new Error(`${kind} IN invalid before world visibility state`);
    requireFiniteVisibilityY(record, kind);
    const id = runtimeIdOf(record);
    const state = this.visibility.get(socketId) || { npcs: new Map(), mobs: new Map() };
    const own = kind === 'npc' ? state.npcs : state.mobs;
    const other = kind === 'npc' ? state.mobs : state.npcs;
    if (other.has(id)) throw new Error(`runtime ID collision ${id}: ${kind} vs ${kind === 'npc' ? 'mob' : 'npc'}`);
    if (own.has(id)) throw new Error(`runtime ID collision ${id}: duplicate ${kind}`);
    own.set(id, record);
    this.visibility.set(socketId, state);
    return responseLike(session, [buildNpcIn(record)]);
  }

  #leaveVisibility(socketId, kind, runtimeId) {
    const session = this.base.getSession(socketId);
    if (!session || !DETAIL_STATES.has(session.state)) throw new Error(`${kind} OUT invalid before world visibility state`);
    const id = runtimeIdOf({ runtimeId });
    const state = this.visibility.get(socketId) || { npcs: new Map(), mobs: new Map() };
    const own = kind === 'npc' ? state.npcs : state.mobs;
    if (!own.has(id)) return { ...responseLike(session, []), ignored: true };
    own.delete(id);
    this.visibility.set(socketId, state);
    return responseLike(session, [buildNpcOut(id)]);
  }
}

function replaceBootstrapRegionPacket(packets, state) {
  const input = packets.map((packet) => Buffer.from(packet));
  const index = input.findIndex((packet) => packet[0] === OPCODE.REGION_NPC_IDS);
  if (index < 0) throw new Error('world bootstrap missing WIZ_NPC_REGION');
  const merged = [...state.npcs.values(), ...state.mobs.values()];
  input[index] = buildRegionNpcIds(merged);
  return [...input.slice(0, index + 1), input.at(-1)];
}

function responseLike(session, clientPackets) {
  return { state: session.state, clientPackets, broadcastPackets: [], snapshot: session };
}

module.exports = {
  WorldSessionService: VisibilityWorldSessionService,
  BaseWorldSessionService,
};
