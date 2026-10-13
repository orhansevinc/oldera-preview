'use strict';

const { ValidationError, ServiceUnavailableError } = require('./errors');

const RISK = Object.freeze({ LOW: 'low', MEDIUM: 'medium', HIGH: 'high', CRITICAL: 'critical' });

function expectObject(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    throw new ValidationError('args must be an object');
  }
  return args;
}

function requiredString(obj, key, { max = 128 } = {}) {
  const value = obj[key];
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > max) {
    throw new ValidationError(`${key} must be a non-empty string up to ${max} characters`);
  }
  return value.trim();
}

function requiredFiniteNumber(obj, key, { min = -1_000_000, max = 1_000_000 } = {}) {
  const value = obj[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new ValidationError(`${key} must be a finite number between ${min} and ${max}`);
  }
  return value;
}

function requiredInteger(obj, key, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const value = obj[key];
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new ValidationError(`${key} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function noExtraKeys(obj, allowed) {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) throw new ValidationError(`Unexpected argument: ${key}`);
  }
}

function requireMethod(adapter, method, serviceName) {
  if (!adapter || typeof adapter[method] !== 'function') {
    throw new ServiceUnavailableError(serviceName, `${serviceName}.${method} is unavailable`);
  }
  return adapter[method].bind(adapter);
}

function playerTarget(args) {
  const obj = expectObject(args);
  noExtraKeys(obj, ['playerId']);
  return { playerId: requiredString(obj, 'playerId') };
}

function teleportArgs(args) {
  const obj = expectObject(args);
  noExtraKeys(obj, ['playerId', 'zoneId', 'x', 'z', 'y']);
  return {
    playerId: requiredString(obj, 'playerId'),
    zoneId: requiredInteger(obj, 'zoneId', { min: 1, max: 65535 }),
    x: requiredFiniteNumber(obj, 'x'),
    z: requiredFiniteNumber(obj, 'z'),
    y: obj.y === undefined ? undefined : requiredFiniteNumber(obj, 'y'),
  };
}

function summonArgs(args) {
  const obj = expectObject(args);
  noExtraKeys(obj, ['playerId', 'toPlayerId']);
  return {
    playerId: requiredString(obj, 'playerId'),
    toPlayerId: requiredString(obj, 'toPlayerId'),
  };
}

function banArgs(args) {
  const obj = expectObject(args);
  noExtraKeys(obj, ['accountId', 'durationSeconds']);
  return {
    accountId: requiredString(obj, 'accountId'),
    durationSeconds: obj.durationSeconds === undefined
      ? undefined
      : requiredInteger(obj, 'durationSeconds', { min: 60, max: 31_536_000 }),
  };
}

function accountArgs(args) {
  const obj = expectObject(args);
  noExtraKeys(obj, ['accountId']);
  return { accountId: requiredString(obj, 'accountId') };
}

function muteArgs(args) {
  const obj = expectObject(args);
  noExtraKeys(obj, ['playerId', 'durationSeconds']);
  return {
    playerId: requiredString(obj, 'playerId'),
    durationSeconds: requiredInteger(obj, 'durationSeconds', { min: 60, max: 604800 }),
  };
}

function noticeArgs(args, requireZone) {
  const obj = expectObject(args);
  const allowed = requireZone ? ['zoneId', 'message'] : ['message'];
  noExtraKeys(obj, allowed);
  const out = { message: requiredString(obj, 'message', { max: 512 }) };
  if (requireZone) out.zoneId = requiredInteger(obj, 'zoneId', { min: 1, max: 65535 });
  return out;
}

function makeDefinition({ id, risk, permission, validateArgs, execute, dryRun, target }) {
  return Object.freeze({
    id,
    risk,
    permission,
    validateArgs,
    execute,
    dryRun,
    supportsDryRun: typeof dryRun === 'function',
    target,
  });
}

function createCommandRegistry(adapters = {}) {
  const game = adapters.gameOperations;
  const moderation = adapters.moderation;
  const notices = adapters.notices;
  const observability = adapters.observability;

  const defs = [
    makeDefinition({
      id: 'player.kick', risk: RISK.MEDIUM, permission: 'gm.player.kick', validateArgs: playerTarget,
      target: (a) => ({ type: 'player', id: a.playerId }),
      execute: (ctx) => requireMethod(game, 'kickPlayer', 'gameOperations')(ctx),
      dryRun: (ctx) => requireMethod(game, 'previewKickPlayer', 'gameOperations')(ctx),
    }),
    makeDefinition({
      id: 'player.teleport', risk: RISK.MEDIUM, permission: 'gm.player.teleport', validateArgs: teleportArgs,
      target: (a) => ({ type: 'player', id: a.playerId }),
      execute: (ctx) => requireMethod(game, 'teleportPlayer', 'gameOperations')(ctx),
      dryRun: (ctx) => requireMethod(game, 'previewTeleportPlayer', 'gameOperations')(ctx),
    }),
    makeDefinition({
      id: 'player.summon', risk: RISK.MEDIUM, permission: 'gm.player.summon', validateArgs: summonArgs,
      target: (a) => ({ type: 'player', id: a.playerId }),
      execute: (ctx) => requireMethod(game, 'summonPlayer', 'gameOperations')(ctx),
      dryRun: (ctx) => requireMethod(game, 'previewSummonPlayer', 'gameOperations')(ctx),
    }),
    makeDefinition({
      id: 'account.ban', risk: RISK.HIGH, permission: 'gm.account.ban', validateArgs: banArgs,
      target: (a) => ({ type: 'account', id: a.accountId }),
      execute: (ctx) => requireMethod(moderation, 'banAccount', 'moderation')(ctx),
      dryRun: (ctx) => requireMethod(moderation, 'previewBanAccount', 'moderation')(ctx),
    }),
    makeDefinition({
      id: 'account.unban', risk: RISK.HIGH, permission: 'gm.account.unban', validateArgs: accountArgs,
      target: (a) => ({ type: 'account', id: a.accountId }),
      execute: (ctx) => requireMethod(moderation, 'unbanAccount', 'moderation')(ctx),
      dryRun: (ctx) => requireMethod(moderation, 'previewUnbanAccount', 'moderation')(ctx),
    }),
    makeDefinition({
      id: 'chat.mute', risk: RISK.MEDIUM, permission: 'gm.chat.mute', validateArgs: muteArgs,
      target: (a) => ({ type: 'player', id: a.playerId }),
      execute: (ctx) => requireMethod(moderation, 'mutePlayer', 'moderation')(ctx),
      dryRun: (ctx) => requireMethod(moderation, 'previewMutePlayer', 'moderation')(ctx),
    }),
    makeDefinition({
      id: 'chat.unmute', risk: RISK.MEDIUM, permission: 'gm.chat.unmute', validateArgs: playerTarget,
      target: (a) => ({ type: 'player', id: a.playerId }),
      execute: (ctx) => requireMethod(moderation, 'unmutePlayer', 'moderation')(ctx),
      dryRun: (ctx) => requireMethod(moderation, 'previewUnmutePlayer', 'moderation')(ctx),
    }),
    makeDefinition({
      id: 'notice.zone', risk: RISK.LOW, permission: 'gm.notice.zone', validateArgs: (a) => noticeArgs(a, true),
      target: (a) => ({ type: 'zone', id: String(a.zoneId) }),
      execute: (ctx) => requireMethod(notices, 'sendZoneNotice', 'notices')(ctx),
    }),
    makeDefinition({
      id: 'notice.global', risk: RISK.LOW, permission: 'gm.notice.global', validateArgs: (a) => noticeArgs(a, false),
      target: () => ({ type: 'global', id: 'all' }),
      execute: (ctx) => requireMethod(notices, 'sendGlobalNotice', 'notices')(ctx),
    }),
    makeDefinition({
      id: 'server.player-count', risk: RISK.LOW, permission: 'gm.server.read', validateArgs: (a) => {
        const obj = expectObject(a); noExtraKeys(obj, []); return {};
      },
      target: () => ({ type: 'server', id: 'primary' }),
      execute: (ctx) => requireMethod(observability, 'getPlayerCount', 'observability')(ctx),
    }),
  ];

  return Object.freeze(new Map(defs.map((def) => [def.id, def])));
}

module.exports = { createCommandRegistry, RISK };
