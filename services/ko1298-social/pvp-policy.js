'use strict';

const { NATION, ZONE } = require('./constants');
const BATTLE_ZONES = new Set([ZONE.BATTLE_1, ZONE.BATTLE_2, ZONE.BATTLE_3, ZONE.SNOW_BATTLE]);
const SUPPORTED = new Set(Object.values(ZONE));

function validNation(n) { return n === NATION.KARUS || n === NATION.EL_MORAD; }
function homeFor(n) { return n === NATION.KARUS ? ZONE.KARUS_HOME : n === NATION.EL_MORAD ? ZONE.EL_MORAD_HOME : null; }
function enemyHomeFor(n) { return n === NATION.KARUS ? ZONE.EL_MORAD_HOME : n === NATION.EL_MORAD ? ZONE.KARUS_HOME : null; }
function eslantFor(n) { return n === NATION.KARUS ? ZONE.KARUS_ESLANT : n === NATION.EL_MORAD ? ZONE.EL_MORAD_ESLANT : null; }

class PvpPolicy {
  isSupportedZone(zoneId) { return SUPPORTED.has(Number(zoneId)); }
  isBattleZone(zoneId) { return BATTLE_ZONES.has(Number(zoneId)); }
  canEnter({ nation, zoneId, battleOpen = false, invasionOpen = false }) {
    zoneId = Number(zoneId);
    if (!validNation(nation) || !this.isSupportedZone(zoneId)) return { allowed: false, reason: 'UNSUPPORTED_ZONE_OR_NATION' };
    if (zoneId === ZONE.MORADON || zoneId === ZONE.ARENA) return { allowed: true, reason: 'ALLOWED' };
    if (this.isBattleZone(zoneId)) return battleOpen ? { allowed: true, reason: 'ALLOWED' } : { allowed: false, reason: 'BATTLE_CLOSED' };
    if (zoneId === homeFor(nation) || zoneId === eslantFor(nation)) return { allowed: true, reason: 'ALLOWED' };
    if (zoneId === enemyHomeFor(nation)) return invasionOpen ? { allowed: true, reason: 'ALLOWED' } : { allowed: false, reason: 'ENEMY_HOME_LOCKED' };
    return { allowed: false, reason: 'NATION_LOCKED' };
  }

  canAttack({ attacker, target, battleOpen = false, invasionOpen = false }) {
    if (!attacker || !target || !validNation(attacker.nation) || !validNation(target.nation)) return { allowed: false, reason: 'INVALID_ACTOR' };
    if (Number(attacker.zoneId) !== Number(target.zoneId)) return { allowed: false, reason: 'ZONE_MISMATCH' };
    if (attacker.zoneEpoch != null && attacker.requestZoneEpoch != null && attacker.zoneEpoch !== attacker.requestZoneEpoch) return { allowed: false, reason: 'STALE_ZONE_EPOCH' };
    if (target.zoneEpoch != null && target.requestZoneEpoch != null && target.zoneEpoch !== target.requestZoneEpoch) return { allowed: false, reason: 'STALE_TARGET_ZONE_EPOCH' };
    if (attacker.inSafeArea || target.inSafeArea) return { allowed: false, reason: 'SAFE_AREA' };
    const zone = Number(attacker.zoneId);
    if (!this.isSupportedZone(zone)) return { allowed: false, reason: 'UNSUPPORTED_ZONE' };
    if (zone === ZONE.MORADON) return { allowed: false, reason: 'PVP_DISABLED' };
    if (zone === ZONE.KARUS_ESLANT || zone === ZONE.EL_MORAD_ESLANT) return { allowed: false, reason: 'PVP_DISABLED' };
    if (zone === ZONE.ARENA) return { allowed: true, reason: 'ARENA' };
    if (this.isBattleZone(zone)) {
      if (!battleOpen) return { allowed: false, reason: 'BATTLE_CLOSED' };
      return attacker.nation !== target.nation ? { allowed: true, reason: 'BATTLE_HOSTILE' } : { allowed: false, reason: 'FRIENDLY_FIRE' };
    }
    if (zone === ZONE.KARUS_HOME || zone === ZONE.EL_MORAD_HOME) {
      if (!invasionOpen) return { allowed: false, reason: 'PVP_DISABLED' };
      return attacker.nation !== target.nation ? { allowed: true, reason: 'INVASION_HOSTILE' } : { allowed: false, reason: 'FRIENDLY_FIRE' };
    }
    return { allowed: false, reason: 'PVP_DISABLED' };
  }

  npEligible(context) {
    const attack = this.canAttack(context);
    if (!attack.allowed) return { eligible: false, reason: attack.reason };
    const zone = Number(context.attacker.zoneId);
    if (zone === ZONE.ARENA) return { eligible: false, reason: 'ARENA_NO_NP' };
    if (this.isBattleZone(zone) || zone === ZONE.KARUS_HOME || zone === ZONE.EL_MORAD_HOME) return { eligible: true, reason: 'ALLOWED' };
    return { eligible: false, reason: 'PVP_DISABLED' };
  }
}

module.exports = { PvpPolicy, BATTLE_ZONES };
