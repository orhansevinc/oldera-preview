'use strict';

const { GAME } = require('./protocol');

const SESSION_STATES = Object.freeze({
  CONNECTED: 'CONNECTED',
  AUTHENTICATED: 'AUTHENTICATED',
  CHARACTER_SELECTED: 'CHARACTER_SELECTED',
  WORLD_LOADING: 'WORLD_LOADING',
  WORLD_READY: 'WORLD_READY',
  DISCONNECTING: 'DISCONNECTING',
  CLOSED: 'CLOSED',
});

const SESSION_TRANSITIONS = Object.freeze({
  [SESSION_STATES.CONNECTED]: new Set([SESSION_STATES.AUTHENTICATED, SESSION_STATES.DISCONNECTING]),
  [SESSION_STATES.AUTHENTICATED]: new Set([SESSION_STATES.CHARACTER_SELECTED, SESSION_STATES.DISCONNECTING]),
  [SESSION_STATES.CHARACTER_SELECTED]: new Set([SESSION_STATES.AUTHENTICATED, SESSION_STATES.WORLD_LOADING, SESSION_STATES.DISCONNECTING]),
  [SESSION_STATES.WORLD_LOADING]: new Set([SESSION_STATES.AUTHENTICATED, SESSION_STATES.WORLD_READY, SESSION_STATES.DISCONNECTING]),
  [SESSION_STATES.WORLD_READY]: new Set([SESSION_STATES.WORLD_LOADING, SESSION_STATES.DISCONNECTING]),
  [SESSION_STATES.DISCONNECTING]: new Set([SESSION_STATES.CLOSED]),
  [SESSION_STATES.CLOSED]: new Set(),
});

const OWNER = Object.freeze({
  WS03: 'WS03',
  WS14: 'WS14',
  WS15: 'WS15',
  WS16: 'WS16',
  WS17: 'WS17',
  WS19: 'WS19',
  WS22: 'WS22',
  CONFLICT_WS14_WS16: 'WS14/WS16-CONFLICT',
});

function contract(opcode, name, owner, allowedStates, notes = '') {
  return Object.freeze({ opcode, name, owner, allowedStates: new Set(allowedStates), notes });
}

const OPCODE_CONTRACTS = new Map([
  [GAME.LOGIN, contract(GAME.LOGIN, 'WIZ_LOGIN', OWNER.WS03, [SESSION_STATES.CONNECTED])],
  [GAME.NEW_CHAR, contract(GAME.NEW_CHAR, 'WIZ_NEW_CHAR', OWNER.WS03, [SESSION_STATES.AUTHENTICATED])],
  [GAME.SEL_CHAR, contract(GAME.SEL_CHAR, 'WIZ_SEL_CHAR', OWNER.WS03, [SESSION_STATES.AUTHENTICATED])],
  [GAME.SEL_NATION, contract(GAME.SEL_NATION, 'WIZ_SEL_NATION', OWNER.WS03, [SESSION_STATES.AUTHENTICATED])],
  [GAME.MOVE, contract(GAME.MOVE, 'WIZ_MOVE', OWNER.WS15, [SESSION_STATES.WORLD_READY], '9-byte payload after opcode')],
  [GAME.ATTACK, contract(GAME.ATTACK, 'WIZ_ATTACK', OWNER.WS19, [SESSION_STATES.WORLD_READY], 'WS11 VERIFIED C2S normal attack; client interval/distance are observation-only')],
  [GAME.ROTATE, contract(GAME.ROTATE, 'WIZ_ROTATE', OWNER.WS15, [SESSION_STATES.WORLD_READY], '2-byte payload after opcode')],
  [GAME.ALLCHAR_INFO_REQ, contract(GAME.ALLCHAR_INFO_REQ, 'WIZ_ALLCHAR_INFO_REQ', OWNER.WS03, [SESSION_STATES.AUTHENTICATED])],
  [GAME.GAMESTART, contract(GAME.GAMESTART, 'WIZ_GAMESTART', OWNER.WS14, [SESSION_STATES.WORLD_LOADING, SESSION_STATES.WORLD_READY])],
  [GAME.REQUEST_USER_IN, contract(GAME.REQUEST_USER_IN, 'WIZ_REQ_USERIN', OWNER.WS14, [SESSION_STATES.WORLD_LOADING, SESSION_STATES.WORLD_READY])],
  [GAME.REQUEST_NPC_IN, contract(GAME.REQUEST_NPC_IN, 'WIZ_REQ_NPCIN', OWNER.CONFLICT_WS14_WS16, [SESSION_STATES.WORLD_LOADING, SESSION_STATES.WORLD_READY], 'Default route remains WS14 to preserve canonical Moradon PASS; WS16 takeover requires explicit composition capability')],
  [GAME.NPC_EVENT, contract(GAME.NPC_EVENT, 'WIZ_NPC_EVENT', OWNER.WS16, [SESSION_STATES.WORLD_READY])],
  [GAME.TARGET_HP, contract(GAME.TARGET_HP, 'WIZ_TARGET_HP', OWNER.WS16, [SESSION_STATES.WORLD_READY])],
  [GAME.ZONE_CHANGE, contract(GAME.ZONE_CHANGE, 'WIZ_ZONE_CHANGE', OWNER.WS14, [SESSION_STATES.WORLD_LOADING, SESSION_STATES.WORLD_READY])],
  [GAME.VERSION_CHECK, contract(GAME.VERSION_CHECK, 'WIZ_VERSION_CHECK', OWNER.WS03, [SESSION_STATES.CONNECTED])],
  [GAME.MAGIC_PROCESS, contract(GAME.MAGIC_PROCESS, 'WIZ_MAGIC_PROCESS', OWNER.WS19, [SESSION_STATES.WORLD_READY], 'WS11 VERIFIED C2S generic_full commands 1..6; source identity is session-authoritative')],
]);

const UNBOUND_DOMAIN_CONTRACTS = Object.freeze({
  WS17: 'Inventory/item adapter boundary is ready, but no additional client opcode is bound until a verified 1298 packet contract is supplied.',
  WS22: 'Economy/trade actor-context boundary is ready, but no client opcode is bound until a verified 1298 packet contract is supplied.',
  WS25: 'Mob results are outbound domain events; WS03 does not invent mob client opcodes.',
  WS26: 'Loot results are outbound domain events; WS03 does not invent loot client opcodes.',
  WS27: 'Progression results are outbound domain events; WS03 does not invent progression client opcodes.',
});

function getOpcodeContract(opcode) {
  return OPCODE_CONTRACTS.get(opcode) || null;
}

function canTransition(from, to) {
  return SESSION_TRANSITIONS[from]?.has(to) || false;
}

module.exports = {
  SESSION_STATES,
  SESSION_TRANSITIONS,
  OWNER,
  OPCODE_CONTRACTS,
  UNBOUND_DOMAIN_CONTRACTS,
  getOpcodeContract,
  canTransition,
};
