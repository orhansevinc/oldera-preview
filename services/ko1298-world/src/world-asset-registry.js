'use strict';

const path = require('node:path');
const scope = require('../data/world-scope.1298.json');
const { SmdHeightResolver, HEIGHT_STATUS } = require('./smd-height-resolver');

class WorldAssetRegistry {
  constructor({ manifest = scope, assetPaths = {}, resolverClass = SmdHeightResolver, zoneRegistry } = {}) {
    if (!manifest || !Array.isArray(manifest.zones)) throw new TypeError('world scope manifest with zones is required');
    this.manifest = manifest;
    this.resolverClass = resolverClass;
    this.zoneRegistry = zoneRegistry;
    this.byZoneId = new Map();
    this.byClientZoneId = new Map();
    this.assetPaths = new Map();

    for (const raw of manifest.zones) {
      assertZone(raw);
      if (this.byZoneId.has(raw.serverZoneId)) throw new Error(`duplicate server zone ${raw.serverZoneId}`);
      if (this.byClientZoneId.has(raw.clientZoneTableId)) throw new Error(`duplicate client zone ${raw.clientZoneTableId}`);
      const zone = deepFreeze(clone(raw));
      this.byZoneId.set(zone.serverZoneId, zone);
      this.byClientZoneId.set(zone.clientZoneTableId, zone);
    }

    for (const [rawZoneId, value] of Object.entries(assetPaths)) {
      const zoneId = Number(rawZoneId);
      if (!Number.isInteger(zoneId) || !this.byZoneId.has(zoneId)) throw new Error(`asset path targets unknown zone ${rawZoneId}`);
      const resolved = typeof value === 'string' ? value : value?.path;
      if (!resolved || typeof resolved !== 'string') throw new TypeError(`zone ${zoneId} SMD path is required`);
      this.assetPaths.set(zoneId, resolved);
    }
  }

  getByServerZoneId(zoneId) { return this.byZoneId.get(zoneId) || null; }
  getByClientZoneId(clientZoneId) { return this.byClientZoneId.get(clientZoneId) || null; }

  requirePair(serverZoneId, clientZoneId) {
    const server = this.getByServerZoneId(serverZoneId);
    if (!server) throw new Error(`unknown server zone ${serverZoneId}`);
    if (server.clientZoneTableId !== clientZoneId) {
      throw new Error(`zone namespace mismatch server=${serverZoneId} client=${clientZoneId}; expected client=${server.clientZoneTableId}`);
    }
    return server;
  }

  list() { return [...this.byZoneId.values()]; }

  assetRequest(zoneId) {
    const zone = this.getByServerZoneId(zoneId);
    if (!zone) throw new Error(`unknown server zone ${zoneId}`);
    return Object.freeze({
      zoneId,
      serverSmd: zone.serverSmd.file,
      expectedGitBlobSha1: zone.serverSmd.gitBlobSha1,
      expectedByteLength: zone.serverSmd.byteLength,
      clientAssetRefs: Object.freeze([...zone.clientAssetRefs]),
      configuredPath: this.assetPaths.get(zoneId) || null,
    });
  }

  createHeightResolver({ readFile } = {}) {
    const zoneAssets = {};
    for (const [zoneId, smdPath] of this.assetPaths) {
      const zone = this.byZoneId.get(zoneId);
      zoneAssets[zoneId] = {
        path: smdPath,
        expectedByteLength: zone.serverSmd.byteLength,
        expectedGitBlobSha1: zone.serverSmd.gitBlobSha1,
        source: `Open-KO/KnightOnline@${this.manifest.sources.openkoServer}:assets/Server/MAP/${zone.serverSmd.file}`,
      };
    }
    return new this.resolverClass({
      ...(this.zoneRegistry ? { zoneRegistry: this.zoneRegistry } : {}),
      zoneAssets,
      ...(readFile ? { readFile } : {}),
    });
  }

  static fromAssetRoot(assetRoot, options = {}) {
    if (!assetRoot || typeof assetRoot !== 'string') throw new TypeError('assetRoot is required');
    const manifest = options.manifest || scope;
    const assetPaths = {};
    for (const zone of manifest.zones) assetPaths[zone.serverZoneId] = path.join(assetRoot, zone.serverSmd.file);
    return new WorldAssetRegistry({ ...options, manifest, assetPaths });
  }
}

function resolveSourceSpawn({ assetRegistry, heightResolver, zoneId }) {
  if (!assetRegistry || typeof assetRegistry.getByServerZoneId !== 'function') throw new TypeError('assetRegistry is required');
  if (!heightResolver || typeof heightResolver.resolveHeight !== 'function') throw new TypeError('heightResolver is required');
  const zone = assetRegistry.getByServerZoneId(zoneId);
  if (!zone) return fail('UNKNOWN_ZONE', zoneId);
  const source = zone.sourceSpawn;
  if (!source || source.status !== 'SOURCE_CANDIDATE_REQUIRES_COLLISION_VALIDATION') {
    return fail('NO_SAFE_SOURCE_CANDIDATE', zoneId, source?.reason || null);
  }

  const result = heightResolver.resolveHeight(zoneId, source.x, source.z, { yHint: source.y });
  if (result.status !== HEIGHT_STATUS.AUTHORITATIVE && result.status !== 'authoritative') {
    return Object.freeze({ ok: false, zoneId, reason: 'HEIGHT_OR_COLLISION_UNRESOLVED', source: Object.freeze({ ...source }), resolver: result });
  }
  return Object.freeze({
    ok: true,
    zoneId,
    position: Object.freeze({ x: source.x, z: source.z, y: result.height }),
    surface: result.surface,
    source: Object.freeze({ ...source }),
  });
}

function assertZone(raw) {
  if (!Number.isInteger(raw?.serverZoneId) || raw.serverZoneId < 0 || raw.serverZoneId > 0xff) throw new Error('serverZoneId must fit uint8');
  if (!Number.isInteger(raw?.clientZoneTableId) || raw.clientZoneTableId < 0) throw new Error(`clientZoneTableId missing for zone ${raw?.serverZoneId}`);
  if (!raw.serverSmd?.file || !/^[A-Za-z0-9_.-]+\.smd$/i.test(raw.serverSmd.file)) throw new Error(`server SMD missing for zone ${raw.serverZoneId}`);
  if (!/^[0-9a-f]{40}$/.test(raw.serverSmd.gitBlobSha1 || '')) throw new Error(`server SMD git blob SHA1 invalid for zone ${raw.serverZoneId}`);
  if (!Number.isInteger(raw.serverSmd.byteLength) || raw.serverSmd.byteLength <= 0) throw new Error(`server SMD byte length invalid for zone ${raw.serverZoneId}`);
  if (!Array.isArray(raw.clientAssetRefs) || raw.clientAssetRefs.length === 0) throw new Error(`client assets missing for zone ${raw.serverZoneId}`);
}

function fail(reason, zoneId, detail = null) { return Object.freeze({ ok: false, zoneId, reason, detail }); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const item of Object.values(value)) deepFreeze(item);
  return value;
}

module.exports = { WorldAssetRegistry, resolveSourceSpawn };
