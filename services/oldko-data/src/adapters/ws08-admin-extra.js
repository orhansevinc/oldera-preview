import { createHash, randomUUID } from 'node:crypto';
import { DataConflictError, NotFoundError, ValidationError } from '../index.js';
import { commandRow, iso } from './ws08-admin-shared.js';

export async function upsertAdminActor(repo,{id,username,passwordHash,roles=[],enabled=true}){
  const actorId=String(id??'').trim(), user=String(username??'').trim(); if(!actorId||!user||!passwordHash) throw new ValidationError('admin actor id, username and passwordHash are required');
  const {rows}=await repo.db.query(`INSERT INTO oldko.admin_actors(id,username,username_key,password_hash,roles,enabled) VALUES($1,$2,lower($2),$3,$4::text[],$5) ON CONFLICT(id) DO UPDATE SET username=EXCLUDED.username,username_key=EXCLUDED.username_key,password_hash=EXCLUDED.password_hash,roles=EXCLUDED.roles,enabled=EXCLUDED.enabled,updated_at=now() RETURNING id,username,roles,enabled,created_at,updated_at,last_login_at`,[actorId,user,passwordHash,roles.map(r=>String(r).toUpperCase()),Boolean(enabled)]);
  return actorRow(rows[0]);
}

export async function getAdminActorByUsername(repo,username){const {rows}=await repo.db.query(`SELECT id,username,password_hash,roles,enabled,created_at,updated_at,last_login_at FROM oldko.admin_actors WHERE username_key=lower($1)`,[String(username??'').trim()]); return rows[0]?{...actorRow(rows[0]),passwordHash:rows[0].password_hash}:null;}

export async function createAdminSession(repo,{actorId,tokenHash,expiresAt,sourceIp=null,userAgent=null,id=randomUUID()}){
  const hash=asBuffer(tokenHash,'tokenHash'); const {rows}=await repo.db.query(`INSERT INTO oldko.admin_sessions(id,actor_id,token_hash,source_ip,user_agent,expires_at) VALUES($1,$2,$3,$4::inet,$5,$6) RETURNING id,actor_id,created_at,expires_at`,[id,actorId,hash,sourceIp,userAgent,expiresAt]);
  await repo.db.query(`UPDATE oldko.admin_actors SET last_login_at=now(),updated_at=now() WHERE id=$1`,[actorId]); return {id:rows[0].id,actorId:rows[0].actor_id,createdAt:iso(rows[0].created_at),expiresAt:iso(rows[0].expires_at)};
}

export async function getAdminSessionByTokenHash(repo,tokenHash){
  const {rows}=await repo.db.query(`SELECT s.id,s.actor_id,s.created_at,s.expires_at,a.username,a.roles FROM oldko.admin_sessions s JOIN oldko.admin_actors a ON a.id=s.actor_id WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND a.enabled`,[asBuffer(tokenHash,'tokenHash')]); if(!rows[0]) return null;
  await repo.db.query(`UPDATE oldko.admin_sessions SET last_seen_at=now() WHERE id=$1`,[rows[0].id]); return {id:rows[0].id,actorId:rows[0].actor_id,username:rows[0].username,roles:rows[0].roles,createdAt:iso(rows[0].created_at),expiresAt:iso(rows[0].expires_at)};
}
export async function revokeAdminSession(repo,id){return (await repo.db.query(`UPDATE oldko.admin_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE id=$1 AND revoked_at IS NULL`,[id])).rowCount===1;}

export async function reserveAdminOperation(repo,{actorId,idempotencyKey,request}){
  const keyHash=sha(idempotencyKey), requestHash=sha(stableJson(request)); const inserted=await repo.db.query(`INSERT INTO oldko.admin_operation_receipts(actor_id,idempotency_key_hash,request_hash) VALUES($1,$2,$3) ON CONFLICT(actor_id,idempotency_key_hash) DO NOTHING RETURNING state,response`,[String(actorId),keyHash,requestHash]);
  if(inserted.rows[0]) return {duplicate:false,state:inserted.rows[0].state,response:inserted.rows[0].response};
  const {rows}=await repo.db.query(`SELECT request_hash,state,response FROM oldko.admin_operation_receipts WHERE actor_id=$1 AND idempotency_key_hash=$2`,[String(actorId),keyHash]); if(!rows[0]||!Buffer.from(rows[0].request_hash).equals(requestHash)) throw new DataConflictError('idempotency key was already used for a different request'); return {duplicate:true,state:rows[0].state,response:rows[0].response};
}
export async function completeAdminOperation(repo,{actorId,idempotencyKey,response,failed=false}){const {rows}=await repo.db.query(`UPDATE oldko.admin_operation_receipts SET state=$3,response=$4::jsonb,updated_at=now() WHERE actor_id=$1 AND idempotency_key_hash=$2 RETURNING state,response`,[String(actorId),sha(idempotencyKey),failed?'failed':'completed',JSON.stringify(response??null)]); if(!rows[0]) throw new NotFoundError('admin operation receipt not found'); return {state:rows[0].state,response:rows[0].response};}

export async function claimCommands(repo,{workerId,limit=20}){
  const bounded=Math.max(1,Math.min(Number(limit)||20,100)); return repo.transaction(async tx=>{const {rows}=await tx.db.query(`WITH picked AS (SELECT id FROM oldko.admin_command_outbox WHERE status IN('pending','failed') AND available_at<=now() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT $2) UPDATE oldko.admin_command_outbox o SET status='claimed',claimed_at=now(),claimed_by=$1,attempt_count=attempt_count+1,updated_at=now() FROM picked WHERE o.id=picked.id RETURNING o.*`,[String(workerId),bounded]); return rows.map(commandRow);});
}
export async function completeCommand(repo,{id,workerId,succeeded,error=null}){const {rows}=await repo.db.query(`UPDATE oldko.admin_command_outbox SET status=$3,completed_at=now(),last_error=$4,updated_at=now() WHERE id=$1 AND status='claimed' AND claimed_by=$2 RETURNING *`,[id,String(workerId),succeeded?'succeeded':'failed',error==null?null:String(error).slice(0,2000)]); if(!rows[0]) throw new DataConflictError('command is not claimed by this worker'); return commandRow(rows[0]);}

function actorRow(row){return {id:row.id,username:row.username,roles:row.roles??[],enabled:Boolean(row.enabled),createdAt:iso(row.created_at),updatedAt:iso(row.updated_at),lastLoginAt:row.last_login_at?iso(row.last_login_at):null};}
function asBuffer(value,name){if(Buffer.isBuffer(value)&&value.length) return value; if(typeof value==='string'&&value) return Buffer.from(value,'hex'); throw new ValidationError(`${name} is required`);}
function sha(value){const text=String(value??''); if(!text) throw new ValidationError('idempotency material is required'); return createHash('sha256').update(text).digest();}
function stableJson(value){return JSON.stringify(value??null,(_key,item)=>typeof item==='bigint'?item.toString():item);}
