'use strict';

const { MAGIC_COMMAND } = require('./combat-protocol');

function sameIdentity(left, right) {
  if ((typeof left !== 'string' && typeof left !== 'number') || (typeof right !== 'string' && typeof right !== 'number')) return false;
  return String(left) === String(right);
}

function createPlayableCombatSessionAdapter({ service, mobCombatPort, playerCombatPort }) {
  if (!service || typeof service.normalAttack !== 'function' || typeof service.skill !== 'function' || typeof service.resolveMobAttackIntent !== 'function') {
    throw new TypeError('WS19 PlayablePveCombatService-compatible service is required');
  }
  if (!mobCombatPort || typeof mobCombatPort.getCombatSnapshot !== 'function') throw new TypeError('WS25 mobCombatPort is required');
  if (!playerCombatPort || typeof playerCombatPort.getCombatSnapshot !== 'function') throw new TypeError('authoritative playerCombatPort is required');

  return Object.freeze({
    async execute({ actor, operation }) {
      if (!sameIdentity(operation.sourceEntityId, actor.entityId)) throw new Error('session actor identity mismatch');
      if (operation.kind === 'NORMAL_ATTACK') {
        return service.normalAttack({
          sourceId: actor.entityId,
          targetId: operation.targetRuntimeId,
          requestKey: operation.requestKey,
        });
      }
      if (operation.kind === 'MAGIC_PROCESS') {
        return service.skill({
          skillId: operation.skillId,
          sourceId: actor.entityId,
          targetId: operation.targetRuntimeId,
          requestKey: operation.requestKey,
          phase: operation.commandName || (operation.command === MAGIC_COMMAND.EFFECTING ? 'EFFECTING' : null),
        });
      }
      throw new Error(`unsupported WS03 combat operation ${operation.kind}`);
    },

    getTargetCombatSnapshot(targetId) {
      return mobCombatPort.getCombatSnapshot(targetId);
    },

    getPlayerCombatSnapshot(playerId) {
      return playerCombatPort.getCombatSnapshot(playerId);
    },

    async resolveMobAttackIntent({ actor, event }) {
      if (!sameIdentity(event.targetId, actor.entityId)) {
        return Object.freeze({ ok: false, reason: 'ATTACK_INTENT_TARGET_MISMATCH', sourceId: event.runtimeId, targetId: actor.entityId });
      }
      return service.resolveMobAttackIntent(event);
    },
  });
}

module.exports = { createPlayableCombatSessionAdapter };
