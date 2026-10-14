#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const required = ['WS03_ROOT','WS14_ROOT','WS15_ROOT','WS16_ROOT','WS25_ROOT','WS14_MORADON_SMD','WS16_NPC_DATA','WS25_MOB_DATA'];
for (const key of required) if (!process.env[key]) throw new Error(`${key} is required`);

const ws03Root=process.env.WS03_ROOT, ws14Root=process.env.WS14_ROOT, ws15Root=process.env.WS15_ROOT;
const ws16Root=process.env.WS16_ROOT, ws25Root=process.env.WS25_ROOT;
const protocol=require(path.resolve(ws03Root,'services/ko1298-session/protocol.js'));
const {AuthSession,GameSession}=require(path.resolve(ws03Root,'services/ko1298-session/session.js'));
const worldApi=require(path.resolve(ws14Root,'services/ko1298-world/index.js'));
const movementApi=require(path.resolve(ws15Root,'services/ko1298-movement/src/index.js'));
const ws16=require(path.resolve(ws16Root,'services/ko1298-npc'));
const ws25=require(path.resolve(ws25Root,'services/ko1298-mobs'));
const {WorldSessionService,createMoradonHeightResolver,createSharedNpcRuntimeIdNamespace}=worldApi;
const {MovementService,StaticZoneBounds}=movementApi;
const {FrameDecoder,frame,CHARACTER_SLOT_COUNT}=protocol;

const username=process.env.WS05_TEST_ID||'ws05e2e';
const password=process.env.WS05_TEST_PW||'ws05pass';
const authPort=Number(process.env.AUTH_TCP_PORT||16100);
const gamePort=Number(process.env.GAME_TCP_PORT||16101);
const resolver=createMoradonHeightResolver({smdPath:process.env.WS14_MORADON_SMD});

const npcDocument=JSON.parse(fs.readFileSync(process.env.WS16_NPC_DATA,'utf8'));
const npcPopulation=ws16.materializeNpcPopulation(npcDocument,{heightAuthority:resolver});
const npcWorld=new ws16.NpcWorld();
for(const record of npcPopulation.records) npcWorld.add(record);

const runtimeNamespace=createSharedNpcRuntimeIdNamespace({
  minInclusive:ws25.RUNTIME_ID_CONTRACT.NPC_BAND,
  maxExclusive:ws25.RUNTIME_ID_CONTRACT.INVALID_BAND,
  reserved:npcPopulation.records,
});
const mobDocument=JSON.parse(fs.readFileSync(process.env.WS25_MOB_DATA,'utf8'));
const mobDefinition=ws25.loadVerifiedWorldDefinition(mobDocument);
const mobService=new ws25.MobVisibilityService(mobDefinition,{
  terrain:{resolveHeight(zoneId,x,z){return resolver.resolveHeight(Number(zoneId),x,z);}},
  runtimeIds:runtimeNamespace,
});
const mobPopulation=mobService.initialize(0);
if(npcPopulation.records.length!==37) throw new Error(`expected 37 Moradon NPCs, got ${npcPopulation.records.length}`);
if(mobPopulation.length!==135) throw new Error(`expected 135 Moradon mobs, got ${mobPopulation.length}`);

const runtimeIdOf=(r)=>r?.runtimeId??r?.instanceId??r?.nid??r?.id;
const posOf=(r)=>r?.position||r?.detailRecord?.position||r;
const pidOf=(r)=>r?.pid??r?.templateResourceId??r?.detail?.pid??r?.detailRecord?.templateResourceId??0;
const sidOf=(r)=>r?.templateId??r?.detail?.template_id??r?.detailRecord?.templateId??0;
const nameOf=(r)=>r?.name??r?.detail?.name??r?.detailRecord?.name??'unknown';

const npcIdSet=new Set(npcPopulation.records.map(runtimeIdOf));
const mobIdSet=new Set(mobPopulation.map(runtimeIdOf));
for(const id of npcIdSet) if(mobIdSet.has(id)) throw new Error(`runtime ID collision ${id}`);

const bandicoots=mobPopulation.filter((m)=>sidOf(m)===850 && pidOf(m)===800);
if(!bandicoots.length) throw new Error('no authoritative Bandicoot SID=850 PID=800 runtime records');
console.log(`WS05_AUTH spawn_source=WS14_DEFAULT x=312 y=0 z=402 fake_teleport=0 npc_total=${npcPopulation.records.length} mob_total=${mobPopulation.length}`);
for(const m of bandicoots){
  const p=posOf(m);
  console.log(`WS05_AUTH type=bandicoot id=${runtimeIdOf(m)} sid=850 pid=800 x=${p.x} y=${p.y} z=${p.z} name=${JSON.stringify(nameOf(m))}`);
}

function combinedNearby(zoneId,x,z){
  if(Number(zoneId)!==21) return [];
  const npcs=npcWorld.nearby(21,x,z);
  const mobs=mobService.getNearby({zoneId:21,x,z});
  return [...npcs,...mobs];
}
const spawnNearby=combinedNearby(21,312,402);
for(const n of spawnNearby.filter((r)=>npcIdSet.has(runtimeIdOf(r)))){
  console.log(`WS05_AUTH type=npc id=${runtimeIdOf(n)} pid=${pidOf(n)} x=${posOf(n).x} y=${posOf(n).y} z=${posOf(n).z} name=${JSON.stringify(nameOf(n))}`);
}

function clone(v){return v==null?v:structuredClone(v);}
function worldCharacter(accountId,spec){
  return {
    accountId,characterId:spec.name,slot:spec.slot,nation:repo.getNation(accountId),
    race:spec.race,classId:spec.classId,level:1,face:spec.face,hair:spec.hair,zone:21,
    equipment:{},rank:0,title:0,points:0,maxExp:100,exp:0,loyalty:0,monthlyLoyalty:0,city:0,
    knightsId:0,fame:0,clan:null,maxHp:120,hp:120,maxMp:80,mp:80,maxWeight:2500,itemWeight:0,
    str:spec.str,itemStr:0,sta:spec.sta,itemSta:0,dex:spec.dex,itemDex:0,intel:spec.intel,itemIntel:0,
    cha:spec.magicAttack,itemCha:0,totalHit:10,totalAc:5,fireRes:0,coldRes:0,lightningRes:0,
    magicRes:0,diseaseRes:0,poisonRes:0,gold:0,authority:1,knightsRank:0,personalRank:0,
    skills:Array(9).fill(0),protocolItems:[],visibleEquipment:[],accountStatus:0,premiumType:0,premiumTime:0,
    isChicken:false,mannerPoint:0,resHpType:1,abnormalType:1,needParty:1,isPartyLeader:false,
    invisibilityState:0,direction:0,
    stats:{str:spec.str,sta:spec.sta,dex:spec.dex,intel:spec.intel,magicAttack:spec.magicAttack},
  };
}
const repo={
  accounts:new Map([[username,{password,nation:0,characters:Array(CHARACTER_SLOT_COUNT).fill(null)}]]),
  authenticate(id,pw){const a=this.accounts.get(id);return Boolean(a&&a.password===pw);},
  getNation(id){return this.accounts.get(id)?.nation??0;},
  setNation(id,nation){const a=this.accounts.get(id);if(!a)return false;a.nation=nation;return true;},
  listCharacters(id){return (this.accounts.get(id)?.characters||[]).map(clone);},
  createCharacter(id,spec){
    const a=this.accounts.get(id);if(!a||![1,2].includes(a.nation))return{ok:false,code:1};
    if(!Number.isInteger(spec.slot)||spec.slot<0||spec.slot>=CHARACTER_SLOT_COUNT||a.characters[spec.slot])return{ok:false,code:1};
    if(!spec.name||Buffer.byteLength(spec.name,'latin1')>20)return{ok:false,code:1};
    for(const other of this.accounts.values())if(other.characters.some((c)=>c?.characterId===spec.name))return{ok:false,code:1};
    const character=worldCharacter(id,spec);a.characters[spec.slot]=character;
    console.log(`WS05_COMPOSE event=character-created slot=${spec.slot} name=${spec.name}`);
    return{ok:true,code:0,character:clone(character)};
  },
  getCharacter(id,characterId){return clone(this.accounts.get(id)?.characters.find((c)=>c?.characterId===characterId)||null);},
  async getCharacterForWorld(id,characterId){return this.getCharacter(id,characterId);},
  async getSurroundingUsers(){return[];},
  async getSurroundingNpcs({zoneId,x,z}){return combinedNearby(zoneId,x,z);},
};

const worldSession=new WorldSessionService({repository:repo});
const movementSession=new MovementService({
  zoneBounds:new StaticZoneBounds({21:{minX:0,maxX:6553.5,minY:-3276.8,maxY:3276.7,minZ:0,maxZ:6553.5}}),
  config:{absoluteMaxSpeed:50,speedToleranceMultiplier:1.5,positionSlack:2,startPredictionSeconds:2,stopPredictionSeconds:2,networkGraceSeconds:0.5},
});
let nextSocketId=1;

function parseRequestedIds(payload){
  if(!payload||payload[0]!==0x1d||payload.length<3)return[];
  const count=payload.readUInt16LE(1);if(payload.length!==3+count*2)return[];
  const ids=[];for(let i=0;i<count;i++)ids.push(payload.readUInt16LE(3+i*2));return ids;
}
function classify(ids){return{
  npc:ids.filter((id)=>npcIdSet.has(id)),
  mob:ids.filter((id)=>mobIdSet.has(id)),
  bandicoot:ids.filter((id)=>bandicoots.some((b)=>runtimeIdOf(b)===id)),
  unknown:ids.filter((id)=>!npcIdSet.has(id)&&!mobIdSet.has(id)),
};}
function regionKey(p){return `${Math.floor(p.x/48)}:${Math.floor(p.z/48)}`;}
function currentPosition(session){
  const state=movementSession.getState(session.sessionId);
  if(state) return state.targetPosition||state.position;
  const world=worldSession.getSession(session.socketId);
  return world?{x:world.x,y:world.y,z:world.z}:{x:312,y:0,z:402};
}

function listen(port,kind){
  const server=net.createServer((socket)=>{
    const socketId=kind==='game'?nextSocketId++:0;
    const session=kind==='auth'
      ? new AuthSession(repo,{gameHost:'127.0.0.1',gameName:'OldKO'})
      : new GameSession(repo,{
          worldSession,movementSession,socketId,
          onWorldBroadcast:({packet,snapshot})=>console.log(`WS05_COMPOSE event=world-broadcast opcode=0x${packet[0].toString(16).padStart(2,'0')} state=${snapshot?.state||'unknown'}`),
          onGameplayBroadcast:({owner,packet})=>console.log(`WS05_COMPOSE event=gameplay-broadcast owner=${owner} opcode=0x${packet[0].toString(16).padStart(2,'0')}`),
        });
    const decoder=new FrameDecoder();let queue=Promise.resolve(),lastRegion=null;
    console.log(`WS05_COMPOSE event=${kind}-connected socketId=${socketId}`);
    socket.on('data',(chunk)=>{
      queue=queue.then(async()=>{
        for(const payload of decoder.push(chunk)){
          console.log(`WS05_COMPOSE event=${kind}-rx opcode=0x${payload[0].toString(16).padStart(2,'0')} bytes=${payload.length}`);
          if(kind==='game'&&payload[0]===0x1d){
            const ids=parseRequestedIds(payload),c=classify(ids),p=currentPosition(session);
            const visible=combinedNearby(21,p.x,p.z),map=new Map(visible.map((r)=>[runtimeIdOf(r),r]));
            const records=ids.map((id)=>map.get(id)).filter(Boolean);
            console.log(`WS05_AUTH event=client-detail-request ids=${ids.join(',')} npc=${c.npc.join(',')} mob=${c.mob.join(',')} bandicoot=${c.bandicoot.join(',')} visible_response=${records.length}`);
            const response=worldApi.buildSurroundingNpcs(records);
            socket.write(frame(response));
            console.log(`WS05_COMPOSE event=game-tx opcode=0x1d bytes=${response.length}`);
            continue;
          }
          const responses=await session.handle(payload);
          for(const response of responses){
            console.log(`WS05_COMPOSE event=${kind}-tx opcode=0x${response[0].toString(16).padStart(2,'0')} bytes=${response.length}`);
            socket.write(frame(response));
          }
          if(kind==='game'&&payload[0]===0x06){
            const state=movementSession.getState(session.sessionId);
            if(!state) throw new Error('movement packet accepted without WS15 state');
            const p=state.targetPosition||state.position;
            console.log(`WS05_AUTH event=browser-movement accepted=1 x=${p.x} y=${p.y} z=${p.z} heading=${state.headingRaw} region=${regionKey(p)}`);
            const key=regionKey(p);
            if(key!==lastRegion){
              lastRegion=key;
              const visible=combinedNearby(21,p.x,p.z);
              const ids=visible.map(runtimeIdOf);
              const c=classify(ids);
              const regionPacket=worldApi.buildRegionNpcIds(visible);
              socket.write(frame(regionPacket));
              console.log(`WS05_AUTH event=region-list x=${p.x} z=${p.z} count=${ids.length} npc=${c.npc.join(',')} mob=${c.mob.join(',')} bandicoot=${c.bandicoot.join(',')}`);
            }
          }
        }
      }).catch((error)=>{console.error(`WS05_COMPOSE event=${kind}-error message=${JSON.stringify(error.message)} stack=${JSON.stringify(error.stack||'')}`);socket.destroy(error);});
    });
    socket.on('close',()=>console.log(`WS05_COMPOSE event=${kind}-closed socketId=${socketId}`));
  });
  server.listen(port,'127.0.0.1',()=>console.log(`WS05_COMPOSE event=${kind}-listening port=${port}`));
  return server;
}
const auth=listen(authPort,'auth'),game=listen(gamePort,'game');
function shutdown(){auth.close();game.close();}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
