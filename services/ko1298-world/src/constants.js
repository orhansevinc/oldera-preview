'use strict';

// Open-KO/KnightOnline CURRENT_VERSION=1298 protocol constants.
const OPCODE = Object.freeze({
  CHARACTER_SELECT: 0x04,
  USER_INOUT: 0x07,
  NPC_INOUT: 0x0a,
  GAMESTART: 0x0d,
  MYINFO: 0x0e,
  REGION_USER_IDS: 0x15,
  REQUEST_USER_IN: 0x16,
  REGION_NPC_IDS: 0x1c,
  REQUEST_NPC_IN: 0x1d,
  ZONE_CHANGE: 0x27,
  ZONE_ABILITY: 0x5e,
});

const USER_INOUT = Object.freeze({
  IN: 0x01,
  OUT: 0x02,
  REGENE: 0x03,
  WARP: 0x04,
});

const GAMESTART_PHASE = Object.freeze({
  LOADING: 0x01,
  LOADED: 0x02,
});

const ZONE_CHANGE_PHASE = Object.freeze({
  LOADING: 0x01,
  LOADED: 0x02,
  TELEPORT: 0x03,
});

const ZONE_ABILITY = Object.freeze({
  UPDATE: 0x01,
  NEUTRAL: 0x00,
  PVP: 0x01,
});

// IDs are source-backed by WS31/Open-KO 1298. Presence here does not imply
// that spawn/rules/zone-ability data is complete enough to enable entry.
const ZONE = Object.freeze({
  KARUS: 1,
  EL_MORAD: 2,
  KARUS_ESLANT: 11,
  EL_MORAD_ESLANT: 12,
  MORADON: 21,
  DELOS: 30,
  BIFROST: 31,
  DESPERATION_ABYSS: 32,
  HELL_ABYSS: 33,
  ARENA: 48,
  CAITHAROS_ARENA: 55,
  BATTLE_ZONE_1: 101,
  BATTLE_ZONE_2: 102,
  BATTLE_ZONE_3: 103,
  SNOW_BATTLE: 111,
  FRONTIER: 201,
});

// OpenKO-db ZONE_INFO zone 21: InitX=31200, InitZ=40200, InitY=0.
// Persisted coordinates are hundredths; protocol coordinates are tenths.
const MORADON_SPAWN = Object.freeze({ x: 312.0, z: 402.0, y: 0.0 });

const SLOT_MAX = 14;
const HAVE_MAX = 28;
const MYINFO_ITEM_RECORDS = SLOT_MAX + HAVE_MAX;
const VISIBLE_EQUIPMENT_RECORDS = 8;
const SKILL_BYTES = 9;

const WORLD_STATE = Object.freeze({
  WAIT_GAMESTART_LOADING: 'WAIT_GAMESTART_LOADING',
  WAIT_GAMESTART_LOADED: 'WAIT_GAMESTART_LOADED',
  REQUESTED: 'REQUESTED',
  AUTHORIZED: 'AUTHORIZED',
  LEAVING_SOURCE: 'LEAVING_SOURCE',
  TELEPORT: 'TELEPORT',
  LOADING: 'LOADING',
  LOADED: 'LOADED',
  WORLD_READY: 'WORLD_READY',

  // Backward-compatible names consumed by the canonical 14-test Moradon suite.
  ZONE_CHANGE_WAIT_LOADING: 'TELEPORT',
  ZONE_CHANGE_WAIT_LOADED: 'LOADED',
});

const TRANSITION_REASON = Object.freeze({
  WARP: 'WARP',
  GATE: 'GATE',
  TELEPORT: 'TELEPORT',
  RESPAWN: 'RESPAWN',
});

const WORLD_ENTRY_REASON = Object.freeze({
  INITIAL: 'INITIAL',
  RECONNECT: 'RECONNECT',
});

const BOOTSTRAP_STAGE = Object.freeze({
  USERS: 'USERS',
  NPCS: 'NPCS',
  MOBS: 'MOBS',
});

module.exports = {
  OPCODE,
  USER_INOUT,
  GAMESTART_PHASE,
  ZONE_CHANGE_PHASE,
  ZONE_ABILITY,
  ZONE,
  MORADON_SPAWN,
  SLOT_MAX,
  HAVE_MAX,
  MYINFO_ITEM_RECORDS,
  VISIBLE_EQUIPMENT_RECORDS,
  SKILL_BYTES,
  WORLD_STATE,
  TRANSITION_REASON,
  WORLD_ENTRY_REASON,
  BOOTSTRAP_STAGE,
};
