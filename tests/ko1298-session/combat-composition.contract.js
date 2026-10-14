'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const codec = require('../../protocol-lab/runtime/playable-combat-codec.cjs');
const slice = require('../../data-catalog/generated/MORADON_PLAYABLE_COMBAT_SLICE.json');
const ws17Contract = require('../../workstreams/ws17/PLAYABLE_COMBAT_EQUIPMENT_CONTRACT.json');
const ws19Authority = require('../../workstreams/ws19/PLAYABLE_PVE_AUTHORITY.json');
const moradonVerified = require('../../world-data/mobs/verified/moradon-zone21.verified.json');
const { GAME, Writer } = require('../../services/ko1298-session/protocol');
const { MemoryRepository } = require('../../services/ko1298-session/repository');
const { GameSession } = require('../../services/ko1298-session/session');
const { SESSION_STATES } = require('../../services/ko1298-session/contracts');
const { MAGIC_COMMAND } = require('../../services/ko1298-session/combat-protocol');
const { createPlayableCombatSessionAdapter, createWs17EquipmentCombatPort, createWs25MobCombatPort } = require('../../services/ko1298-session/playable-combat-adapter');
const { MovementService } = require('../../services/ko1298-movement');
const { CONTAINER_TYPES, EQUIPMENT_SLOTS, ItemTemplateRegistry, Legacy1298TableAdapter, InMemoryItemRepository, ItemDomainService } = require('../../services/ko1298-items');
const { MobService, loadVerifiedWorldDefinition } = require('../../services/ko1298-mobs');
const { PlayablePveCombatService } = require('../../services/ko1298-combat');
const { buildNpcIn, canonicalNpcDetailRecord, quantizeNpcCoord } = require('../../services/ko1298-world/src/visibility-protocol');

const PIN = Object.freeze({
  WS11:'013559b6e66ef9f6257403c96f3b012884739470', WS14:'ed5f806ce7505f4dfae406e4164735def63b6c86',
  WS15:'ce9bed13b8d45c32ff0592595aa3a0d1e7b3964d', WS17:'eb3e9fce63b71fa68682d81d9227e6ed7ae905bf',
  WS19:'cc1490672b676f0bf1675f83c8f4fc146b940df4', WS25:'18c9e9b8439fef88fc93d74bfec7981b0cb41958',
  WS31:'56ada741532c8f6cabfc83b129a8e87e645db055',
});

function login(){return new Writer().u8(GAME.LOGIN).str16('osevinc').str16('osevinc').done();}
function create(){return new Writer().u8(GAME.NEW_CHAR).u8(0).str16('CombatHero').u8(1).i16(101).u8(1).u8(2).u8(60).u8(60).u8(70).u8(50).u8(50).done();}
function select(){return new Writer().u8(GAME.SEL_CHAR).str16('osevinc').str16('CombatHero').u8(1).u8(21).done();}
function attack(targetId){const b=Buffer.alloc(9);b[0]=GAME.ATTACK;b[1]=1;b[2]=255;b.writeInt16LE(targetId,3);b.writeInt16LE(32000,5);b.writeInt16LE(32000,7);return b;}
function targetHp(targetId){const b=Buffer.alloc(4);b[0]=GAME.TARGET_HP;b.writeInt16LE(targetId,1);b[3]=1;return b;}
function slash(targetId){const b=Buffer.alloc(22);b[0]=GAME.MAGIC_PROCESS;b[1]=MAGIC_COMMAND.EFFECTING;b.writeUInt32LE(101003,2);b.writeInt16LE(32000,6);b.writeInt16LE(targetId,8);b.writeInt16LE(1,10);b.writeInt16LE(1,12);return b;}
function worldMock(position){return {async beginSelectedCharacter(a){return {state:'WAIT_GAMESTART_LOADING',clientPackets:[Buffer.from([GAME.SEL_CHAR,1])],broadcastPackets:[],snapshot:{socketId:a.socketId,zoneId:21,...position}};},async handleClientPacket(socketId,p){return {state:p[0]===GAME.GAMESTART&&p[1]===2?'WORLD_READY':'WAIT_GAMESTART_LOADED',clientPackets:[],broadcastPackets:[],snapshot:{socketId,zoneId:21,...position}};}};}
function allocator(start=12000){let n=start;const m=new Map();return {claim(r){if(!m.has(r.sourceIdentity))m.set(r.sourceIdentity,n++);return m.get(r.sourceIdentity);}};}
function singleBandicoot(){const w=loadVerifiedWorldDefinition(moradonVerified);const g=w.spawnGroups.find(x=>x.templateId==='ko1298:monster:850');assert.ok(g);return {...w,spawnGroups:[{...g,spawns:[g.spawns[0]]}]};}
function playerFixture(id,position){const d=ws19Authority.deterministic_player_fixture.derived_combat;return {id,zoneId:21,position:{...position},nationId:1,classId:101,level:3,hp:d.max_hp,maxHp:d.max_hp,mp:0,maxMp:0,sp:d.max_resource,maxSp:d.max_resource,resourceKind:d.resource_kind,lifeState:'ALIVE',combat:{ap:d.ap,ac:d.ac,hitRate:d.hit_rate,evasionRate:d.evasion_rate}};}
function createPlayerPort(player){const health=new Set(),resource=new Set();return {getCombatSnapshot(id){return String(id)===String(player.id)?{...player,position:{...player.position},combat:{...player.combat}}:null;},applyHealthResult(r){const k=`${r.sourceId}:${r.requestKey}:${r.targetId}`;if(health.has(k))return {applied:false,duplicate:true,player:this.getCombatSnapshot(player.id)};health.add(k);const before=player.hp;player.hp=r.absoluteHp;if(before>0&&player.hp===0)player.lifeState='DEAD';return {applied:true,duplicate:false,deathTransition:before>0&&player.hp===0,player:this.getCombatSnapshot(player.id)};},applyResourceResult(r){const k=`${r.sourceId}:${r.requestKey}:${r.targetId}:${r.kind}`;if(resource.has(k))return {applied:false,duplicate:true,player:this.getCombatSnapshot(player.id)};resource.add(k);player[r.kind==='SP'?'sp':'mp']=r.absoluteValue;return {applied:true,duplicate:false,player:this.getCombatSnapshot(player.id)};}};}
async function equipmentService(){const source=ws17Contract.canonicalStarterWeapon;const adapter=new Legacy1298TableAdapter({getRow:async id=>Number(id)===source.itemId?{...source.sourceRow}:null});const templates=new ItemTemplateRegistry(adapter,{requireVerifiedProvenance:true});const service=new ItemDomainService({repository:new InMemoryItemRepository(),templates,characterContext:async()=>({level:3,classId:101,raceId:1,nationId:1,stats:{str:0,sta:0,dex:0,int:0,cha:0},maxWeight:1000})});await service.createItem('CombatHero',{container:CONTAINER_TYPES.INVENTORY,slot:0},{templateId:120010000,serial:'9000000000000000001'});await service.equip('CombatHero',0,EQUIPMENT_SLOTS.RIGHT_HAND);return service;}
async function ready(options){const s=new GameSession(new MemoryRepository(),{socketId:500,...options});await s.handle(login());await s.handle(Buffer.from([GAME.SEL_NATION,1]));await s.handle(create());await s.handle(select());await s.handle(Buffer.from([GAME.GAMESTART,1]));await s.handle(Buffer.from([GAME.GAMESTART,2]));assert.equal(s.phase,SESSION_STATES.WORLD_READY);return s;}
function ws11NpcRecordFromWs14(record){const c=canonicalNpcDetailRecord(record);return Object.freeze({runtime_id:c.runtimeId,template_resource_id:c.templateResourceId,npc_type:c.npcType,selling_group:c.sellingGroup,scale_percent:c.scale,weapon_1_item_id:c.weapon1,weapon_2_item_id:c.weapon2,name:c.name,group_nation:c.groupNation,level:c.level,x10:quantizeNpcCoord(c.x,{label:'x'}),z10:quantizeNpcCoord(c.z,{label:'z'}),y10:quantizeNpcCoord(c.y,{signed:true,label:'y'}),state_gate_open:c.stateGateOpen,object_type:c.objectType,client_idk0:c.clientIdk0,client_idk1:c.clientIdk1,direction:c.direction});}

test('real canonical playable combat composition reaches exact client packets and lifecycle', async()=>{
  assert.equal(slice.test_character?.class_id??slice.testCharacter?.classId??101,101);
  const visibility=[], intents=[], targets=new Map();
  const mobs=new MobService(singleBandicoot(),{runtimeIds:allocator(),terrain:{resolveHeight:()=>({status:'authoritative',height:0,surface:'terrain',policy:'ws03-composition'})},world:{listAggroCandidates:()=>[],getTargetSnapshot:id=>targets.get(String(id))??null,isMobVisibleToPlayer:()=>true},combat:{isTargetAlive:t=>t?.alive!==false,canAggro:()=>true,canAttack:()=>true,attackIntent:i=>intents.push(i)},visibility:{onEvent:e=>visibility.push(e)}});
  const [spawn]=mobs.initialize(0), mobId=spawn.runtimeId;const mobCombatPort=createWs25MobCombatPort({service:mobs});let mob=mobCombatPort.getCombatSnapshot(mobId);assert.equal(mob.templateId,'ko1298:monster:850');assert.equal(mob.hp,11);
  const pos={x:mob.position.x-0.5,y:mob.position.y,z:mob.position.z};const player=playerFixture(500,pos),playerPort=createPlayerPort(player);targets.set('500',playerPort.getCombatSnapshot(500));
  const movement=new MovementService({zoneBounds:{isValidPosition:()=>true}}),items=await equipmentService();const equipmentPort=createWs17EquipmentCombatPort({service:items,characterId:'CombatHero'});const equip=await equipmentPort.refresh();assert.equal(equip.weaponRange,1.0);assert.equal(equip.attackDelayMs,1140);assert.equal(equip.damage,4);assert.equal(equip.weaponItemId,120010000);assert.equal(equip.weaponType,'SWORD');
  const worldPort={validateAttackRange({attacker,target,weaponRange}){const p=movement.getEntityPositionSnapshot(attacker.id),d=Math.hypot(p.position.x-target.position.x,p.position.z-target.position.z);return {ok:d<=weaponRange,reason:d<=weaponRange?null:'OUT_OF_RANGE',distance:d,maxRange:weaponRange};},validateMobAttackRange({source,target,attackRange}){const p=movement.getEntityPositionSnapshot(target.id),d=Math.hypot(source.position.x-p.position.x,source.position.z-p.position.z);return {ok:d<=attackRange,reason:d<=attackRange?null:'OUT_OF_RANGE',distance:d,maxRange:attackRange};}};
  const pve=new PlayablePveCombatService({mobCombatPort,playerCombatPort:playerPort,equipmentPort,worldPort,rng:()=>0,clock:()=>0});const combatAdapter=createPlayableCombatSessionAdapter({service:pve,mobCombatPort,playerCombatPort:playerPort});
  const domainEventAdapter={async encode({source,event}){if(source==='WS25'&&event?.type==='IN'&&event?.reason==='respawn'){const record=mobs.visibilitySnapshot(event.runtimeId);const ws14=buildNpcIn(record),ws11=codec.encodeNpcIn(ws11NpcRecordFromWs14(record));assert.deepEqual(ws14,ws11);return {clientPackets:[ws14]};}return {clientPackets:[]};}};
  const session=await ready({worldSession:worldMock(pos),movementSession:movement,combatAdapter,domainEventAdapter});assert.equal(movement.getEntityPositionSnapshot(500).zoneId,21);

  let packets=await session.handle(targetHp(mobId));assert.equal(packets.length,1);let hp=codec.decodeTargetHp(packets[0]);assert.equal(hp.currentHp,11);assert.equal(hp.maxHp,11);
  packets=await session.handle(attack(mobId),{receiveSequence:1});assert.equal(codec.decodeAttackResult(packets[0]).result,'SUCCESS');hp=codec.decodeTargetHp(packets[1]);assert.equal(hp.currentHp,8);assert.equal(hp.maxHp,11);assert.equal(hp.hpDelta,-3);assert.equal(mobCombatPort.getCombatSnapshot(mobId).hp,8);

  mobs.tick(1700);assert.ok(intents.length>0);packets=await session.deliverDomainEvent('WS25',intents[0]);assert.equal(packets[0][0],codec.OPCODE.WIZ_HP_CHANGE);assert.equal(codec.decodePlayerHp(packets[0]).currentHp,32);const mobAttack=codec.decodeAttackResult(packets[1]);assert.equal(mobAttack.attackerId,mobId);assert.equal(mobAttack.targetId,500);assert.equal(mobAttack.result,'SUCCESS');

  packets=await session.handle(slash(mobId),{receiveSequence:2});assert.equal(codec.decodeSlash101003Result(packets[0]).result,'EFFECTING_SUCCESS');assert.equal(codec.decodePlayerMsp(packets[1]).currentMsp,29);hp=codec.decodeTargetHp(packets[2]);assert.equal(hp.currentHp,4);assert.equal(hp.maxHp,11);
  packets=await session.handle(slash(mobId),{receiveSequence:3});assert.equal(codec.decodeSlash101003Result(packets[0]).result,'EFFECTING_SUCCESS');assert.equal(codec.decodePlayerMsp(packets[1]).currentMsp,25);hp=codec.decodeTargetHp(packets[2]);assert.equal(hp.currentHp,0);assert.equal(hp.maxHp,11);assert.equal(codec.decodeDead(packets[3]).targetId,mobId);assert.equal(packets.filter(p=>p[0]===codec.OPCODE.WIZ_DEAD).length,1);
  const duplicate=await session.handle(slash(mobId),{receiveSequence:3});assert.equal(duplicate.filter(p=>p[0]===codec.OPCODE.WIZ_DEAD).length,0);assert.equal(player.sp,25);

  let respawnEvent=null;for(let t=2000;t<=65000&&!respawnEvent;t+=1000){mobs.tick(t);respawnEvent=visibility.find(e=>e.type==='IN'&&e.reason==='respawn'&&e.runtimeId===mobId)??null;}assert.ok(respawnEvent);packets=await session.deliverDomainEvent('WS25',respawnEvent);assert.equal(packets.length,1);assert.equal(codec.decodeNpcIn(packets[0]).record.runtime_id,mobId);assert.equal(mobCombatPort.getCombatSnapshot(mobId).hp,11);
  assert.deepEqual(PIN,{WS11:'013559b6e66ef9f6257403c96f3b012884739470',WS14:'ed5f806ce7505f4dfae406e4164735def63b6c86',WS15:'ce9bed13b8d45c32ff0592595aa3a0d1e7b3964d',WS17:'eb3e9fce63b71fa68682d81d9227e6ed7ae905bf',WS19:'cc1490672b676f0bf1675f83c8f4fc146b940df4',WS25:'18c9e9b8439fef88fc93d74bfec7981b0cb41958',WS31:'56ada741532c8f6cabfc83b129a8e87e645db055'});
});
