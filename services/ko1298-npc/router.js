'use strict';

const {
  OPCODES,
  encodeNpcRegion,
  parseNpcInRequest,
  encodeNpcInResponse,
  parseNpcEventRequest,
  parseTargetHpRequest,
  encodeTargetHpResponse,
} = require('./protocol');

class NpcInteractionRouter {
  constructor({ world, merchant = null, quest = null, target = null } = {}) {
    if (!world) throw new TypeError('world is required');
    this.world = world;
    this.merchant = merchant;
    this.quest = quest;
    this.target = target;
  }

  nearbyPacket({ zoneId, x, z }) {
    return encodeNpcRegion(this.world.nearby(zoneId, x, z).map(n => n.instanceId));
  }

  route(packet, session) {
    const opcode = Buffer.from(packet)[0];
    if (opcode === OPCODES.REQ_NPCIN) {
      const { instanceIds } = parseNpcInRequest(packet);
      const npcs = instanceIds.map(id => this.world.get(id)).filter(Boolean);
      return { kind: 'packets', packets: [encodeNpcInResponse(npcs)] };
    }
    if (opcode === OPCODES.NPC_EVENT) {
      const { instanceId } = parseNpcEventRequest(packet);
      const npc = this.world.get(instanceId);
      if (!npc) return { kind: 'reject', reason: 'unknown-npc', instanceId };
      if (session?.zoneId != null && session.zoneId !== npc.zoneId) return { kind: 'reject', reason: 'wrong-zone', instanceId };
      const context = { session, npc };
      if (npc.npcType === 21 && this.merchant) return this.merchant(context);
      if (this.quest) return this.quest(context);
      return { kind: 'interaction', interface: npc.npcType === 21 ? 'merchant' : 'quest', context };
    }
    if (opcode === OPCODES.TARGET_HP) {
      const request = parseTargetHpRequest(packet);
      const npc = this.world.get(request.instanceId);
      if (!npc) return { kind: 'reject', reason: 'unknown-npc', instanceId: request.instanceId };
      if (this.target) return this.target({ session, npc, request });
      if (Number.isInteger(npc.maxHp) && Number.isInteger(npc.hp)) {
        return { kind: 'packets', packets: [encodeTargetHpResponse({
          instanceId: npc.instanceId, immediate: request.immediate, maxHp: npc.maxHp, hp: npc.hp, change: 0,
        })] };
      }
      return { kind: 'target', npc, request };
    }
    return { kind: 'unhandled', opcode };
  }
}

module.exports = { NpcInteractionRouter };
