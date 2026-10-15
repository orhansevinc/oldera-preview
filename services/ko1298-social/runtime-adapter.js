'use strict';

const { OPCODES } = require('./constants');
const { PvpPolicy } = require('./pvp-policy');
const { CombatSocialLedger } = require('./combat-ledger');
const { SocialAuthority } = require('./social-authority');

const PLAYER_COMMANDS = new Set([
  'friend.request','friend.accept','friend.reject','friend.remove','friend.block','friend.unblock','friend.list',
  'clan.createClan','clan.invite','clan.acceptInvite','clan.rejectInvite','clan.leave','clan.kick','clan.disband',
  'clan.appointChief','clan.appointViceChief','clan.appointOfficer','clan.punish','clan.listMembers',
]);

class P2SocialRuntimeAdapter {
  constructor(options = {}) {
    this.pvpPolicy = options.pvpPolicy ?? new PvpPolicy();
    this.social = options.social ?? new SocialAuthority(options);
    this.ledger = options.ledger ?? (options.combatOutcomeSink ? new CombatSocialLedger({ pvpPolicy: this.pvpPolicy, sink: options.combatOutcomeSink, rankingReader: options.rankingReader }) : null);
  }
  onSessionReady(session) { return this.social.registerSession(session); }
  onSessionDisconnect(sessionId, info) { return this.social.disconnectSession(sessionId, info); }
  onSessionLeaseExpired(characterId) { return this.social.expireCharacter(characterId); }
  onZoneChanged(characterId, zoneId) { return this.social.updateZone(characterId, zoneId); }
  routePacket(sessionId, packet) { return this.social.handlePacket(sessionId, packet); }

  validateAttack({ attackerCharacterId, targetCharacterId, attackerZoneEpoch, targetZoneEpoch, attackerInSafeArea = false, targetInSafeArea = false, battleOpen = false, invasionOpen = false }) {
    const a = this.social.getSessionByCharacter(attackerCharacterId), t = this.social.getSessionByCharacter(targetCharacterId);
    if (!a || !t) return { allowed: false, reason: 'SESSION_NOT_FOUND' };
    return this.pvpPolicy.canAttack({
      attacker: { characterId: a.characterId, nation: a.nation, zoneId: a.zoneId, zoneEpoch: a.zoneEpoch, requestZoneEpoch: attackerZoneEpoch, inSafeArea: attackerInSafeArea },
      target: { characterId: t.characterId, nation: t.nation, zoneId: t.zoneId, zoneEpoch: t.zoneEpoch, requestZoneEpoch: targetZoneEpoch, inSafeArea: targetInSafeArea },
      battleOpen, invasionOpen,
    });
  }
  canEnterZone(input) { return this.pvpPolicy.canEnter(input); }
  partyCombatShare(characterId, event, eligible) { return this.social.getPartyShareSnapshot(characterId, { purpose: 'experience', event, eligible }); }
  partyLootShare(characterId, event, eligible) { return this.social.getPartyShareSnapshot(characterId, { purpose: 'loot', event, eligible }); }
  onCombatOutcome(event) { if (!this.ledger) return Promise.resolve({ ok: false, code: 'COMBAT_LEDGER_PERSISTENCE_REQUIRED' }); return this.ledger.consume(event); }
  rankings(query) { if (!this.ledger) return Promise.resolve({ ok: false, code: 'COMBAT_LEDGER_PERSISTENCE_REQUIRED' }); return this.ledger.rankings(query); }

  async playerCommand(characterId, command, payload = {}) {
    if (String(command).startsWith('gm.') || String(command).startsWith('admin.') || !PLAYER_COMMANDS.has(command)) return { ok: false, code: 'PLAYER_COMMAND_DENIED' };
    const [domain, action] = command.split('.', 2);
    if (domain === 'friend') return this.social.friendAction(characterId, action, payload.targetId);
    if (domain === 'clan') return this.social.clanAction(characterId, action, payload);
    return { ok: false, code: 'PLAYER_COMMAND_DENIED' };
  }

  static integrationManifest() {
    return Object.freeze({
      packetRoutes: [
        { opcode: OPCODES.CHAT, owner: 'P2-09', codec: 'verified-ws18' },
        { opcode: OPCODES.CHAT_TARGET, owner: 'P2-09', codec: 'verified-ws18' },
        { opcode: OPCODES.PARTY, owner: 'P2-09', codec: 'verified-ws18' },
        { opcode: OPCODES.KNIGHTS, owner: 'P2-09', codec: 'blocked-source-layout' },
        { opcode: OPCODES.FRIEND, owner: 'P2-09', codec: 'blocked-source-layout' },
        { opcode: OPCODES.OPERATOR, owner: 'admin/gm', playerDisposition: 'deny' },
      ],
      events: ['session.ready','session.disconnect','session.lease-expired','world.zone-changed','combat.authoritative-outcome','combat.attack-validate','loot.party-share'],
    });
  }
}

module.exports = { P2SocialRuntimeAdapter, PLAYER_COMMANDS };
