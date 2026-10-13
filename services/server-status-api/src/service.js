import { AppError } from './errors.js';

const AVAILABILITY = new Set(['online', 'offline', 'maintenance']);
const POPULATION = new Set(['unknown', 'empty', 'low', 'medium', 'high', 'full']);
const REALM_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_STATUS_MESSAGE = 240;

function isoTimestamp(value, fieldName) {
  if (value == null) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${fieldName} must be a valid timestamp`);
  return parsed.toISOString();
}

function nonNegativeInteger(value, fieldName) {
  if (value == null) return null;
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${fieldName} must be a non-negative safe integer`);
  return value;
}

function requiredString(value, fieldName, maxLength = 128) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    throw new Error(`${fieldName} must be a non-empty string up to ${maxLength} characters`);
  }
  return value;
}

function optionalString(value, fieldName, maxLength) {
  if (value == null) return null;
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    throw new Error(`${fieldName} must be a non-empty string up to ${maxLength} characters`);
  }
  return value;
}

function normalizeSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new Error('Health source returned an invalid realm snapshot');
  }

  const realmId = requiredString(snapshot.realmId, 'realmId', 64);
  if (!REALM_ID.test(realmId)) throw new Error('realmId must match /^[a-z0-9][a-z0-9-]{0,63}$/');

  const availability = snapshot.availability;
  if (!AVAILABILITY.has(availability)) throw new Error('availability must be online, offline, or maintenance');

  const population = snapshot.population ?? 'unknown';
  if (!POPULATION.has(population)) throw new Error('population must be a supported category');

  const onlinePlayerCount = nonNegativeInteger(snapshot.onlinePlayerCount, 'onlinePlayerCount');
  const uptimeSeconds = nonNegativeInteger(snapshot.uptimeSeconds, 'uptimeSeconds');
  const capacity = snapshot.capacity ?? null;
  if (capacity != null && (typeof capacity !== 'object' || Array.isArray(capacity))) {
    throw new Error('capacity must be an object when provided');
  }

  const maxPlayers = capacity ? nonNegativeInteger(capacity.maxPlayers, 'capacity.maxPlayers') : null;
  const queueDepth = capacity ? nonNegativeInteger(capacity.queueDepth, 'capacity.queueDepth') : null;
  const queueSupported = capacity?.queueSupported === true;

  return {
    realmId,
    displayName: requiredString(snapshot.displayName, 'displayName', 96),
    availability,
    online: availability === 'online',
    maintenance: availability === 'maintenance',
    population,
    onlinePlayerCount,
    serverVersion: requiredString(snapshot.serverVersion, 'serverVersion', 64),
    targetPatch: '1298',
    lastHeartbeat: isoTimestamp(snapshot.lastHeartbeat, 'lastHeartbeat'),
    uptimeSeconds,
    statusMessage: optionalString(snapshot.statusMessage, 'statusMessage', MAX_STATUS_MESSAGE),
    minimumContentVersion: requiredString(snapshot.minimumContentVersion, 'minimumContentVersion', 64),
    capacity: {
      queueSupported,
      maxPlayers,
      queueDepth
    }
  };
}

function publicRealm(snapshot, { exposeOnlinePlayerCount }) {
  const normalized = normalizeSnapshot(snapshot);
  const result = {
    realmId: normalized.realmId,
    displayName: normalized.displayName,
    availability: normalized.availability,
    online: normalized.online,
    maintenance: normalized.maintenance,
    population: normalized.population,
    serverVersion: normalized.serverVersion,
    targetPatch: normalized.targetPatch,
    lastHeartbeat: normalized.lastHeartbeat,
    client: {
      minimumContentVersion: normalized.minimumContentVersion
    },
    capacity: {
      queueSupported: normalized.capacity.queueSupported
    }
  };

  if (normalized.uptimeSeconds != null) result.uptimeSeconds = normalized.uptimeSeconds;
  if (normalized.statusMessage != null) result.statusMessage = normalized.statusMessage;
  if (exposeOnlinePlayerCount && normalized.onlinePlayerCount != null) {
    result.onlinePlayerCount = normalized.onlinePlayerCount;
  }
  if (normalized.capacity.maxPlayers != null) result.capacity.maxPlayers = normalized.capacity.maxPlayers;
  if (normalized.capacity.queueSupported && normalized.capacity.queueDepth != null) {
    result.capacity.queueDepth = normalized.capacity.queueDepth;
  }

  return result;
}

function compareRealms(a, b) {
  return a.displayName.localeCompare(b.displayName, 'en', { sensitivity: 'base' }) || a.realmId.localeCompare(b.realmId);
}

export class ServerStatusService {
  constructor({ healthSource, exposeOnlinePlayerCount = false } = {}) {
    if (!healthSource || typeof healthSource.listRealms !== 'function' || typeof healthSource.getRealm !== 'function') {
      throw new TypeError('healthSource with listRealms() and getRealm() is required');
    }
    this.healthSource = healthSource;
    this.exposeOnlinePlayerCount = exposeOnlinePlayerCount === true;
  }

  async listRealms() {
    const snapshots = await this.healthSource.listRealms();
    if (!Array.isArray(snapshots)) throw new Error('Health source listRealms() must return an array');
    const realms = snapshots.map((snapshot) => publicRealm(snapshot, this)).sort(compareRealms);
    return {
      targetPatch: '1298',
      count: realms.length,
      realms
    };
  }

  async getRealm(realmId) {
    if (typeof realmId !== 'string' || !REALM_ID.test(realmId)) {
      throw new AppError(400, 'INVALID_REALM_ID', 'Realm ID is invalid');
    }
    const snapshot = await this.healthSource.getRealm(realmId);
    if (!snapshot) throw new AppError(404, 'REALM_NOT_FOUND', 'Realm not found');
    return publicRealm(snapshot, this);
  }

  async health() {
    return { ok: true, service: 'oldko-server-status-api', readOnly: true, targetPatch: '1298' };
  }
}

export function notFound() {
  throw new AppError(404, 'NOT_FOUND', 'Endpoint not found');
}
