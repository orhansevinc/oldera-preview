'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  P2SocialRuntimeAdapter, SocialAuthority, PvpPolicy, CombatSocialLedger, competitionRank,
  OPCODES, CHAT_TYPES, PARTY_SUBOPCODES, NATION, ZONE,
} = require('../../services/ko1298-social');

function namePayload(op, sub, name) { const b = Buffer.from(name, 'latin1'); const out = Buffer.alloc(4 + b.length); out[0]=op; out[1]=sub; out.writeUInt16LE(b.length,2); b.copy(out,4); return out; }
function permit(ok) { return Buffer.from([OPCODES.PARTY, PARTY_SUBOPCODES.PERMIT, ok ? 1 : 0]); }
function chat(type, text) { const b=Buffer.from(text,'latin1'); const out=Buffer.alloc(4+b.length); out[0]=OPCODES.CHAT; out[1]=type; out.writeUInt16LE(b.length,2); b.copy(out,4); return out; }
function target(name) { const b=Buffer.from(name,'latin1'); const out=Buffer.alloc(3+b.length); out[0]=OPCODES.CHAT_TARGET; out.writeUInt16LE(b.length,1); b.copy(out,3); return out; }
function session(id,name,nation=1,zoneId=21,sid=1){ return {sessionId:`s-${id}`,characterId:id,name,sid,nation,zoneId,level:60,classId:101,maxHp:1000,hp:1000,maxMp:500,mp:500}; }

class FriendPort {
  constructor(){ this.blocked=new Set(); this.friends=new Map(); }
  async canPrivateMessage(a,b){ return !this.blocked.has(`${a}:${b}`) && !this.blocked.has(`${b}:${a}`); }
  async listFriends(id){ return {friends:[...(this.friends.get(id)||[])].map(userId=>({userId}))}; }
  async requestFriend({fromId,toId}){ (this.friends.get(fromId)||this.friends.set(fromId,new Set()).get(fromId)).add(toId); (this.friends.get(toId)||this.friends.set(toId,new Set()).get(toId)).add(fromId); return {ok:true,code:'FRIEND_REQUEST_CREATED'}; }
  async block({userId,targetId}){ this.blocked.add(`${userId}:${targetId}`); return {ok:true}; }
  async unblock({userId,targetId}){ this.blocked.delete(`${userId}:${targetId}`); return {ok:true}; }
  async acceptFriend(){return {ok:true}} async rejectFriend(){return {ok:true}} async removeFriend(){return {ok:true}} async listFriendsAction(id){return this.listFriends(id)}
}

test('chat/whisper/party use accepted sessions and block private delivery', async () => {
  const sent=[]; const friends=new FriendPort();
  const social=new SocialAuthority({sendPacket:(sid,p,m)=>sent.push({sid,p,m}), friendPort:friends, nearbyCharacters:()=>['b']});
  await social.registerSession(session('a','Alpha',1,21,10)); await social.registerSession(session('b','Beta',1,21,11));
  assert.equal((await social.handlePacket('s-a', chat(CHAT_TYPES.GENERAL,'hi'))).delivered,2);
  assert.equal((await social.handlePacket('s-a', target('Beta'))).ok,true);
  friends.blocked.add('b:a');
  assert.equal((await social.handlePacket('s-a', chat(CHAT_TYPES.PRIVATE,'x'))).code,'PRIVATE_BLOCKED');
  assert.equal((await social.handlePacket('s-a', Buffer.from([OPCODES.OPERATOR,1]))).code,'PRIVILEGED_OPCODE_DENIED');
});

test('party invite/accept and reconnect grace preserve membership; leader expiry dissolves legacy party', async () => {
  const sent=[]; const social=new SocialAuthority({sendPacket:(sid,p,m)=>sent.push({sid,p,m})});
  await social.registerSession(session('a','Alpha',1,21,10)); await social.registerSession(session('b','Beta',1,21,11));
  assert.equal((await social.handlePacket('s-a', namePayload(OPCODES.PARTY,PARTY_SUBOPCODES.CREATE,'Beta'))).ok,true);
  assert.equal((await social.handlePacket('s-b', permit(true))).ok,true);
  assert.equal(social.getParty('a').members.length,2);
  await social.disconnectSession('s-a',{leaseExpired:false});
  assert.equal(social.getParty('a').members.length,2);
  await social.registerSession({...session('a','Alpha',1,21,12),sessionId:'s-a2'});
  assert.equal(social.getParty('a').members.length,2);
  await social.disconnectSession('s-a2',{leaseExpired:true});
  assert.equal(social.getParty('b'),null);
});

test('concurrent invitations to one target result in one pending invitation', async () => {
  const social=new SocialAuthority();
  await social.registerSession(session('a','Alpha',1,21,10)); await social.registerSession(session('b','Beta',1,21,11)); await social.registerSession(session('c','Gamma',1,21,12));
  const [x,y]=await Promise.all([social.inviteParty('a','Gamma',true),social.inviteParty('b','Gamma',true)]);
  assert.equal([x,y].filter(v=>v.ok).length,1); assert.equal(social.pendingInvites.size,1);
});

test('party share contract excludes offline members and delegates eligibility formula', async () => {
  const social=new SocialAuthority();
  await social.registerSession(session('a','Alpha',1,21,10)); await social.registerSession(session('b','Beta',1,21,11));
  await social.inviteParty('a','Beta',true); await social.answerPartyInvite('b',true);
  let snap=social.getPartyShareSnapshot('a',{purpose:'experience',event:{zoneId:21},eligible:(s,e)=>s.zoneId===e.zoneId}); assert.deepEqual(snap.members.map(x=>x.characterId).sort(),['a','b']);
  await social.disconnectSession('s-b',{leaseExpired:false}); snap=social.getPartyShareSnapshot('a',{purpose:'loot',event:{zoneId:21},eligible:()=>true}); assert.deepEqual(snap.members.map(x=>x.characterId),['a']);
});

test('pvp policy keeps Moradon/Eslant safe, battle/home conditional, safe areas and same-nation blocked', () => {
  const p=new PvpPolicy();
  const actor=(nation,zoneId,extra={})=>({nation,zoneId,...extra});
  assert.equal(p.canAttack({attacker:actor(1,21),target:actor(2,21)}).allowed,false);
  assert.equal(p.canAttack({attacker:actor(1,11),target:actor(2,11),invasionOpen:true}).allowed,false);
  assert.equal(p.canAttack({attacker:actor(1,101),target:actor(2,101),battleOpen:true}).allowed,true);
  assert.equal(p.canAttack({attacker:actor(1,101),target:actor(1,101),battleOpen:true}).reason,'FRIENDLY_FIRE');
  assert.equal(p.canAttack({attacker:actor(1,2),target:actor(2,2),invasionOpen:true}).allowed,true);
  assert.equal(p.canAttack({attacker:actor(1,2,{inSafeArea:true}),target:actor(2,2),invasionOpen:true}).reason,'SAFE_AREA');
  assert.equal(p.canEnter({nation:1,zoneId:12}).allowed,false);
});

test('zone epoch invalidates attacks created before an authoritative zone transition', async () => {
  const rt=new P2SocialRuntimeAdapter(); await rt.onSessionReady(session('a','Alpha',1,101,10)); await rt.onSessionReady(session('b','Beta',2,101,11));
  const epoch=rt.social.getSessionByCharacter('a').zoneEpoch; await rt.onZoneChanged('a',21);
  assert.equal(rt.validateAttack({attackerCharacterId:'a',targetCharacterId:'b',attackerZoneEpoch:epoch,targetZoneEpoch:0,battleOpen:true}).allowed,false);
});

test('combat ledger accepts only P2-07 outcomes, is idempotent, and rejects client score', async () => {
  const applied=[]; const p=new PvpPolicy(); const sink={async applyCombatSocialOutcome(m){applied.push(m);return {applied:true}}}; const l=new CombatSocialLedger({pvpPolicy:p,sink});
  const event={authority:'P2-07_AUTHORITATIVE_COMBAT',eventId:'e1',kind:'pvp_kill',attacker:{characterId:'a',nation:1,zoneId:101},victim:{characterId:'b',nation:2,zoneId:101},battleOpen:true,npAward:50,npLoss:25};
  assert.equal((await l.consume(event)).ok,true); assert.equal((await l.consume(event)).code,'DUPLICATE_IGNORED'); assert.equal(applied.length,1);
  assert.equal((await l.consume({...event,eventId:'e2',clientReportedScore:999})).code,'CLIENT_SCORE_REJECTED');
  assert.equal((await l.consume({...event,eventId:'e3',authority:'CLIENT'})).code,'UNTRUSTED_COMBAT_OUTCOME');
});

test('player command surface cannot invoke GM/admin namespaces', async () => {
  const rt=new P2SocialRuntimeAdapter(); await rt.onSessionReady(session('a','Alpha',1,21,10));
  assert.equal((await rt.playerCommand('a','gm.notice',{text:'x'})).code,'PLAYER_COMMAND_DENIED');
  assert.equal((await rt.playerCommand('a','admin.ban',{targetId:'b'})).code,'PLAYER_COMMAND_DENIED');
  assert.equal(P2SocialRuntimeAdapter.integrationManifest().packetRoutes.find(x=>x.opcode===OPCODES.FRIEND).codec,'blocked-source-layout');
});

test('ranking uses authoritative rows with stable competition ties', async () => {
  const rows=[
    {characterId:'c',name:'Zulu',nationalPoints:100,kills:3},
    {characterId:'b',name:'beta',nationalPoints:100,kills:4},
    {characterId:'a',name:'Alpha',nationalPoints:200,kills:5},
    {characterId:'d',name:'Delta',nationalPoints:50,kills:1},
  ];
  assert.deepEqual(competitionRank(rows,'nationalPoints').map(x=>[x.rank,x.characterId]),[[1,'a'],[2,'b'],[2,'c'],[4,'d']]);
  const reader={async readRankingRows(){return {updatedAt:'2026-10-15T00:00:00Z',rows}}};
  const sink={async applyCombatSocialOutcome(){return {applied:true}}};
  const l=new CombatSocialLedger({pvpPolicy:new PvpPolicy(),sink,rankingReader:reader});
  const result=await l.rankings({metric:'nationalPoints'});
  assert.equal(result.ok,true); assert.deepEqual(result.items.map(x=>x.rank),[1,2,2,4]);
});

test('friend/clan presence follows session lifecycle without fake list state', async () => {
  const events=[];
  const friendPort={
    async sessionOnline(x){events.push(['friend-online',x.characterId,x.sessionId]);},
    async sessionOffline(x){events.push(['friend-offline',x.characterId,x.sessionId]);},
    async listFriends(){return {friends:[]};},
    async canPrivateMessage(){return true;},
  };
  const clanPort={
    setOnlineState(id,online){events.push(['clan-online',String(id),online]);},
    clearInvitesForCharacter(id){events.push(['clan-clear',String(id)]);},
  };
  const social=new SocialAuthority({friendPort,clanPort});
  await social.registerSession(session('a','Alpha',1,21,10));
  await social.disconnectSession('s-a',{leaseExpired:true});
  assert.deepEqual(events,[
    ['friend-online','a','s-a'],['clan-online','a',true],
    ['friend-offline','a','s-a'],['clan-online','a',false],['clan-clear','a'],
  ]);
});
