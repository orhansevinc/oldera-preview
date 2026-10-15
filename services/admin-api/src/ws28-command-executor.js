'use strict';

const crypto = require('node:crypto');

const LEGACY_COMMANDS = Object.freeze({
  CUTOFF: { command: 'player.kick', permission: 'gm.player.kick', args: ({ target }) => ({ playerId: target }) },
  SUMMONUSER: { command: 'player.summon', permission: 'gm.player.summon', args: ({ target, arg }) => ({ playerId: target, toPlayerId: arg }) },
  FORBIDUSER: { command: 'account.ban', permission: 'gm.account.ban', args: ({ target, durationSeconds }) => ({ accountId: target, ...(durationSeconds ? { durationSeconds } : {}) }) },
  FORBIDCONNECT: { command: 'account.ban', permission: 'gm.account.ban', args: ({ target, durationSeconds }) => ({ accountId: target, ...(durationSeconds ? { durationSeconds } : {}) }) },
  FORBIDCHAT: { command: 'chat.mute', permission: 'gm.chat.mute', args: ({ target, durationSeconds }) => ({ playerId: target, durationSeconds }) },
  PERMITCHAT: { command: 'chat.unmute', permission: 'gm.chat.unmute', args: ({ target }) => ({ playerId: target }) },
  NOTICE: { command: 'notice.zone', permission: 'gm.notice.zone', args: ({ zoneId, arg }) => ({ zoneId, message: arg }) },
  NOTICEALL: { command: 'notice.global', permission: 'gm.notice.global', args: ({ arg }) => ({ message: arg }) },
  COUNT: { command: 'server.player-count', permission: 'gm.server.read', args: () => ({}) }
});

const UNSUPPORTED = Object.freeze([
  'INVISIBLE', 'CLEAN', 'RAINING', 'SNOWING', 'TIME', 'ARREST', 'VIEW', 'UNVIEW',
  'ATTACKDISABLE', 'ATTACKENABLE', 'PROGRAMLISTCHECK'
]);

function realApplyProven(result) {
  return result?.status === 'ok' && result?.forwarded !== false && (result?.applied === true || result?.data?.applied === true);
}

function statusFromBus(result) {
  if (result?.forwarded === false || result?.status === 'pending' || result?.status === 'queued') return 'PENDING';
  if (realApplyProven(result)) return 'SUCCEEDED';
  return 'FAILED';
}

function httpStatusFromBus(result) {
  const status = statusFromBus(result);
  if (status === 'SUCCEEDED') return 200;
  if (status === 'PENDING') return 202;
  if (['VALIDATION_ERROR', 'DRY_RUN_UNSUPPORTED', 'COMMAND_NOT_ALLOWED'].includes(result?.code)) return 422;
  if (result?.code === 'FORBIDDEN') return 403;
  if (result?.code === 'TIMEOUT') return 504;
  if (['SERVICE_UNAVAILABLE', 'AUTHORIZATION_UNAVAILABLE', 'AUDIT_UNAVAILABLE', 'IDEMPOTENCY_UNAVAILABLE'].includes(result?.code)) return 503;
  return 502;
}

function createWs28CommandExecutor({ repository, commandBus } = {}) {
  if (!repository || typeof repository.enqueueCommand !== 'function' || typeof repository.updateCommand !== 'function') throw new TypeError('durable command repository is required');
  if (!commandBus || typeof commandBus.execute !== 'function') throw new TypeError('WS28 command bus execute() is required');

  async function executeLegacy({ actor, command, target = '', arg = '', reason, idempotencyKey, zoneId, durationSeconds, metadata = {} }) {
    const legacy = String(command || '').toUpperCase();
    const def = LEGACY_COMMANDS[legacy];
    const requestId = `ws08:${idempotencyKey || crypto.randomUUID()}`.slice(0, 128);

    if (!def) {
      const outbox = await repository.enqueueCommand({ requestId, legacyCommand: legacy, canonicalCommand: null, requestedBy: actor.id, reason, status: 'UNSUPPORTED', errorCode: 'UNSUPPORTED_LEGACY_COMMAND' });
      return { httpStatus: 422, command: outbox, result: { status: 'UNSUPPORTED', code: 'UNSUPPORTED_LEGACY_COMMAND', supported: Object.keys(LEGACY_COMMANDS), explicitlyUnsupported: UNSUPPORTED } };
    }

    const args = def.args({ target, arg, zoneId, durationSeconds });
    const outbox = await repository.enqueueCommand({ requestId, legacyCommand: legacy, canonicalCommand: def.command, requestedBy: actor.id, reason, args, status: 'PENDING' });
    let result;
    try {
      result = await commandBus.execute({
        requestId,
        command: def.command,
        reason,
        actor: { id: actor.id, type: 'user', roles: actor.roles, authnMethod: 'admin-session', sessionId: actor.sessionId },
        metadata: { source: 'ws08-admin-v10', outboxId: outbox.id, ...metadata },
        args
      });
    } catch (error) {
      result = { status: 'failed', code: 'COMMAND_BUS_THROW', message: 'Command bus execution failed before a semantic result was returned' };
    }
    const status = statusFromBus(result);
    const updated = await repository.updateCommand(outbox.id, { status, result, completedAt: status === 'PENDING' ? null : new Date().toISOString() });
    return { httpStatus: httpStatusFromBus(result), command: updated, result: { ...result, status } };
  }

  return { executeLegacy, supportedLegacyCommands: Object.keys(LEGACY_COMMANDS), unsupportedLegacyCommands: UNSUPPORTED };
}

module.exports = { LEGACY_COMMANDS, UNSUPPORTED, createWs28CommandExecutor, httpStatusFromBus, statusFromBus, realApplyProven };
