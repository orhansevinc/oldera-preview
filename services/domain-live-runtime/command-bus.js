'use strict';

const { createGmCommandBus, ServiceUnavailableError } = require('../gm-command-bus/src');

const COMMAND_ROLES = new Set(['GM', 'OWNER']);

function createAuthorizer() {
  return {
    async authorize({ actor }) {
      const roles = new Set((actor?.roles || []).map((role) => String(role).toUpperCase()));
      return { allowed: [...roles].some((role) => COMMAND_ROLES.has(role)), reason: 'WS08_ROLE_POLICY' };
    }
  };
}

function createAuditSink(repository) {
  return {
    async append(event) {
      await repository.appendAudit({
        actorId: event.actor?.id || null,
        actor: event.actor?.id || 'system',
        action: event.event || 'ws28.command',
        targetType: event.target?.type || 'command',
        targetId: event.target?.id || event.command || null,
        target: event.target?.id || event.command || null,
        reason: event.reason || 'WS28 command execution',
        requestId: event.requestId || null,
        traceId: event.requestId || null,
        source: 'WS28_REAL_DOWNSTREAM',
        result: event.result?.code || event.result?.status || 'ACCEPTED'
      });
    }
  };
}

class RepositoryIdempotencyStore {
  constructor(repository) { this.repository = repository; }
  async run(key, _ttlMs, work) {
    const actorId = String(key).split(':', 1)[0];
    return this.repository.runIdempotent({ key, actorId, kind: 'WS28_COMMAND', fingerprint: key }, work);
  }
}

function createGameOperations(sessionAuthority) {
  const find = (playerId) => sessionAuthority.findOnlinePlayer({ characterId: String(playerId) }) || sessionAuthority.findOnlinePlayer({ accountId: String(playerId) });
  return {
    async previewKickPlayer({ args }) {
      const player = find(args.playerId);
      return { applied: false, available: Boolean(player), player: player ? { characterId: player.characterId, accountId: player.accountId, socketId: player.socketId } : null };
    },
    async kickPlayer({ args, reason }) {
      const player = find(args.playerId);
      if (!player) throw new ServiceUnavailableError('gameOperations', `player is not online: ${args.playerId}`);
      const result = await sessionAuthority.disconnectPlayer({ socketId: player.socketId }, { reason: reason || 'ADMIN_CUTOFF' });
      if (!result?.ok) throw new ServiceUnavailableError('gameOperations', result?.code || 'disconnect failed');
      return { applied: true, code: result.code, player: { characterId: player.characterId, accountId: player.accountId, socketId: player.socketId } };
    }
  };
}

function createObservability(sessionAuthority) {
  return {
    async getPlayerCount() {
      const players = sessionAuthority.listOnlinePlayers();
      return { applied: true, count: players.length, authority: 'WS03_SESSION_AUTHORITY' };
    }
  };
}

function createAdminCommandBus({ sessionAuthority, repository }) {
  if (!sessionAuthority || !repository) throw new TypeError('sessionAuthority and repository are required');
  return createGmCommandBus({
    adapters: {
      gameOperations: createGameOperations(sessionAuthority),
      observability: createObservability(sessionAuthority)
    },
    authorizer: createAuthorizer(),
    auditSink: createAuditSink(repository),
    idempotencyStore: new RepositoryIdempotencyStore(repository)
  });
}

module.exports = { createAdminCommandBus, RepositoryIdempotencyStore };
