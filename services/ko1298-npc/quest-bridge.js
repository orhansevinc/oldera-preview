'use strict';

const { NpcDependencyError } = require('./production');

class OfferedOptionLedger {
  constructor() {
    this.offers = new Map();
  }

  _key(sessionId) {
    if (typeof sessionId !== 'string' || sessionId.length === 0) throw new TypeError('sessionId is required');
    return sessionId;
  }

  offer({ sessionId, npcRuntimeId, npcTemplateSid, options }) {
    if (!Number.isInteger(npcRuntimeId)) throw new TypeError('npcRuntimeId is required');
    if (!Number.isInteger(npcTemplateSid)) throw new TypeError('npcTemplateSid is required');
    if (!Array.isArray(options) || options.length === 0) throw new TypeError('at least one offered option is required');
    const normalized = options.map((option, index) => {
      if (!option || typeof option.action !== 'string' || option.action.length === 0) {
        throw new TypeError(`option ${index} action is required`);
      }
      return Object.freeze({ index, action: option.action, menuId: option.menuId ?? null, metadata: option.metadata ?? null });
    });
    this.offers.set(this._key(sessionId), Object.freeze({ npcRuntimeId, npcTemplateSid, options: Object.freeze(normalized) }));
    return normalized;
  }

  select({ sessionId, npcRuntimeId, index }) {
    if (!Number.isInteger(index) || index < 0) throw new NpcDependencyError('NPC_OPTION_INVALID', 'option index must be a non-negative integer');
    const key = this._key(sessionId);
    const offer = this.offers.get(key);
    if (!offer) throw new NpcDependencyError('NPC_OPTION_NOT_OFFERED', 'no active server-authored NPC offer exists');
    if (offer.npcRuntimeId !== npcRuntimeId) {
      throw new NpcDependencyError('NPC_OPTION_TARGET_MISMATCH', 'selection does not belong to the active NPC offer', {
        expectedNpcRuntimeId: offer.npcRuntimeId,
        actualNpcRuntimeId: npcRuntimeId,
      });
    }
    const selected = offer.options[index];
    if (!selected) throw new NpcDependencyError('NPC_OPTION_NOT_OFFERED', 'selected option was not offered by the server', { index });
    this.offers.delete(key);
    return Object.freeze({ ...selected, npcTemplateSid: offer.npcTemplateSid });
  }

  clear(sessionId) {
    return this.offers.delete(this._key(sessionId));
  }
}

async function authoritativePlayer(playerAuthority, session) {
  if (!playerAuthority || typeof playerAuthority.snapshot !== 'function') {
    throw new NpcDependencyError('NPC_PLAYER_AUTHORITY_MISSING', 'server-authoritative level/nation/class snapshot is required', { owner: 'P2-11' });
  }
  const player = await playerAuthority.snapshot({
    accountId: session.accountId,
    characterId: session.characterId,
  });
  if (!player || !Number.isInteger(player.level) || !Number.isInteger(player.nationId) || !Number.isInteger(player.classId)) {
    throw new NpcDependencyError('NPC_PLAYER_AUTHORITY_INCOMPLETE', 'authoritative player snapshot must include level, nationId and classId');
  }
  return player;
}

function createQuestBridge({ eventRouter, encodeMenu, playerAuthority, ledger = new OfferedOptionLedger() } = {}) {
  if (!eventRouter || typeof eventRouter.route !== 'function') throw new TypeError('WS23 NpcEventRouter is required');
  if (typeof encodeMenu !== 'function') throw new TypeError('P2-10 encodeMenu is required');

  async function execute({ session, npc, action }) {
    if (!session?.characterId) throw new NpcDependencyError('NPC_CHARACTER_REQUIRED', 'quest interaction requires selected character');
    const player = await authoritativePlayer(playerAuthority, session);
    const routed = await eventRouter.route({
      npcId: npc.templateSid,
      action,
      characterId: session.characterId,
      player,
    });
    if (!routed?.handled) {
      throw new NpcDependencyError('QUEST_ROUTE_MISSING', 'no source-backed quest/event route exists for NPC action', {
        templateSid: npc.templateSid,
        action,
      });
    }
    return { routed, player };
  }

  return Object.freeze({
    ledger,
    async interact({ session, npc }) {
      const { routed } = await execute({ session, npc, action: 'interact' });
      const encoded = await encodeMenu({ session, npc, routed });
      if (!encoded || !Buffer.isBuffer(encoded.packet) || !Array.isArray(encoded.options) || encoded.options.length === 0) {
        throw new NpcDependencyError('QUEST_MENU_ENCODER_INVALID', 'P2-10 must return a real WIZ_SELECT_MSG packet and offered option map');
      }
      ledger.offer({ sessionId: session.sessionId, npcRuntimeId: npc.runtimeId ?? npc.instanceId, npcTemplateSid: npc.templateSid, options: encoded.options });
      return encoded.packet;
    },
    async select({ session, npc, index }) {
      const selected = ledger.select({ sessionId: session.sessionId, npcRuntimeId: npc.runtimeId ?? npc.instanceId, index });
      const { routed } = await execute({ session, npc, action: selected.action });
      return routed;
    },
    disconnect(sessionId) {
      return ledger.clear(sessionId);
    },
  });
}

module.exports = { OfferedOptionLedger, createQuestBridge };
