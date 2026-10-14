'use strict';

const {
  ProtocolError,
  classifyMoveFlag,
  decodeMovePayload,
  decodeRotatePayload,
  encodeMoveBroadcast,
  encodeRotateBroadcast,
  headingRawToYaw,
} = require('./protocol');
const { SlidingWindowFloodGuard } = require('./flood-guard');
const { isFinitePosition } = require('./zone-bounds');
const { DEFAULT_REGION_SIZE, regionForPosition, neighboringRegionKeys } = require('./region-grid');

const DEFAULT_CONFIG = Object.freeze({
  absoluteMaxSpeed: 50,
  speedToleranceMultiplier: 1.35,
  positionSlack: 1.5,
  startPredictionSeconds: 1.75,
  stopPredictionSeconds: 1.75,
  networkGraceSeconds: 0.35,
  maxUpdateGapSeconds: 4,
  maxVerticalDeltaPerPacket: 64,
  includeSenderInBroadcast: true,
  regionSize: DEFAULT_REGION_SIZE,
  visibilityRegionRadius: 1,
});

class MovementRejectedError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'MovementRejectedError'; this.code = code; this.details = details; }
}
function clonePosition(p){return {x:p.x,y:p.y,z:p.z};}
function freezePosition(p){return Object.freeze(clonePosition(p));}
function immutable(obj){return Object.freeze(obj);}
function horizontalDistance(a,b){return Math.hypot(a.x-b.x,a.z-b.z);}
function distance3D(a,b){return Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);}
function ensureSessionId(id){if((typeof id!=='string'&&typeof id!=='number')||String(id).length===0)throw new TypeError('sessionId must be a non-empty string or number');}
function stableSessionCompare(a,b){const as=String(a),bs=String(b);return as<bs?-1:as>bs?1:0;}
function validateHeadingRaw(v,label='headingRaw'){if(!Number.isInteger(v)||v<-0x8000||v>0x7fff)throw new MovementRejectedError('invalid_heading',`${label} must fit int16`);}

function cloneState(state){
  return {
    sessionId:state.sessionId, entityId:state.entityId, zoneId:state.zoneId,
    position:clonePosition(state.position), targetPosition:clonePosition(state.targetPosition),
    headingRaw:state.headingRaw, headingYaw:headingRawToYaw(state.headingRaw), moving:state.moving,
    speed:state.speed, moveFlag:state.moveFlag, sequence:state.sequence,
    lastAcceptedAtMs:state.lastAcceptedAtMs,lastMoveAtMs:state.lastMoveAtMs,
    lastReceiveSequence:state.lastReceiveSequence,teleportGeneration:state.teleportGeneration,
    transitionGeneration:state.transitionGeneration,connectionGeneration:state.connectionGeneration,
    maxSpeed:state.maxSpeed,worldReady:state.worldReady,movementFrozen:state.movementFrozen,
    region:{...state.region},
  };
}
function freezeState(state){
  const c=cloneState(state); c.position=freezePosition(c.position); c.targetPosition=freezePosition(c.targetPosition); c.region=immutable({...c.region}); return immutable(c);
}

class MovementService {
  constructor({zoneBounds,broadcast=()=>{},onTeleport=()=>{},onDisconnect=()=>{},onRegionMembership=()=>{},onSecuritySignal=()=>{},clock=()=>Date.now(),speedPolicy=null,floodGuard=null,terrainAuthority=null,config={}}={}){
    if(!zoneBounds||typeof zoneBounds.isValidPosition!=='function')throw new TypeError('zoneBounds.isValidPosition(zoneId, position) is required');
    for(const [n,v] of [['broadcast',broadcast],['onTeleport',onTeleport],['onDisconnect',onDisconnect],['onRegionMembership',onRegionMembership],['onSecuritySignal',onSecuritySignal],['clock',clock]])if(typeof v!=='function')throw new TypeError(`${n} must be a function`);
    if(speedPolicy!==null&&typeof speedPolicy!=='function'&&typeof speedPolicy.getMaxSpeed!=='function')throw new TypeError('speedPolicy must be a function or expose getMaxSpeed()');
    if(terrainAuthority!==null&&typeof terrainAuthority.validateMovement!=='function')throw new TypeError('terrainAuthority.validateMovement() is required when supplied');
    this.zoneBounds=zoneBounds;this.broadcast=broadcast;this.onTeleport=onTeleport;this.onDisconnect=onDisconnect;this.onRegionMembership=onRegionMembership;this.onSecuritySignal=onSecuritySignal;this.clock=clock;this.speedPolicy=speedPolicy;this.terrainAuthority=terrainAuthority;
    this.floodGuard=floodGuard||new SlidingWindowFloodGuard();this.config={...DEFAULT_CONFIG,...config};this.#validateConfig();
    this.sessions=new Map();this.entityToSession=new Map();this.regionMembers=new Map();this.connectionGeneration=0;
  }

  registerSession({sessionId,entityId,zoneId,position,headingRaw=0,maxSpeed=null,worldReady=true}){
    ensureSessionId(sessionId);this.#assertEntityAvailable(sessionId,entityId);if(this.sessions.has(sessionId))throw new MovementRejectedError('duplicate_session','movement session is already registered');
    if(!Number.isInteger(zoneId))throw new TypeError('zoneId must be an integer');this.#assertFiniteAndWirePosition(position);if(!this.zoneBounds.isValidPosition(zoneId,position))throw new MovementRejectedError('zone_bounds','initial position is outside zone bounds');
    validateHeadingRaw(headingRaw);if(maxSpeed!==null&&(!Number.isFinite(maxSpeed)||maxSpeed<0))throw new TypeError('maxSpeed must be finite and >= 0');
    const nowMs=this.#now(), region=regionForPosition(zoneId,position,this.config.regionSize);
    const state={sessionId,entityId,zoneId,position:clonePosition(position),targetPosition:clonePosition(position),headingRaw,moving:false,speed:0,moveFlag:0,sequence:0,lastAcceptedAtMs:nowMs,lastMoveAtMs:null,lastReceiveSequence:null,teleportGeneration:0,transitionGeneration:0,connectionGeneration:++this.connectionGeneration,maxSpeed,worldReady:Boolean(worldReady),movementFrozen:false,region,lastBroadcastFingerprint:null,lastRotateFingerprint:null};
    this.sessions.set(sessionId,state);this.entityToSession.set(entityId,sessionId);this.#addRegionMember(region.key,sessionId);return freezeState(state);
  }

  restoreSession({sessionId,entityId,snapshot,worldReady=false,maxSpeed=undefined}){
    if(!snapshot||typeof snapshot!=='object')throw new TypeError('snapshot is required');
    const restored=this.registerSession({sessionId,entityId,zoneId:snapshot.zoneId,position:snapshot.position,headingRaw:snapshot.headingRaw,maxSpeed:maxSpeed===undefined?snapshot.maxSpeed??null:maxSpeed,worldReady});
    return restored;
  }
  createRestoreSnapshot(sessionId){const s=this.#requireState(sessionId);return immutable({entityId:s.entityId,zoneId:s.zoneId,position:freezePosition(s.position),headingRaw:s.headingRaw,maxSpeed:s.maxSpeed,serverSequence:s.sequence,teleportGeneration:s.teleportGeneration});}
  hasSession(sessionId){return this.sessions.has(sessionId);}
  getState(sessionId){const s=this.sessions.get(sessionId);return s?freezeState(s):null;}
  getPositionSnapshot(sessionId){const s=this.#requireState(sessionId);return this.#positionSnapshot(s);}
  getEntityPositionSnapshot(entityId){const sid=this.entityToSession.get(entityId);return sid===undefined?null:this.#positionSnapshot(this.#requireState(sid));}
  getDiagnostics(){
    let regionMemberships=0;for(const members of this.regionMembers.values())regionMemberships+=members.size;
    return immutable({sessions:this.sessions.size,entities:this.entityToSession.size,regionCells:this.regionMembers.size,regionMemberships,flood:this.floodGuard&&typeof this.floodGuard.diagnostics==='function'?this.floodGuard.diagnostics():null});
  }

  setWorldReady(sessionId,ready=true){const s=this.#requireState(sessionId);if(ready&&s.movementFrozen)throw new MovementRejectedError('zone_transition','cannot mark movement world-ready while a zone transition is frozen');s.worldReady=Boolean(ready);return freezeState(s);}
  beginZoneTransition(sessionId,{reason='zone-transition'}={}){const s=this.#requireState(sessionId);s.worldReady=false;s.movementFrozen=true;s.moving=false;s.speed=0;s.moveFlag=0;s.targetPosition=clonePosition(s.position);s.lastMoveAtMs=null;s.transitionGeneration+=1;s.sequence+=1;return immutable({reason,state:freezeState(s)});}
  completeZoneTransition(sessionId,{zoneId,position,headingRaw=null,reason='zone-transition-complete'}){const s=this.#requireState(sessionId);if(!s.movementFrozen)throw new MovementRejectedError('not_in_zone_transition','zone transition is not active');this.teleport(sessionId,{zoneId,position,headingRaw,reason});const internal=this.#requireState(sessionId);internal.movementFrozen=false;internal.worldReady=true;return freezeState(internal);}

  handleMovePacket(sessionId,payload,context={}){
    let decoded;try{decoded=decodeMovePayload(payload);}catch(error){if(error instanceof ProtocolError){this.#security(sessionId,'malformed',error.code,{});throw new MovementRejectedError(error.code,error.message);}throw error;}
    const fp=Buffer.from(payload).toString('hex');return this.handleMove(sessionId,decoded,{...context,fingerprint:`move:${fp}`});
  }
  handleMove(sessionId,move,context={}){
    const state=this.#requireMovableState(sessionId);const nowMs=this.#now();this.#checkReceiveOrder(state,context.receiveSequence);this.#checkFlood(sessionId,'move',nowMs);this.#validateMoveShape(move);this.#assertFiniteAndWirePosition(move.position);
    const fingerprint=context.fingerprint||`move:${move.rawX}:${move.rawZ}:${move.rawY}:${move.rawSpeed}:${move.flag}`;
    if(state.lastBroadcastFingerprint===fingerprint)return {accepted:true,deduplicated:true,phase:move.phase,recipients:[],packet:null,state:freezeState(state)};
    if(!this.zoneBounds.isValidPosition(state.zoneId,move.position)){this.#security(sessionId,'position','zone_bounds',{zoneId:state.zoneId});throw new MovementRejectedError('zone_bounds','movement target is outside zone bounds',{position:move.position});}
    const allowedMaxSpeed=this.#allowedMaxSpeed(state,move);if(move.speed>allowedMaxSpeed){this.#security(sessionId,'speed','speed_limit',{reportedSpeed:move.speed,allowedMaxSpeed});throw new MovementRejectedError('speed_limit','reported speed exceeds authoritative limit',{speed:move.speed,allowedMaxSpeed});}
    if(move.phase==='end'&&move.rawSpeed!==0)throw new MovementRejectedError('stop_with_speed','stop packet must report zero speed');if(move.moving&&move.rawSpeed===0)throw new MovementRejectedError('moving_with_zero_speed','moving packet must report non-zero speed');
    try{this.#validateMovementRange(state,move,nowMs);}catch(error){if(error instanceof MovementRejectedError){this.#security(sessionId,error.code==='vertical_range_limit'?'position':'range',error.code,error.details);}throw error;}
    this.#validateTerrain(state,move);
    const oldRegion=state.region;
    if(move.moving){state.position=clonePosition(state.targetPosition);state.targetPosition=clonePosition(move.position);state.moving=true;state.speed=move.speed;}else{state.position=clonePosition(move.position);state.targetPosition=clonePosition(move.position);state.moving=false;state.speed=0;}
    state.moveFlag=move.flag;state.sequence+=1;state.lastMoveAtMs=nowMs;state.lastAcceptedAtMs=nowMs;if(context.receiveSequence!==undefined)state.lastReceiveSequence=context.receiveSequence;state.lastBroadcastFingerprint=fingerprint;
    this.#updateRegionMembership(state,oldRegion,'movement');
    const packet=encodeMoveBroadcast(state.entityId,move),recipients=this.#visibleRecipients(state,sessionId);
    this.broadcast({kind:'move',zoneId:state.zoneId,senderSessionId:sessionId,recipients,packet,state:freezeState(state),phase:move.phase,serverSequence:state.sequence,acceptedAtMs:nowMs});
    return {accepted:true,deduplicated:false,phase:move.phase,recipients,packet,state:freezeState(state)};
  }

  handleRotatePacket(sessionId,payload,context={}){let decoded;try{decoded=decodeRotatePayload(payload);}catch(error){if(error instanceof ProtocolError){this.#security(sessionId,'malformed',error.code,{});throw new MovementRejectedError(error.code,error.message);}throw error;}return this.handleRotate(sessionId,decoded.headingRaw,{...context,fingerprint:`rotate:${Buffer.from(payload).toString('hex')}`});}
  handleRotate(sessionId,headingRaw,context={}){
    const state=this.#requireMovableState(sessionId),nowMs=this.#now();this.#checkReceiveOrder(state,context.receiveSequence);this.#checkFlood(sessionId,'rotate',nowMs);validateHeadingRaw(headingRaw);
    const fingerprint=context.fingerprint||`rotate:${headingRaw}`;if(state.lastRotateFingerprint===fingerprint)return {accepted:true,deduplicated:true,recipients:[],packet:null,state:freezeState(state)};
    state.headingRaw=headingRaw;state.sequence+=1;state.lastAcceptedAtMs=nowMs;if(context.receiveSequence!==undefined)state.lastReceiveSequence=context.receiveSequence;state.lastRotateFingerprint=fingerprint;
    const packet=encodeRotateBroadcast(state.entityId,headingRaw),recipients=this.#visibleRecipients(state,sessionId);
    this.broadcast({kind:'rotate',zoneId:state.zoneId,senderSessionId:sessionId,recipients,packet,state:freezeState(state),serverSequence:state.sequence,acceptedAtMs:nowMs});
    return {accepted:true,deduplicated:false,recipients,packet,state:freezeState(state)};
  }

  teleport(sessionId,{zoneId,position,headingRaw=null,reason='world-authorized'}){
    const state=this.#requireState(sessionId);if(!Number.isInteger(zoneId))throw new MovementRejectedError('invalid_zone','teleport zoneId must be an integer');this.#assertFiniteAndWirePosition(position);if(!this.zoneBounds.isValidPosition(zoneId,position))throw new MovementRejectedError('zone_bounds','teleport destination is outside zone bounds',{zoneId,position});if(headingRaw!==null)validateHeadingRaw(headingRaw,'teleport headingRaw');
    const previous=freezeState(state),oldRegion=state.region,nowMs=this.#now();state.zoneId=zoneId;state.position=clonePosition(position);state.targetPosition=clonePosition(position);if(headingRaw!==null)state.headingRaw=headingRaw;state.moving=false;state.speed=0;state.moveFlag=0;state.sequence+=1;state.lastMoveAtMs=null;state.lastAcceptedAtMs=nowMs;state.teleportGeneration+=1;state.lastBroadcastFingerprint=null;state.lastRotateFingerprint=null;this.#updateRegionMembership(state,oldRegion,'teleport');const next=freezeState(state);this.onTeleport({sessionId,reason,previous,state:next});return next;
  }
  signalSuspiciousTeleport(sessionId,metadata={}){this.#requireState(sessionId);this.#security(sessionId,'teleport','teleport_attempt',metadata);}

  getDistanceSnapshot(sourceSessionId,targetSessionId){const a=this.#requireState(sourceSessionId),b=this.#requireState(targetSessionId);return this.#distanceSnapshot(a,b);}
  getEntityDistanceSnapshot(sourceEntityId,targetEntityId){const a=this.getEntityPositionSnapshot(sourceEntityId),b=this.getEntityPositionSnapshot(targetEntityId);if(!a||!b)return null;return immutable({source:a,target:b,sameZone:a.zoneId===b.zoneId,horizontalDistance:a.zoneId===b.zoneId?horizontalDistance(a.position,b.position):Infinity,distance3D:a.zoneId===b.zoneId?distance3D(a.position,b.position):Infinity,serverSequence:Math.max(a.serverSequence,b.serverSequence)});}
  isWithinRange({sourceEntityId,targetEntityId,maxDistance,threeDimensional=false}){if(!Number.isFinite(maxDistance)||maxDistance<0)throw new TypeError('maxDistance must be finite and >= 0');const snap=this.getEntityDistanceSnapshot(sourceEntityId,targetEntityId);if(!snap)return {ok:false,reason:'ENTITY_NOT_FOUND',snapshot:null};if(!snap.sameZone)return {ok:false,reason:'OUT_OF_RANGE',snapshot:snap};const d=threeDimensional?snap.distance3D:snap.horizontalDistance;return {ok:d<=maxDistance,reason:d<=maxDistance?null:'OUT_OF_RANGE',snapshot:snap};}

  disconnect(sessionId){const state=this.sessions.get(sessionId);if(!state)return false;const snapshot=freezeState(state);this.sessions.delete(sessionId);this.entityToSession.delete(state.entityId);this.#removeRegionMember(state.region.key,sessionId);if(this.floodGuard&&typeof this.floodGuard.cleanup==='function')this.floodGuard.cleanup(sessionId);this.onDisconnect({sessionId,state:snapshot});return true;}

  #positionSnapshot(s){return immutable({sessionId:s.sessionId,entityId:s.entityId,zoneId:s.zoneId,position:freezePosition(s.position),targetPosition:freezePosition(s.targetPosition),headingRaw:s.headingRaw,headingYaw:headingRawToYaw(s.headingRaw),moving:s.moving,speed:s.speed,serverSequence:s.sequence,acceptedAtMs:s.lastAcceptedAtMs,teleportGeneration:s.teleportGeneration,transitionGeneration:s.transitionGeneration,region:immutable({...s.region})});}
  #distanceSnapshot(a,b){const source=this.#positionSnapshot(a),target=this.#positionSnapshot(b),sameZone=a.zoneId===b.zoneId;return immutable({source,target,sameZone,horizontalDistance:sameZone?horizontalDistance(a.position,b.position):Infinity,distance3D:sameZone?distance3D(a.position,b.position):Infinity,serverSequence:Math.max(a.sequence,b.sequence)});}
  #assertEntityAvailable(sessionId,entityId){if(!Number.isInteger(entityId)||entityId<0||entityId>0xffff)throw new RangeError('entityId must fit uint16');const owner=this.entityToSession.get(entityId);if(owner!==undefined&&owner!==sessionId)throw new MovementRejectedError('entity_in_use','entityId is already bound to another movement session',{entityId,owner});}
  #requireState(sessionId){const s=this.sessions.get(sessionId);if(!s)throw new MovementRejectedError('unknown_session','movement session is not registered');return s;}
  #requireMovableState(sessionId){const s=this.#requireState(sessionId);if(!s.worldReady)throw new MovementRejectedError('world_not_ready','movement is not allowed before WORLD_READY');if(s.movementFrozen)throw new MovementRejectedError('zone_transition','movement is frozen during zone transition');return s;}
  #now(){const v=Number(this.clock());if(!Number.isFinite(v)||v<0)throw new Error('clock must return a finite non-negative millisecond timestamp');return v;}
  #checkFlood(sessionId,kind,nowMs){if(!this.floodGuard||typeof this.floodGuard.check!=='function')return;const r=this.floodGuard.check({sessionId,kind,nowMs});if(r===false||(r&&r.allow===false)){this.#security(sessionId,'flood','packet_flood',{kind,count:r?.event?.count});throw new MovementRejectedError('packet_flood',r?.reason||'packet flood rejected',r?.event||{});}}
  #checkReceiveOrder(state,receiveSequence){if(receiveSequence===undefined||receiveSequence===null)return;if(!Number.isSafeInteger(receiveSequence)||receiveSequence<0)throw new MovementRejectedError('invalid_receive_sequence','receiveSequence must be a non-negative safe integer');if(state.lastReceiveSequence!==null&&receiveSequence<=state.lastReceiveSequence){this.#security(state.sessionId,'order','out_of_order',{receiveSequence,lastReceiveSequence:state.lastReceiveSequence});throw new MovementRejectedError('out_of_order','movement packet receive order is stale or duplicated',{receiveSequence,lastReceiveSequence:state.lastReceiveSequence});}}
  #allowedMaxSpeed(state,move){let limit=state.maxSpeed;if(this.speedPolicy){const dynamic=typeof this.speedPolicy==='function'?this.speedPolicy(freezeState(state),move):this.speedPolicy.getMaxSpeed({state:freezeState(state),move});if(!Number.isFinite(dynamic)||dynamic<0)throw new Error('speedPolicy must return a finite non-negative speed');limit=limit===null?dynamic:Math.min(limit,dynamic);}if(limit===null)limit=this.config.absoluteMaxSpeed;return Math.min(limit,this.config.absoluteMaxSpeed);}
  #validateMoveShape(move){if(!move||typeof move!=='object')throw new MovementRejectedError('invalid_move','move must be an object');for(const [key,min,max] of [['rawX',0,0xffff],['rawZ',0,0xffff],['rawY',-0x8000,0x7fff],['rawSpeed',0,0xffff],['flag',0,0xff]])if(!Number.isInteger(move[key])||move[key]<min||move[key]>max)throw new MovementRejectedError('integer_overflow',`${key} is outside its 1298 wire range`);let c;try{c=classifyMoveFlag(move.flag);}catch(error){if(error instanceof ProtocolError)throw new MovementRejectedError(error.code,error.message);throw error;}if(!Number.isFinite(move.speed)||move.speed<0)throw new MovementRejectedError('invalid_speed','speed must be finite and non-negative');if(move.phase!==c.phase||move.moving!==c.moving||Boolean(move.continuous)!==c.continuous)throw new MovementRejectedError('invalid_phase','movement metadata is inconsistent with the wire flag');if(!isFinitePosition(move.position))throw new MovementRejectedError('non_finite_coordinate','position contains NaN or Infinity');const e=1e-9;if(Math.abs(move.position.x-move.rawX/10)>e||Math.abs(move.position.z-move.rawZ/10)>e||Math.abs(move.position.y-move.rawY/10)>e)throw new MovementRejectedError('wire_position_mismatch','decoded position does not match raw 1298 coordinates');if(Math.abs(move.speed-move.rawSpeed/10)>e)throw new MovementRejectedError('wire_speed_mismatch','decoded speed does not match raw 1298 speed');}
  #validateConfig(){for(const key of ['absoluteMaxSpeed','speedToleranceMultiplier','positionSlack','startPredictionSeconds','stopPredictionSeconds','networkGraceSeconds','maxUpdateGapSeconds','maxVerticalDeltaPerPacket','regionSize']){const v=this.config[key];if(!Number.isFinite(v)||v<0)throw new TypeError(`config.${key} must be finite and non-negative`);}if(this.config.speedToleranceMultiplier===0||this.config.regionSize===0)throw new TypeError('speedToleranceMultiplier and regionSize must be > 0');if(!Number.isInteger(this.config.visibilityRegionRadius)||this.config.visibilityRegionRadius<0)throw new TypeError('config.visibilityRegionRadius must be a non-negative integer');if(typeof this.config.includeSenderInBroadcast!=='boolean')throw new TypeError('config.includeSenderInBroadcast must be boolean');}
  #assertFiniteAndWirePosition(p){if(!isFinitePosition(p))throw new MovementRejectedError('non_finite_coordinate','position contains NaN or Infinity');const rx=p.x*10,rz=p.z*10,ry=p.y*10;if(!Number.isSafeInteger(rx)||!Number.isSafeInteger(rz)||!Number.isSafeInteger(ry)||rx<0||rx>0xffff||rz<0||rz>0xffff||ry<-0x8000||ry>0x7fff)throw new MovementRejectedError('coordinate_overflow','position cannot be represented exactly by the 1298 movement packet');}
  #validateMovementRange(state,move,nowMs){const elapsed=state.lastMoveAtMs===null?0:Math.max(0,Math.min((nowMs-state.lastMoveAtMs)/1000,this.config.maxUpdateGapSeconds));let anchor,budgetSeconds;if(move.phase==='start'){anchor=state.position;budgetSeconds=this.config.startPredictionSeconds+this.config.networkGraceSeconds;}else if(move.phase==='update'){anchor=state.targetPosition;budgetSeconds=elapsed+this.config.networkGraceSeconds;}else{const dc=horizontalDistance(state.position,move.position),dt=horizontalDistance(state.targetPosition,move.position),budget=state.speed*(this.config.stopPredictionSeconds+elapsed+this.config.networkGraceSeconds)*this.config.speedToleranceMultiplier+this.config.positionSlack;if(Math.min(dc,dt)>budget)throw new MovementRejectedError('range_limit','stop position is outside the accepted movement envelope',{distanceToCurrent:dc,distanceToTarget:dt,allowedDistance:budget});const vd=Math.min(Math.abs(move.position.y-state.position.y),Math.abs(move.position.y-state.targetPosition.y));if(vd>this.config.maxVerticalDeltaPerPacket)throw new MovementRejectedError('vertical_range_limit','vertical displacement is too large',{verticalDelta:vd});return;}const distance=horizontalDistance(anchor,move.position),allowed=move.speed*budgetSeconds*this.config.speedToleranceMultiplier+this.config.positionSlack;if(distance>allowed)throw new MovementRejectedError('range_limit','movement target is outside the accepted speed/range envelope',{distance,allowedDistance:allowed,elapsedSeconds:elapsed,phase:move.phase});const vd=Math.abs(move.position.y-anchor.y);if(vd>this.config.maxVerticalDeltaPerPacket)throw new MovementRejectedError('vertical_range_limit','vertical displacement is too large',{verticalDelta:vd});}
  #validateTerrain(state,move){if(!this.terrainAuthority)return;const result=this.terrainAuthority.validateMovement({zoneId:state.zoneId,from:freezePosition(state.position),to:freezePosition(move.position),state:freezeState(state),phase:move.phase});if(result===false||(result&&result.ok===false))throw new MovementRejectedError('terrain_rejected',result?.reason||'authoritative terrain/collision provider rejected movement',result?.details||{});}
  #addRegionMember(key,sid){let set=this.regionMembers.get(key);if(!set){set=new Set();this.regionMembers.set(key,set);}set.add(sid);}
  #removeRegionMember(key,sid){const set=this.regionMembers.get(key);if(!set)return;set.delete(sid);if(set.size===0)this.regionMembers.delete(key);}
  #updateRegionMembership(state,oldRegion,reason){const next=regionForPosition(state.zoneId,state.position,this.config.regionSize);if(oldRegion&&oldRegion.key===next.key){state.region=next;return;}if(oldRegion)this.#removeRegionMember(oldRegion.key,state.sessionId);this.#addRegionMember(next.key,state.sessionId);state.region=next;this.onRegionMembership({sessionId:state.sessionId,entityId:state.entityId,reason,leave:oldRegion?immutable({...oldRegion}):null,enter:immutable({...next}),state:freezeState(state)});}
  #visibleRecipients(state,senderSessionId){const ids=new Set();for(const key of neighboringRegionKeys(state.region,this.config.visibilityRegionRadius)){const members=this.regionMembers.get(key);if(!members)continue;for(const sid of members){const other=this.sessions.get(sid);if(!other||other.zoneId!==state.zoneId||!other.worldReady||other.movementFrozen)continue;if(!this.config.includeSenderInBroadcast&&sid===senderSessionId)continue;ids.add(sid);}}return Array.from(ids).sort(stableSessionCompare);}
  #security(sessionId,category,code,evidence){const state=this.sessions.get(sessionId);const clean={category,code,...evidence};const type=category==='malformed'?'repeated_malformed_packet_metadata':category==='position'?'repeated_invalid_position':'impossible_movement';this.onSecuritySignal({type,sessionId,source:'ko1298-movement',entityId:state?.entityId??null,zoneId:state?.zoneId??null,serverSequence:state?.sequence??null,evidence:{reasonCode:code,...clean}});}
}

module.exports={DEFAULT_CONFIG,MovementRejectedError,MovementService,horizontalDistance,distance3D};
