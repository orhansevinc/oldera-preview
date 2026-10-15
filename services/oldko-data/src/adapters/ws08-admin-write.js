import { randomUUID } from 'node:crypto';
import { DataConflictError, ValidationError } from '../index.js';
import { ZONE_IDS, identity, isOnline, latestIp, locationsBySerial, lockOffline, nullable, positiveDecimal, resolveAdminActorId, sanctionRow, commandRow, iso } from './ws08-admin-shared.js';
import { getCharacter } from './ws08-admin-read.js';

export async function updateCharacter(repo,name,patch){
  const row=await lockOffline(repo,name); if(!row) return null;
  if(Object.hasOwn(patch,'level')||Object.hasOwn(patch,'np')||Object.hasOwn(patch,'coin')) await repo.db.query(`UPDATE oldko.character_stats SET level=COALESCE($2,level),loyalty=COALESCE($3,loyalty),gold=COALESCE($4,gold),progression_version=progression_version+1,updated_at=now() WHERE character_id=$1`,[row.id,nullable(patch.level),nullable(patch.np),nullable(patch.coin)]);
  if(Object.hasOwn(patch,'zone')){const zoneId=ZONE_IDS[String(patch.zone)]; if(!zoneId) throw new ValidationError(`unsupported admin zone: ${patch.zone}`); await repo.db.query(`UPDATE oldko.characters SET zone_id=$2,world_version=world_version+1,updated_at=now() WHERE id=$1`,[row.id,zoneId]);}
  return getCharacter(repo,name);
}

export async function updateStats(repo,name,patch){
  const row=await lockOffline(repo,name); if(!row) return null;
  const v=k=>Object.hasOwn(patch,k)?patch[k]:null;
  await repo.db.query(`UPDATE oldko.character_stats SET str=COALESCE($2,str),sta=COALESCE($3,sta),dex=COALESCE($4,dex),intel=COALESCE($5,intel),cha=COALESCE($6,cha),progression_version=progression_version+1,updated_at=now() WHERE character_id=$1`,[row.id,v('str'),v('hp'),v('dex'),v('int'),v('mp')]);
  return getCharacter(repo,name);
}

export async function updateSkills(repo,name,patch){
  const row=await lockOffline(repo,name); if(!row) return null; const clean={};
  for(const [key,value] of Object.entries(patch??{})){if(!/^[A-Za-z0-9_.-]{1,64}$/.test(key)||!Number.isInteger(value)||value<0||value>83) throw new ValidationError(`invalid skill entry: ${key}`); clean[key]=value;}
  await repo.db.query(`INSERT INTO oldko.character_skills(character_id,skills) VALUES($1,$2::jsonb) ON CONFLICT(character_id) DO UPDATE SET skills=oldko.character_skills.skills||EXCLUDED.skills,version=oldko.character_skills.version+1,updated_at=now()`,[row.id,JSON.stringify(clean)]);
  await repo.db.query(`UPDATE oldko.character_stats SET progression_version=progression_version+1,updated_at=now() WHERE character_id=$1`,[row.id]);
  return getCharacter(repo,name);
}

export async function itemAction(repo,serial,action){
  const text=positiveDecimal(serial,'serial'); const item=(await repo.db.query(`SELECT id FROM oldko.item_instances WHERE serial=$1::bigint FOR UPDATE`,[text])).rows[0]; if(!item) return null;
  const kind=String(action?.action??'').toUpperCase(); if(!['FLAG','QUARANTINE','CLEAR_FLAG'].includes(kind)) throw new ValidationError('unsupported item action');
  const actor=String(action?.actor??'unknown').slice(0,128), actorId=await resolveAdminActorId(repo,actor), note=String(action?.note??'').slice(0,500);
  if(kind==='CLEAR_FLAG') await repo.db.query(`DELETE FROM oldko.admin_item_flags WHERE item_instance_id=$1`,[item.id]);
  else await repo.db.query(`INSERT INTO oldko.admin_item_flags(item_instance_id,state,note,actor_admin_id,actor_label) VALUES($1,$2,$3,$4,$5) ON CONFLICT(item_instance_id) DO UPDATE SET state=EXCLUDED.state,note=EXCLUDED.note,actor_admin_id=EXCLUDED.actor_admin_id,actor_label=EXCLUDED.actor_label,updated_at=now()`,[item.id,kind==='QUARANTINE'?'quarantined':'flagged',note||null,actorId,actor]);
  await repo.db.query(`INSERT INTO oldko.item_serial_events(item_instance_id,serial,action,actor_admin_id,actor_label,details) VALUES($1,$2,$3,$4,$5,$6::jsonb)`,[item.id,text,`ADMIN_${kind}`,actorId,actor,JSON.stringify({note})]);
  const flag=(await repo.db.query(`SELECT state,note,actor_label,updated_at FROM oldko.admin_item_flags WHERE item_instance_id=$1`,[item.id])).rows[0]??null;
  return {serial:text,matches:await locationsBySerial(repo,text),flag:flag?{state:flag.state,note:flag.note,actor:flag.actor_label,updatedAt:iso(flag.updated_at)}:null};
}

export async function createSanction(repo,{character,type,reason,actor,traceId}){
  const who=await identity(repo,character,{forUpdate:true}); if(!who) return null; const normalized=String(type??'ACCOUNT').toUpperCase(), actorId=await resolveAdminActorId(repo,actor);
  if(normalized==='ACCOUNT'){
    const existing=traceId?(await repo.db.query(`SELECT * FROM oldko.bans WHERE request_id=$1`,[traceId])).rows[0]:null;
    const row=existing??(await repo.db.query(`INSERT INTO oldko.bans(account_id,reason,created_by_admin_id,request_id) VALUES($1,$2,$3,$4) RETURNING *`,[who.account_id,reason,actorId,traceId??null])).rows[0];
    if(await isOnline(repo,who)) await enqueueCommand(repo,{command:'FORBIDUSER',target:who.name,arg:'',requestedBy:actor,traceId:`${traceId??randomUUID()}:sanction`,source:'ws07-admin-sanction'},who);
    return sanctionRow({...row,type:'ACCOUNT',ip:null},who);
  }
  if(normalized!=='IP') throw new ValidationError('sanction type must be ACCOUNT or IP'); const ip=await latestIp(repo,who.account_id); if(!ip) throw new DataConflictError('cannot create IP sanction without an authoritative recorded account session IP');
  const existing=traceId?(await repo.db.query(`SELECT * FROM oldko.ip_bans WHERE request_id=$1`,[traceId])).rows[0]:null;
  const row=existing??(await repo.db.query(`INSERT INTO oldko.ip_bans(network,reason,created_by_admin_id,request_id) VALUES($1::inet::cidr,$2,$3,$4) RETURNING *`,[ip,reason,actorId,traceId??null])).rows[0];
  if(await isOnline(repo,who)) await enqueueCommand(repo,{command:'FORBIDCONNECT',target:who.name,arg:'',requestedBy:actor,traceId:`${traceId??randomUUID()}:sanction`,source:'ws07-admin-sanction'},who);
  return sanctionRow({...row,type:'IP',ip:row.network},who);
}

export async function removeSanction(repo,{character,type}){
  const who=await identity(repo,character,{forUpdate:true}); if(!who) return null; const normalized=String(type??'').toUpperCase();
  if(!normalized||normalized==='ACCOUNT') await repo.db.query(`UPDATE oldko.bans SET revoked_at=COALESCE(revoked_at,now()) WHERE account_id=$1 AND revoked_at IS NULL`,[who.account_id]);
  if(!normalized||normalized==='IP'){const ip=await latestIp(repo,who.account_id); if(ip) await repo.db.query(`UPDATE oldko.ip_bans SET revoked_at=COALESCE(revoked_at,now()) WHERE $1::inet <<= network AND revoked_at IS NULL`,[ip]);}
  return getCharacter(repo,character);
}

export async function appendAudit(repo,entry){
  const actorId=await resolveAdminActorId(repo,entry.actorId??entry.actor); const details={actor:entry.actor??null,actorId:entry.actorId??null,roles:entry.roles??[],reason:entry.reason??null,source:entry.source??null,result:entry.result??'SUCCESS',traceId:entry.traceId??null};
  const {rows}=await repo.db.query(`INSERT INTO oldko.audit_log(actor_admin_id,action,target_type,target_id,request_id,details) VALUES($1,$2,'admin_target',$3,$4,$5::jsonb) RETURNING id,created_at`,[actorId,entry.action,entry.target??null,entry.traceId??null,JSON.stringify(details)]);
  return {id:String(rows[0].id),createdAt:iso(rows[0].created_at),...entry};
}

export async function listAudit(repo,limit=100){const bounded=Math.max(1,Math.min(Number(limit)||100,1000)); const {rows}=await repo.db.query(`SELECT id,created_at,action,target_type,target_id,request_id,details FROM oldko.audit_log ORDER BY created_at DESC,id DESC LIMIT $1`,[bounded]); return rows.map(r=>({id:String(r.id),createdAt:iso(r.created_at),action:r.action,target:r.target_id,targetType:r.target_type,traceId:r.request_id,...(r.details??{})}));}

export async function enqueueCommand(repo,command,knownIdentity=null){
  const traceId=String(command?.traceId??'').trim(); if(!traceId) throw new ValidationError('command traceId is required for durable idempotency'); const who=knownIdentity??(command?.target?await identity(repo,command.target):null), actor=String(command?.requestedBy??'unknown').slice(0,128), actorId=await resolveAdminActorId(repo,actor);
  let expected=null; if(who) expected=(await repo.db.query(`SELECT c.world_version,c.item_version,s.progression_version FROM oldko.characters c JOIN oldko.character_stats s ON s.character_id=c.id WHERE c.id=$1`,[who.id])).rows[0]??null;
  const {rows}=await repo.db.query(`INSERT INTO oldko.admin_command_outbox(id,command,target,arg,requested_by,requested_by_admin_id,trace_id,source,expected_character_id,expected_world_version,expected_progression_version,expected_item_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(trace_id) DO UPDATE SET trace_id=EXCLUDED.trace_id RETURNING *`,[randomUUID(),String(command.command??'').toUpperCase(),String(command.target??''),String(command.arg??'').slice(0,500),actor,actorId,traceId,String(command.source??'oldko-admin-api').slice(0,80),who?.id??null,expected?.world_version??null,expected?.progression_version??null,expected?.item_version??null]);
  return commandRow(rows[0]);
}
