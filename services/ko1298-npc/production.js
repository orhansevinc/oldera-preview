'use strict';

const { NpcInteractionRouter, NpcInteractionError } = require('./router');

const P2_05_INTERACTION_RANGE = 11;
const CLIENT_PROTOCOL_SOURCE = 'Open-KO/KnightOnline@7d6cf81093e142c928c2ac9510512b2b182178b5';
const NPC_TYPE_SOURCE = `${CLIENT_PROTOCOL_SOURCE}:src/shared/globals.h`;
const PACKET_SOURCE = `${CLIENT_PROTOCOL_SOURCE}:src/shared/packets.h`;
const WAREHOUSE_SOURCE = `${CLIENT_PROTOCOL_SOURCE}:src/Client/WarFare/PacketDef.h`;
const QUEST_UI_SOURCE = `${CLIENT_PROTOCOL_SOURCE}:src/Client/WarFare/UIQuestMenu.cpp`;
const MORADON_EVT_SOURCE = `${CLIENT_PROTOCOL_SOURCE}:assets/Server/QUESTS/21.evt`;

const VERIFIED_NPC_TYPES = Object.freeze({
  MERCHANT: 21,
  TINKER: 22,
  SELITH: 23,
  ANVIL: 24,
  TELEPORT_GATE: 28,
  OPERATOR: 29,
  WAREHOUSE: 31,
  MASTER_WARRIOR: 73,
  MASTER_ROGUE: 74,
  MASTER_MAGE: 75,
  MASTER_PRIEST: 76,
  BLACKSMITH: 77,
  COLISEUM_ARTES: 136,
  LOVE_AGENT: 140,
});

const OPCODES = Object.freeze({
  WIZ_NPC_EVENT: 0x20,
  WIZ_TRADE_NPC: 0x25,
  WIZ_REPAIR_NPC: 0x3a,
  WIZ_WAREHOUSE: 0x45,
  WIZ_SELECT_MSG: 0x55,
});
const WAREHOUSE_SUBPACKETS = Object.freeze({ N3_SP_WARE_INN: 0x10 });

class NpcDependencyError extends NpcInteractionError {
  constructor(code, message, details = {}) {
    super(code, message || code, details);
    this.name = 'NpcDependencyError';
  }
}

function encodeSellingGroupPacket(opcode, sellingGroup) {
  if (!Number.isInteger(sellingGroup) || sellingGroup <= 0 || sellingGroup > 0xffffffff) {
    throw new NpcInteractionError('invalid-selling-group', 'authoritative NPC sellingGroup is required', { sellingGroup });
  }
  const packet = Buffer.allocUnsafe(5);
  packet.writeUInt8(opcode, 0);
  packet.writeUInt32LE(sellingGroup >>> 0, 1);
  return packet;
}

function encodeMerchantOpen(npc) {
  const opcode = npc.npcType === VERIFIED_NPC_TYPES.TINKER ? OPCODES.WIZ_REPAIR_NPC : OPCODES.WIZ_TRADE_NPC;
  return encodeSellingGroupPacket(opcode, npc.sellingGroup);
}

function encodeWarehouseInnOpen() {
  return Buffer.from([OPCODES.WIZ_WAREHOUSE, WAREHOUSE_SUBPACKETS.N3_SP_WARE_INN]);
}

function failClosedDependency(owner, capability, source) {
  return ({ npc }) => {
    throw new NpcDependencyError(
      'NPC_DEPENDENCY_UNAVAILABLE',
      `${capability} is not composed; refusing successful empty NPC action`,
      { owner, capability, source, templateSid: npc.templateSid, npcType: npc.npcType },
    );
  };
}

function promoteClientPackets(outcome) {
  if (!outcome || Array.isArray(outcome.clientPackets)) return outcome;
  const nested = outcome.result;
  const packets = Buffer.isBuffer(nested)
    ? [Buffer.from(nested)]
    : Array.isArray(nested?.clientPackets)
      ? nested.clientPackets.filter(Buffer.isBuffer).map(Buffer.from)
      : Array.isArray(nested?.packets)
        ? nested.packets.filter(Buffer.isBuffer).map(Buffer.from)
        : [];
  return packets.length ? { ...outcome, clientPackets: packets } : outcome;
}

function normalizeActorContext(session) {
  if (!session || typeof session !== 'object') return session;
  const position = session.position || null;
  return {
    ...session,
    x: Number.isFinite(session.x) ? session.x : position?.x,
    y: Number.isFinite(session.y) ? session.y : position?.y,
    z: Number.isFinite(session.z) ? session.z : position?.z,
  };
}

function createProductionNpcRuntime({ world, dependencies = {} } = {}) {
  if (!world) throw new TypeError('npc world is required');

  const handlers = {
    merchant: ({ npc }) => encodeMerchantOpen(npc),
    inn: ({ npc }) => {
      if (npc.npcType !== VERIFIED_NPC_TYPES.WAREHOUSE) {
        throw new NpcInteractionError('unsupported-inn-type', 'only source-backed NPC_WAREHOUSE is accepted', {
          npcType: npc.npcType,
          templateSid: npc.templateSid,
        });
      }
      return encodeWarehouseInnOpen();
    },
    quest: dependencies.quest || failClosedDependency('P2-11/P2-08', 'quest-event persistence/reward transaction', MORADON_EVT_SOURCE),
    world: dependencies.worldTransition || failClosedDependency('P2-04', 'zone transition', NPC_TYPE_SOURCE),
  };

  const baseRouter = new NpcInteractionRouter({
    world,
    interactionRange: P2_05_INTERACTION_RANGE,
    merchant: handlers.merchant,
    inn: handlers.inn,
    quest: handlers.quest,
    worldTransition: handlers.world,
  });

  const router = Object.freeze({
    route(packet, session) {
      const outcome = baseRouter.route(packet, normalizeActorContext(session));
      return outcome && typeof outcome.then === 'function'
        ? outcome.then(promoteClientPackets)
        : promoteClientPackets(outcome);
    },
    assertInteraction(input) {
      return baseRouter.assertInteraction({ ...input, session: normalizeActorContext(input?.session) });
    },
  });

  return Object.freeze({
    router,
    handlers: Object.freeze(handlers),
    protocolEvidence: Object.freeze({
      click: { opcode: OPCODES.WIZ_NPC_EVENT, payload: 'u16 runtimeNpcId', source: `${CLIENT_PROTOCOL_SOURCE}:src/Client/WarFare/GameProcMain.cpp` },
      interactionRange: { value: P2_05_INTERACTION_RANGE, source: NPC_TYPE_SOURCE },
      merchant: { opcode: OPCODES.WIZ_TRADE_NPC, payload: 'u32 sellingGroup', source: PACKET_SOURCE },
      tinker: { opcode: OPCODES.WIZ_REPAIR_NPC, payload: 'u32 sellingGroup', source: PACKET_SOURCE },
      warehouse: { opcode: OPCODES.WIZ_WAREHOUSE, subpacket: WAREHOUSE_SUBPACKETS.N3_SP_WARE_INN, source: WAREHOUSE_SOURCE },
      questMenu: { opcode: OPCODES.WIZ_SELECT_MSG, request: 'u8 offeredOptionIndex', response: 'i16 npcId + u32 talkId + menuId[10]', source: QUEST_UI_SOURCE },
      questEvt: { zoneId: 21, source: MORADON_EVT_SOURCE },
    }),
  });
}

function sourceConsistency(npc) {
  if (!npc || !Number.isInteger(npc.npcType)) return { ok: false, blocker: 'NPC_TYPE_MISSING' };
  if (/warehouse/i.test(String(npc.name || '')) && npc.npcType !== VERIFIED_NPC_TYPES.WAREHOUSE) {
    return { ok: false, blocker: `WAREHOUSE_NAME_TYPE_MISMATCH_EXPECTED_31_GOT_${npc.npcType}` };
  }
  if ((npc.role === 'gate' || npc.interactionRoute === 'world')
      && npc.npcType !== VERIFIED_NPC_TYPES.TELEPORT_GATE) {
    return { ok: false, blocker: `GATE_ROUTE_TYPE_MISMATCH_EXPECTED_28_GOT_${npc.npcType}` };
  }
  if ((npc.role === 'merchant' || npc.sellingGroup > 0)
      && ![VERIFIED_NPC_TYPES.MERCHANT, VERIFIED_NPC_TYPES.TINKER].includes(npc.npcType)) {
    return { ok: false, blocker: `MERCHANT_ROLE_TYPE_MISMATCH_GOT_${npc.npcType}` };
  }
  return { ok: true, blocker: null };
}

function classifyNpcBinding(npc) {
  const consistency = sourceConsistency(npc);
  if (!consistency.ok) return { service: 'source-review', status: 'blocked-source-mismatch', blocker: consistency.blocker };
  if (npc.npcType === VERIFIED_NPC_TYPES.MERCHANT) return { service: 'merchant', status: npc.sellingGroup > 0 ? 'wired' : 'blocked', blocker: npc.sellingGroup > 0 ? null : 'SELLING_GROUP_MISSING' };
  if (npc.npcType === VERIFIED_NPC_TYPES.TINKER) return { service: 'repair+merchant', status: npc.sellingGroup > 0 ? 'wired' : 'blocked', blocker: npc.sellingGroup > 0 ? null : 'SELLING_GROUP_MISSING' };
  if (npc.npcType === VERIFIED_NPC_TYPES.WAREHOUSE) return { service: 'inn/storage', status: 'wired-open', blocker: 'P2-08_STORAGE_TRANSACTIONS' };
  if (npc.npcType === VERIFIED_NPC_TYPES.ANVIL || npc.npcType === VERIFIED_NPC_TYPES.BLACKSMITH) return { service: 'upgrade/anvil', status: 'blocked', blocker: 'P2-08_UPGRADE_TRANSACTION_AND_P2-10_UI' };
  if (npc.npcType === VERIFIED_NPC_TYPES.TELEPORT_GATE) return { service: 'gate/teleport', status: 'blocked', blocker: 'P2-04_WORLD_TRANSITION' };
  if ([73, 74, 75, 76].includes(npc.npcType)) return { service: 'skill/master', status: 'blocked', blocker: 'P2-07_SKILL_MASTER_AUTHORITY' };
  if (npc.interactionRoute === 'quest' || npc.role === 'quest') return { service: 'quest/event', status: 'blocked-source', blocker: 'ZONE21_EVT_RUNTIME_AND_P2-11_TRANSACTION' };
  if (npc.sellingGroup > 0) return { service: 'merchant', status: 'wired', blocker: null };
  return { service: npc.role || 'static', status: 'non-interactive', blocker: null };
}

function buildNpcCoverage(document) {
  if (!document || !Array.isArray(document.templates)) throw new TypeError('NPC catalog templates are required');
  const spawnList = Array.isArray(document.spawns) ? document.spawns : (document.instances || []);
  const byTemplate = new Map();
  for (const spawn of spawnList) {
    if (!byTemplate.has(spawn.templateSid)) byTemplate.set(spawn.templateSid, []);
    byTemplate.get(spawn.templateSid).push(spawn);
  }
  return document.templates.map((template) => {
    const binding = classifyNpcBinding(template);
    return {
      zoneId: document.zoneId,
      templateSid: template.templateSid,
      name: template.name,
      npcType: template.npcType,
      sellingGroup: template.sellingGroup,
      role: template.role || null,
      route: template.interactionRoute || null,
      interactionVerified: template.interactionVerified === true,
      source: template.source?.ref || template.sourceRow || null,
      service: binding.service,
      status: binding.status,
      blocker: binding.blocker,
      prerequisites: binding.service === 'quest/event' ? ['server-authoritative eligibility', 'offered-option ledger', 'P2-11 atomic mutation'] : ['same zone', `distance <= ${P2_05_INTERACTION_RANGE}`],
      result: binding.status.startsWith('wired') ? 'real 1298 client window/event' : 'fail-closed until named dependency/source is composed',
      spawns: (byTemplate.get(template.templateSid) || []).map((spawn) => ({
        spawnKey: spawn.spawnKey || null,
        x: spawn.anchor?.x ?? spawn.x ?? null,
        z: spawn.anchor?.z ?? spawn.z ?? null,
        source: spawn.source?.ref || spawn.sourceRow || null,
      })),
    };
  });
}

module.exports = {
  P2_05_INTERACTION_RANGE,
  VERIFIED_NPC_TYPES,
  OPCODES,
  WAREHOUSE_SUBPACKETS,
  NpcDependencyError,
  encodeMerchantOpen,
  encodeWarehouseInnOpen,
  normalizeActorContext,
  promoteClientPackets,
  createProductionNpcRuntime,
  sourceConsistency,
  classifyNpcBinding,
  buildNpcCoverage,
};
