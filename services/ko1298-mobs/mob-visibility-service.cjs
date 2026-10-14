'use strict';

const { MobService: DomainMobService } = require('./mob-service.cjs');
const { MobState } = require('./mob-model.cjs');
const { visibilityAuthorityForTemplate } = require('./mob-visibility-authority.cjs');

// Current WS16 convention. This is validation only; WS25 does not allocate this namespace.
const NPC_BAND = 10000;
const INVALID_BAND = 30000;
const I16_MAX = 0x7fff;
const REGION_SIZE = 48;

function noop() {}
function invisible() { return false; }

function assertRuntimeId(value, sourceIdentity) {
  if (!Number.isInteger(value)) {
    throw new TypeError(`ko1298-mobs: runtimeIds.claim(${sourceIdentity}) must return an integer`);
  }
  if (value < NPC_BAND || value >= INVALID_BAND || value > I16_MAX) {
    throw new RangeError(`ko1298-mobs: runtime id ${value} for ${sourceIdentity} is outside the WS16/WIZ_NPC signed-16 band`);
  }
  return value;
}

function finite(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`ko1298-mobs: ${label} must be finite`);
  return value;
}

function regionOf(value) {
  return Math.floor(finite(value, 'visibility coordinate') / REGION_SIZE);
}

class MobVisibilityService extends DomainMobService {
  constructor(worldDefinition, ports = {}) {
    const originalWorld = ports.world ?? {};
    let service = null;
    const attach = (snapshot) => service ? service._attachRuntimeIdentity(snapshot) : snapshot;

    const wrappedWorld = {
      ...originalWorld,
      isMobVisibleToPlayer: (player, snapshot) => (
        (originalWorld.isMobVisibleToPlayer ?? invisible)(player, attach(snapshot))
      ),
      onMobSpawn: (snapshot, event) => {
        const visible = attach(snapshot);
        (originalWorld.onMobSpawn ?? noop)(visible, event);
        if (service) service._emitSemanticVisibility('IN', visible, event, null);
      },
      onMobStateChange: (snapshot, event) => (
        (originalWorld.onMobStateChange ?? noop)(attach(snapshot), event)
      ),
      onMobDespawn: (snapshot, event) => {
        const visible = attach(snapshot);
        (originalWorld.onMobDespawn ?? noop)(visible, event);
        if (service) service._emitSemanticVisibility('OUT', visible, event, null);
      },
      onNearbyMobSpawn: (player, snapshot, event) => {
        const visible = attach(snapshot);
        (originalWorld.onNearbyMobSpawn ?? noop)(player, visible, event);
        if (service) service._emitSemanticVisibility('IN', visible, event, player);
      },
      onNearbyMobDespawn: (player, snapshot, event) => {
        const visible = attach(snapshot);
        (originalWorld.onNearbyMobDespawn ?? noop)(player, visible, event);
        if (service) service._emitSemanticVisibility('OUT', visible, event, player);
      },
    };

    super(worldDefinition, { ...ports, world: wrappedWorld });
    service = this;
    this.runtimeIds = ports.runtimeIds ?? null;
    this.visibilityPort = ports.visibility ?? null;
    this.runtimeBySource = new Map();
    this.sourceByRuntime = new Map();
    this.runtimeIdentityStatus = this._claimRuntimeIds();
  }

  _claimRuntimeIds() {
    const claim = this.runtimeIds?.claim;
    if (typeof claim !== 'function') {
      return Object.freeze({ ready: false, reason: 'runtimeIds.claim port not supplied', claimed: 0 });
    }

    let claimed = 0;
    for (const mob of this._orderedMobs()) {
      const runtimeId = assertRuntimeId(claim(Object.freeze({
        namespace: 'KO1298_NPC',
        kind: 'mob',
        zoneId: Number(mob.zoneId),
        sourceIdentity: mob.id,
        templateId: mob.templateId,
        groupId: mob.groupId,
        spawnId: mob.spawnId,
        sourceRef: mob.sourceRef,
      })), mob.id);
      if (this.sourceByRuntime.has(runtimeId)) {
        throw new Error(`ko1298-mobs: runtime allocator returned duplicate id ${runtimeId}`);
      }
      mob.sourceIdentity = mob.id;
      mob.runtimeId = runtimeId;
      mob.instanceId = runtimeId;
      this.runtimeBySource.set(mob.id, runtimeId);
      this.sourceByRuntime.set(runtimeId, mob.id);
      claimed += 1;
    }
    return Object.freeze({ ready: true, reason: null, claimed });
  }

  runtimeIdentityPolicy() {
    return Object.freeze({
      namespace: 'KO1298_NPC',
      owner: 'external shared allocator port',
      claimOrder: 'stable source identity order',
      sourceIdentityPreserved: true,
      respawn: 'reuse existing runtime id',
      reconnect: 'reuse service-owned runtime id',
      processRestart: 'reproducibility delegated to the shared allocator and identical source ordering/reservations',
      range: Object.freeze({ min: NPC_BAND, maxInclusive: Math.min(INVALID_BAND - 1, I16_MAX) }),
      ready: this.runtimeIdentityStatus.ready,
      claimed: this.runtimeIdentityStatus.claimed,
    });
  }

  list() {
    return super.list().map((snapshot) => this._attachRuntimeIdentity(snapshot));
  }

  get(mobId) {
    const snapshot = super.get(mobId);
    return snapshot ? this._attachRuntimeIdentity(snapshot) : null;
  }

  tick(now) {
    super.tick(now);
    return this.list();
  }

  syncPosition(mobId, position, now) {
    return this._attachRuntimeIdentity(super.syncPosition(mobId, position, now));
  }

  reportMovementOutcome(mobId, outcome, now) {
    return this._attachRuntimeIdentity(super.reportMovementOutcome(mobId, outcome, now));
  }

  applyHealth(mobId, hp, now, meta = {}) {
    return this._attachRuntimeIdentity(super.applyHealth(mobId, hp, now, meta));
  }

  clearTarget(mobId, now, reason = 'external-clear') {
    return this._attachRuntimeIdentity(super.clearTarget(mobId, now, reason));
  }

  getNearby({ zoneId, x, z } = {}) {
    this._requireInitialized();
    this._requireRuntimeIdentityReady();
    if (String(zoneId) !== this.definition.zoneId) return Object.freeze([]);
    const centerX = regionOf(x);
    const centerZ = regionOf(z);
    const nearby = [];
    for (const mob of this._orderedMobs()) {
      if (mob.state === MobState.DESPAWNED) continue;
      if (Math.abs(regionOf(mob.position.x) - centerX) > 1) continue;
      if (Math.abs(regionOf(mob.position.z) - centerZ) > 1) continue;
      nearby.push(this.visibilitySnapshot(mob.id));
    }
    nearby.sort((a, b) => a.runtimeId - b.runtimeId);
    return Object.freeze(nearby);
  }

  visibilitySnapshot(identifier) {
    this._requireRuntimeIdentityReady();
    if (identifier && typeof identifier === 'object' && 'zoneId' in identifier && 'x' in identifier && 'z' in identifier) {
      return this.getNearby(identifier);
    }
    if (identifier === undefined) {
      return Object.freeze(this._orderedMobs()
        .filter((mob) => mob.state !== MobState.DESPAWNED)
        .map((mob) => this.visibilitySnapshot(mob.id)));
    }
    const mob = this._resolveMob(identifier);
    const base = this._attachRuntimeIdentity(super.get(mob.id));
    const detail = this.detailSnapshot(mob.id);
    return Object.freeze({
      ...base,
      x: detail.x,
      y: detail.y,
      z: detail.z,
      detail,
      // WS14/WS16 semantic aliases. These are not encoded bytes.
      nid: detail.runtime_id,
      pid: detail.pid,
      npcType: detail.npc_type,
      sellingGroup: detail.selling_group,
      size: detail.scale,
      weapon1: detail.weapon_1,
      weapon2: detail.weapon_2,
      name: detail.name,
      group: detail.group_nation,
      level: detail.level,
      gateOpen: detail.state_gate_open,
      objectType: detail.object_type,
      idk0: detail.idk0,
      idk1: detail.idk1,
      direction: detail.direction,
    });
  }

  detailSnapshot(identifier) {
    this._requireRuntimeIdentityReady();
    const mob = this._resolveMob(identifier);
    if (![mob.position.x, mob.position.y, mob.position.z].every(Number.isFinite)) {
      throw new Error(`ko1298-mobs: ${mob.id} has no authoritative finite XYZ for visibility`);
    }
    const template = this.definition.templates.get(mob.templateId);
    const authority = visibilityAuthorityForTemplate(template);
    const direction = mob.spawnAnchor?.heading;
    if (!Number.isInteger(direction) || direction < 0 || direction > 0xff) {
      throw new RangeError(`ko1298-mobs: ${mob.id} direction is not exact u8 source data`);
    }
    const runtimeId = this.runtimeBySource.get(mob.id);
    return Object.freeze({
      runtime_id: runtimeId,
      template_resource_id: authority.pid,
      pid: authority.pid,
      npc_type: authority.npcType,
      selling_group: authority.sellingGroup,
      scale: authority.scale,
      weapon_1: authority.weapon1,
      weapon_2: authority.weapon2,
      name: authority.name,
      group_nation: authority.groupNation,
      level: authority.level,
      x: mob.position.x,
      y: mob.position.y,
      z: mob.position.z,
      state_gate_open: authority.stateGateOpen,
      object_type: authority.objectType,
      idk0: authority.clientIdk0,
      idk1: authority.clientIdk1,
      direction,
      source_identity: mob.id,
      template_id: mob.templateId,
      group_id: mob.groupId,
      spawn_id: mob.spawnId,
      source_ref: mob.sourceRef,
      template_semantic_source_ref: authority.dataSourceRef,
      sender_semantic_source_ref: authority.senderSourceRef,
    });
  }

  _resolveMob(identifier) {
    let sourceIdentity = null;
    if (Number.isInteger(identifier)) sourceIdentity = this.sourceByRuntime.get(identifier) ?? null;
    else if (typeof identifier === 'string') sourceIdentity = identifier;
    else if (identifier && typeof identifier === 'object') {
      if (Number.isInteger(identifier.runtimeId ?? identifier.instanceId)) {
        sourceIdentity = this.sourceByRuntime.get(identifier.runtimeId ?? identifier.instanceId) ?? null;
      } else if (typeof identifier.id === 'string') sourceIdentity = identifier.id;
    }
    const mob = sourceIdentity ? this.mobs.get(sourceIdentity) : null;
    if (!mob) throw new RangeError(`ko1298-mobs: unknown visibility mob ${String(identifier)}`);
    return mob;
  }

  _attachRuntimeIdentity(snapshot) {
    if (!snapshot || !this.runtimeBySource?.has(snapshot.id)) return snapshot;
    const runtimeId = this.runtimeBySource.get(snapshot.id);
    return Object.freeze({
      ...snapshot,
      sourceIdentity: snapshot.id,
      runtimeId,
      instanceId: runtimeId,
      nid: runtimeId,
    });
  }

  _requireRuntimeIdentityReady() {
    if (!this.runtimeIdentityStatus.ready) {
      throw new Error(`ko1298-mobs: visibility requires shared runtime ID authority (${this.runtimeIdentityStatus.reason})`);
    }
    if (this.runtimeIdentityStatus.claimed !== this.mobs.size) {
      throw new Error('ko1298-mobs: runtime ID authority did not claim every mob slot');
    }
  }

  _emitSemanticVisibility(type, snapshot, event, player) {
    if (typeof this.visibilityPort?.onEvent !== 'function') return;
    if (!snapshot || !Number.isInteger(snapshot.runtimeId)) return;
    const semantic = type === 'IN'
      ? Object.freeze({
          type: 'IN',
          runtimeId: snapshot.runtimeId,
          instanceId: snapshot.runtimeId,
          sourceIdentity: snapshot.sourceIdentity,
          zoneId: snapshot.zoneId,
          detail: this.detailSnapshot(snapshot.sourceIdentity),
          scope: player ? 'player' : 'world',
          playerId: player?.id ?? null,
          reason: event?.reason ?? event?.type ?? null,
          atMs: event?.atMs ?? null,
          spawnEpoch: event?.spawnEpoch ?? snapshot.spawnEpoch,
        })
      : Object.freeze({
          type: 'OUT',
          runtimeId: snapshot.runtimeId,
          instanceId: snapshot.runtimeId,
          sourceIdentity: snapshot.sourceIdentity,
          zoneId: snapshot.zoneId,
          scope: player ? 'player' : 'world',
          playerId: player?.id ?? null,
          reason: event?.reason ?? event?.type ?? null,
          atMs: event?.atMs ?? null,
          spawnEpoch: event?.spawnEpoch ?? snapshot.spawnEpoch,
        });
    this.visibilityPort.onEvent(semantic);
  }
}

module.exports = {
  MobVisibilityService,
  RUNTIME_ID_CONTRACT: Object.freeze({ NPC_BAND, INVALID_BAND, I16_MAX, REGION_SIZE }),
};
