'use strict';

const { MAGIC_COMMAND } = require('./combat-protocol');

function sameIdentity(left, right) {
  if ((typeof left !== 'string' && typeof left !== 'number') || (typeof right !== 'string' && typeof right !== 'number')) return false;
  return String(left) === String(right);
}

function normalizeSignedI16RuntimeId(value) {
  if (Number.isInteger(value)) {
    if (value < -0x8000 || value > 0x7fff) throw new RangeError('runtime ID must fit signed i16');
    return value;
  }
  if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    const numeric = Number(value);
    if (!Number.isSafeInteger(numeric) || numeric < -0x8000 || numeric > 0x7fff) throw new RangeError('runtime ID must fit signed i16');
    return numeric;
  }
  return value;
}

function projectWs17EquipmentForWs19(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return snapshot;
  const rightHand = snapshot.rightHand;
  if (!rightHand || typeof rightHand !== 'object') return snapshot;
  return Object.freeze({
    ...snapshot,
    weaponRange: snapshot.weaponRange,
    attackDelayMs: snapshot.attackDelayMs,
    damage: rightHand.damage,
    weaponItemId: rightHand.itemId ?? rightHand.templateId,
    weaponType: rightHand.weaponType ?? rightHand.weaponTypeId,
  });
}

function createWs17EquipmentCombatPort({ service, characterId }) {
  if (!service || typeof service.getCombatItemSnapshot !== 'function') {
    throw new TypeError('WS17 ItemDomainService-compatible service is required');
  }
  if (characterId === null || characterId === undefined || String(characterId) === '') {
    throw new TypeError('characterId is required');
  }
  let current = null;
  return Object.freeze({
    async refresh() {
      current = projectWs17EquipmentForWs19(await service.getCombatItemSnapshot(characterId));
      return current;
    },
    getCombatSnapshot() {
      if (!current) throw new Error('WS17 equipment combat snapshot must be refreshed before combat');
      return current;
    },
  });
}

function createWs25MobCombatPort({ service }) {
  if (!service || typeof service.getCombatSnapshot !== 'function' || typeof service.applyCombatResult !== 'function') {
    throw new TypeError('WS25 mob combat service is required');
  }
  return Object.freeze({
    getCombatSnapshot(identifier) {
      return service.getCombatSnapshot(normalizeSignedI16RuntimeId(identifier));
    },
    applyCombatResult(identifier, result, now, meta) {
      return service.applyCombatResult(normalizeSignedI16RuntimeId(identifier), result, now, meta);
    },
  });
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

module.exports = {
  createPlayableCombatSessionAdapter,
  createWs17EquipmentCombatPort,
  createWs25MobCombatPort,
  projectWs17EquipmentForWs19,
  normalizeSignedI16RuntimeId,
};
