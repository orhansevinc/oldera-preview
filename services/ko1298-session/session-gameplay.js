'use strict';

const { GAME } = require('./protocol');
const { SESSION_STATES, OWNER } = require('./contracts');
const { SessionError, ERROR_CATEGORY } = require('./errors');
const { validateNpcRequestPacket, clientPacketsFrom, malformedPacket } = require('./session-helpers');
const { parseAttackPacket, parseMagicProcessPacket } = require('./combat-protocol');
const combatCodec = require('../../protocol-lab/runtime/playable-combat-codec.cjs');

function hasTargetHpChange(o) { return Number.isInteger(o?.oldTargetHp) && Number.isInteger(o?.newTargetHp) && o.oldTargetHp !== o.newTargetHp; }
function hasTargetDeathEvent(o) { return Array.isArray(o?.events) && o.events.some(e => e?.type === 'TARGET_DIED'); }
function normalAttackWireResult(o) { return !o?.ok ? 'FAIL' : (o.dead || hasTargetDeathEvent(o) ? 'SUCCESS_AND_DEAD' : 'SUCCESS'); }
function slashWireResult(o) { return !o?.ok ? 'MAGIC_FAIL' : (Number(o.damage) > 0 ? 'EFFECTING_SUCCESS' : 'EFFECTING_MISS'); }

function install(GameSession) {
  GameSession.prototype._handleWorldPacket = async function(packet) {
    if (packet[0] === GAME.REQUEST_NPC_IN) { validateNpcRequestPacket(packet); if (this.npcRoutesRequestNpcIn && this.npcRouter) return this._handleNpcPacket(packet); }
    if (!this.worldSession || typeof this.worldSession.handleClientPacket !== 'function') return [];
    try { const outcome = await this.worldSession.handleClientPacket(this.socketId, packet); await this._applyWorldOutcome(outcome); this._emitWorldBroadcast(outcome); return clientPacketsFrom(outcome); }
    catch (error) { throw new SessionError('WORLD_HANDLER_FAILED', 'WS14 world handler failed', { category: ERROR_CATEGORY.DOWNSTREAM, fatal: true, details: { owner: OWNER.WS14, opcode: packet[0] }, cause: error }); }
  };

  GameSession.prototype._handleMovementPacket = async function(packet) {
    if (!this.movementSession) { this.logger('downstream_unavailable', this._packetMeta(packet, { owner: OWNER.WS15 })); return []; }
    if (packet[0] === GAME.MOVE && packet.length !== 10) throw malformedPacket(new Error('WIZ_MOVE requires exactly 9 bytes after opcode'), packet[0], packet.length, 'game');
    if (packet[0] === GAME.ROTATE && packet.length !== 3) throw malformedPacket(new Error('WIZ_ROTATE requires exactly 2 bytes after opcode'), packet[0], packet.length, 'game');
    try { const outcome = packet[0] === GAME.MOVE ? await this.movementSession.handleMovePacket(this.sessionId, packet.subarray(1)) : await this.movementSession.handleRotatePacket(this.sessionId, packet.subarray(1)); this._emitGameplayOutcome(OWNER.WS15, outcome); return clientPacketsFrom(outcome); }
    catch (error) { this.logger('downstream_rejected', this._packetMeta(packet, { owner: OWNER.WS15, downstreamCode: error?.code || 'ERROR' })); return []; }
  };

  GameSession.prototype._handleNpcPacket = async function(packet) {
    if (packet[0] === GAME.NPC_EVENT && packet.length !== 3) throw malformedPacket(new Error('WIZ_NPC_EVENT must contain runtime npc id u16'), packet[0], packet.length, 'game');
    if (packet[0] === GAME.TARGET_HP) {
      let decoded; try { decoded = combatCodec.decodeTargetHpQuery(packet); } catch (e) { throw malformedPacket(e, packet[0], packet.length, 'game'); }
      if (!this.combatAdapter || typeof this.combatAdapter.getTargetCombatSnapshot !== 'function') return [];
      try { const target = await this.combatAdapter.getTargetCombatSnapshot(decoded.targetId); if (!target || !Number.isInteger(target.maxHp) || !Number.isInteger(target.hp)) return []; return [combatCodec.encodeTargetHp({ targetId: decoded.targetId, updateImmediately: decoded.updateImmediately, maxHp: target.maxHp, currentHp: target.hp, hpDelta: 0 })]; }
      catch (error) { this.logger('downstream_rejected', this._packetMeta(packet, { owner: OWNER.WS25, downstreamCode: error?.code || 'ERROR' })); return []; }
    }
    if (packet[0] === GAME.REQUEST_NPC_IN) validateNpcRequestPacket(packet);
    if (!this.npcRouter || typeof this.npcRouter.route !== 'function') return [];
    try { const outcome = await this.npcRouter.route(Buffer.from(packet), this.actorContext()); this._emitGameplayOutcome(OWNER.WS16, outcome); return clientPacketsFrom(outcome); }
    catch (error) { this.logger('downstream_rejected', this._packetMeta(packet, { owner: OWNER.WS16, downstreamCode: error?.code || 'ERROR' })); return []; }
  };

  GameSession.prototype._nextCombatRequestMeta = function(opcode, context = {}) { this.combatIngressSequence += 1; const receiveSequence = Number.isSafeInteger(context.receiveSequence) && context.receiveSequence >= 0 ? context.receiveSequence : null; const dedupeSequence = receiveSequence ?? this.combatIngressSequence; return Object.freeze({ ingressSequence: this.combatIngressSequence, receiveSequence, requestKey: `${this.sessionId}:${opcode.toString(16).padStart(2, '0')}:${dedupeSequence}` }); };

  GameSession.prototype._handleCombatPacket = async function(packet, context = {}) {
    const actor = this.actorContext(), metadata = this._nextCombatRequestMeta(packet[0], context); let operation;
    if (packet[0] === GAME.ATTACK) { const d = parseAttackPacket(packet, GAME.ATTACK); operation = Object.freeze({ kind: 'NORMAL_ATTACK', sourceEntityId: actor.entityId, sourceCharacterId: actor.characterId, targetRuntimeId: d.targetRuntimeId, requestKey: metadata.requestKey, requestMetadata: metadata, clientObservation: d.clientObservation }); }
    else if (packet[0] === GAME.MAGIC_PROCESS) { const d = parseMagicProcessPacket(packet, GAME.MAGIC_PROCESS); operation = Object.freeze({ kind: 'MAGIC_PROCESS', command: d.command, commandName: d.commandName, skillId: d.skillId, sourceEntityId: actor.entityId, sourceCharacterId: actor.characterId, clientClaimedSourceId: d.clientSourceId, targetRuntimeId: d.targetRuntimeId, data: d.data, requestKey: metadata.requestKey, requestMetadata: metadata }); }
    else throw malformedPacket(new Error('unsupported combat opcode'), packet[0], packet.length, 'game');
    const outcome = await this.trustedDomainCall('combat', operation); this._emitCombatSemanticEvent(operation, outcome); return this._encodeCombatOutcome(operation, outcome);
  };

  GameSession.prototype._encodeCombatOutcome = async function(operation, outcome) {
    const actor = this.actorContext(), packets = [];
    if (operation.kind === 'NORMAL_ATTACK') {
      packets.push(combatCodec.encodeAttackResult({ attackType: 'DIRECT', result: normalAttackWireResult(outcome), attackerId: actor.entityId, targetId: operation.targetRuntimeId }));
      await this._appendTargetHpAndDeathPackets(packets, operation.targetRuntimeId, outcome); return packets;
    }
    if (operation.kind === 'MAGIC_PROCESS' && operation.skillId === 101003) {
      packets.push(combatCodec.encodeSlash101003Result({ result: slashWireResult(outcome), sourceId: actor.entityId, targetId: operation.targetRuntimeId }));
      if (outcome?.ok && Number.isInteger(outcome.newResource) && this.combatAdapter && typeof this.combatAdapter.getPlayerCombatSnapshot === 'function') {
        const p = await this.combatAdapter.getPlayerCombatSnapshot(actor.entityId), kind = outcome.resourceKind || p?.resourceKind; const maxMsp = kind === 'SP' ? p?.maxSp : p?.maxMp, currentMsp = kind === 'SP' ? p?.sp : p?.mp;
        if (Number.isInteger(maxMsp) && Number.isInteger(currentMsp)) packets.push(combatCodec.encodePlayerMsp({ maxMsp, currentMsp }));
      }
      await this._appendTargetHpAndDeathPackets(packets, operation.targetRuntimeId, outcome); return packets;
    }
    return packets;
  };

  GameSession.prototype._appendTargetHpAndDeathPackets = async function(packets, targetId, outcome) {
    if (hasTargetHpChange(outcome)) {
      const snap = this.combatAdapter && typeof this.combatAdapter.getTargetCombatSnapshot === 'function' ? await this.combatAdapter.getTargetCombatSnapshot(targetId) : null;
      if (!Number.isInteger(snap?.maxHp) || !Number.isInteger(snap?.hp)) throw new Error('authoritative target HP snapshot unavailable after combat mutation');
      packets.push(combatCodec.encodeTargetHp({ targetId, updateImmediately: 1, maxHp: snap.maxHp, currentHp: snap.hp, hpDelta: outcome.newTargetHp - outcome.oldTargetHp }));
    }
    if (hasTargetDeathEvent(outcome) && !this.combatDeathSignals.has(targetId)) { this.combatDeathSignals.add(targetId); packets.push(combatCodec.encodeDead({ targetId })); }
  };

  GameSession.prototype._handleMobAttackIntent = async function(event) {
    if (!this.combatAdapter || typeof this.combatAdapter.resolveMobAttackIntent !== 'function') return [];
    const actor = this.actorContext(), outcome = await this.combatAdapter.resolveMobAttackIntent({ actor, event }); this.onCombatEvent(Object.freeze({ owner: OWNER.WS19, type: 'MOB_ATTACK_RESULT', actor, event, outcome })); const packets = [];
    if (outcome?.ok && Number.isInteger(outcome.newTargetHp) && typeof this.combatAdapter.getPlayerCombatSnapshot === 'function') { const p = await this.combatAdapter.getPlayerCombatSnapshot(actor.entityId); if (Number.isInteger(p?.maxHp) && Number.isInteger(p?.hp)) packets.push(combatCodec.encodePlayerHp({ maxHp: p.maxHp, currentHp: p.hp })); }
    packets.push(combatCodec.encodeAttackResult({ attackType: 'DIRECT', result: normalAttackWireResult(outcome), attackerId: event.runtimeId, targetId: actor.entityId })); return packets;
  };

  GameSession.prototype._emitCombatSemanticEvent = function(operation, outcome) { this.onCombatEvent(Object.freeze({ owner: OWNER.WS19, type: operation.kind === 'NORMAL_ATTACK' ? 'NORMAL_ATTACK_RESULT' : 'MAGIC_PROCESS_RESULT', actor: this.actorContext(), operation, outcome })); };

  GameSession.prototype._applyWorldOutcome = async function(outcome) {
    const s = outcome?.snapshot || null; if (s) { if (Number.isInteger(s.zoneId)) this.state.zoneId = s.zoneId; if (Number.isInteger(s.socketId)) this.state.entityId = s.entityId ?? s.socketId; else if (Number.isInteger(s.entityId)) this.state.entityId = s.entityId; if ([s.x,s.y,s.z].every(Number.isFinite)) this.state.position = { x:s.x,y:s.y,z:s.z }; }
    if (outcome?.state === 'WORLD_READY') { if (this.state.phase !== SESSION_STATES.WORLD_READY) this._transition(SESSION_STATES.WORLD_READY, 'WS14 WORLD_READY'); await this._registerMovementIfNeeded(); return; }
    if (this.state.phase === SESSION_STATES.WORLD_READY && typeof outcome?.state === 'string' && outcome.state !== 'WORLD_READY') { await this._resetMovementForWorldTransition(outcome.state); this._transition(SESSION_STATES.WORLD_LOADING, `WS14 ${outcome.state}`); }
  };

  GameSession.prototype._resetMovementForWorldTransition = async function(worldState) { if (!this.movementRegistered || !this.movementSession) return; const a=this.actorContext(); try { if (typeof this.movementSession.teleport==='function'&&Number.isInteger(a.zoneId)&&a.position){await this.movementSession.teleport(this.sessionId,{zoneId:a.zoneId,position:a.position,headingRaw:this.state.headingRaw,reason:`WS14:${worldState}`});return;} if(typeof this.movementSession.disconnect==='function') await this.movementSession.disconnect(this.sessionId); this.movementRegistered=false;} catch(error){throw new SessionError('MOVEMENT_WORLD_TRANSITION_FAILED','WS15 movement baseline reset failed during world transition',{category:ERROR_CATEGORY.DOWNSTREAM,fatal:true,details:{owner:OWNER.WS15,worldState},cause:error});} };
  GameSession.prototype._registerMovementIfNeeded = async function(){if(this.movementRegistered||!this.movementSession||typeof this.movementSession.registerSession!=='function')return;const a=this.actorContext();if(!Number.isInteger(a.entityId)||!Number.isInteger(a.zoneId)||!a.position)throw new SessionError('MOVEMENT_CONTEXT_INCOMPLETE','WS15 registration requires verified entity/zone/position context',{category:ERROR_CATEGORY.DOWNSTREAM,fatal:true,details:{entityId:a.entityId,zoneId:a.zoneId}});try{await this.movementSession.registerSession({sessionId:this.sessionId,entityId:a.entityId,zoneId:a.zoneId,position:a.position,headingRaw:this.state.headingRaw});this.movementRegistered=true;}catch(error){throw new SessionError('MOVEMENT_REGISTER_FAILED','WS15 movement registration failed',{category:ERROR_CATEGORY.DOWNSTREAM,fatal:true,details:{owner:OWNER.WS15},cause:error});}};
  GameSession.prototype._emitWorldBroadcast=function(outcome){for(const packet of outcome?.broadcastPackets||[])this.onWorldBroadcast({packet:Buffer.from(packet),snapshot:outcome.snapshot||null,actor:this.actorContext()});};
  GameSession.prototype._emitGameplayOutcome=function(owner,outcome){if(!outcome)return;const packets=[];if(Buffer.isBuffer(outcome.packet))packets.push({packet:outcome.packet,recipients:outcome.recipients||[]});for(const item of outcome.broadcastPackets||[]){if(Buffer.isBuffer(item))packets.push({packet:item,recipients:outcome.recipients||[]});else if(item?.packet)packets.push({packet:item.packet,recipients:item.recipients||outcome.recipients||[]});}for(const item of packets)this.onGameplayBroadcast({owner,packet:Buffer.from(item.packet),recipients:Array.isArray(item.recipients)?[...item.recipients]:[],actor:this.actorContext()});};
}
module.exports={install};
