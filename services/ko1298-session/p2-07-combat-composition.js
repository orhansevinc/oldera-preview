'use strict';

const { createPlayableCombatSessionAdapter, createWs25MobCombatPort } = require('./playable-combat-adapter');
const { PlayablePveCombatService } = require('../ko1298-combat');

const P2_07_SOURCE_PINS = Object.freeze({
  WS19: 'cc1490672b676f0bf1675f83c8f4fc146b940df4',
  WS27: 'e984a73c3be8a7407bfc3a34907f3d3376134add',
  WS34: 'ce87542f9c86245d29b1a73d5dd25fdae6028691',
});

function createP207CombatComposition({
  mobService,
  playerCombatPort,
  equipmentPort,
  worldPort,
  eventPort = null,
  rng = Math.random,
  clock = Date.now,
  skillTable = undefined,
  skillCooldownPolicy = null,
} = {}) {
  if (!mobService) throw new TypeError('P2-06/WS25 mobService is required');
  if (!playerCombatPort || typeof playerCombatPort.getCombatSnapshot !== 'function'
      || typeof playerCombatPort.applyHealthResult !== 'function'
      || typeof playerCombatPort.applyResourceResult !== 'function') {
    throw new TypeError('P2-07 authoritative playerCombatPort is required');
  }
  if (!equipmentPort || typeof equipmentPort.getCombatSnapshot !== 'function') {
    throw new TypeError('P2-08/11 equipment combat projection is required');
  }
  if (!worldPort || typeof worldPort.validateAttackRange !== 'function'
      || typeof worldPort.validateMobAttackRange !== 'function') {
    throw new TypeError('P2-04 authoritative combat range port is required');
  }
  const mobCombatPort = createWs25MobCombatPort({ service: mobService });
  const service = new PlayablePveCombatService({
    mobCombatPort,
    playerCombatPort,
    equipmentPort,
    worldPort,
    eventPort,
    rng,
    clock,
    ...(skillTable ? { skillTable } : {}),
    skillCooldownPolicy,
  });
  const combatAdapter = createPlayableCombatSessionAdapter({ service, mobCombatPort, playerCombatPort });
  return Object.freeze({ service, combatAdapter, sourcePins: P2_07_SOURCE_PINS });
}

module.exports = { P2_07_SOURCE_PINS, createP207CombatComposition };
