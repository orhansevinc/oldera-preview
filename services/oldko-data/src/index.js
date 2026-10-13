import { createRequire } from 'node:module';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const RETRYABLE_SQLSTATES = new Set(['40001', '40P01']);
const ISOLATION_LEVELS = new Set(['READ COMMITTED', 'REPEATABLE READ', 'SERIALIZABLE']);
const ITEM_TABLES = Object.freeze({ equipment: 'character_items', inventory: 'inventory', inn: 'inn_storage' });

export class DataConflictError extends Error { constructor(message, options={}) { super(message, options); this.code='OLDKO_DATA_CONFLICT'; } }
export class NotFoundError extends Error { constructor(message, options={}) { super(message, options); this.code='OLDKO_NOT_FOUND'; } }
export class ValidationError extends Error { constructor(message, options={}) { super(message, options); this.code='OLDKO_VALIDATION'; } }

export function createPool(options = {}) {
  const require = createRequire(import.meta.url);
  const pg = require('pg');
  const connectionString = options.connectionString ?? process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required');
  return new pg.Pool({
    connectionString,
    ssl: options.ssl ?? (process.env.OLDKO_DB_SSL === 'require' ? { rejectUnauthorized: true } : undefined),
    max: options.max ?? (process.env.NODE_ENV === 'production' ? 20 : 5),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 10_000,
    application_name: options.applicationName ?? 'oldko-data'
  });
}

export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 256) throw new TypeError('password must be 8..256 characters');
  const salt = randomBytes(16);
  const params = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
  const derived = Buffer.from(await scrypt(password, salt, 64, params));
  return `scrypt$${params.N}$${params.r}$${params.p}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export async function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || typeof encoded !== 'string') return false;
  const [kind, nRaw, rRaw, pRaw, saltRaw, hashRaw] = encoded.split('$');
  if (kind !== 'scrypt' || !hashRaw) return false;
  const N=Number(nRaw), r=Number(rRaw), p=Number(pRaw);
  if (![N,r,p].every(Number.isSafeInteger) || N < (1<<14) || N > (1<<20) || r < 1 || p < 1) return false;
  const salt=Buffer.from(saltRaw,'base64'), expected=Buffer.from(hashRaw,'base64');
  if (salt.length < 16 || expected.length !== 64) return false;
  const actual=Buffer.from(await scrypt(password, salt, expected.length, {N,r,p,maxmem:64*1024*1024}));
  return timingSafeEqual(actual, expected);
}

export async function withTransaction(pool, operation, options = {}) {
  const isolationLevel = options.isolationLevel ?? 'SERIALIZABLE';
  const maxRetries = options.maxRetries ?? 2;
  if (!ISOLATION_LEVELS.has(isolationLevel)) throw new TypeError('unsupported isolation level');
  let attempt=0;
  for (;;) {
    const client=await pool.connect();
    try {
      await client.query(`BEGIN ISOLATION LEVEL ${isolationLevel}`);
      const result=await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      if (RETRYABLE_SQLSTATES.has(error?.code) && attempt < maxRetries) { attempt++; await new Promise(r=>setTimeout(r, Math.min(25*2**attempt,250))); continue; }
      throw error;
    } finally { client.release(); }
  }
}

export class PgAccountRepository {
  constructor(db) { this.db=db; }
  async findById(id) { const {rows}=await this.db.query(`SELECT id,username,email,status,created_at,last_login_at FROM oldko.accounts WHERE id=$1`,[id]); return rows[0]??null; }
  async findByUsername(username) { const {rows}=await this.db.query(`SELECT id,username,password_hash,email,status,created_at,last_login_at FROM oldko.accounts WHERE username_key=lower($1)`,[username]); return rows[0]??null; }
  async create({username,passwordHash,email=null}) { const {rows}=await this.db.query(`INSERT INTO oldko.accounts(username,username_key,password_hash,email) VALUES($1,lower($1),$2,$3) RETURNING id,username,email,status,created_at`,[username,passwordHash,email]); return rows[0]; }
  async getBanState(accountId, ip=null) {
    const {rows}=await this.db.query(`SELECT EXISTS(SELECT 1 FROM oldko.bans WHERE account_id=$1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now())) account_banned, CASE WHEN $2::inet IS NULL THEN false ELSE EXISTS(SELECT 1 FROM oldko.ip_bans WHERE $2::inet <<= network AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now())) END ip_banned`,[accountId,ip]);
    return rows[0];
  }
}

export class PgCharacterRepository {
  constructor(pool) { this.pool=pool; }
  async listByAccount(accountId) {
    const {rows}=await this.pool.query(`SELECT c.id,c.slot,c.name,c.nation,c.race,c.class_id,c.face,c.hair,c.zone_id,c.pos_x,c.pos_y,c.pos_z,s.* FROM oldko.characters c JOIN oldko.character_stats s ON s.character_id=c.id WHERE c.account_id=$1 AND c.deleted_at IS NULL ORDER BY c.slot`,[accountId]);
    return rows;
  }
  async selectCharacter(accountId, slot) { assertSlot(slot); const {rows}=await this.pool.query(`SELECT c.id,c.slot,c.name,c.nation,c.race,c.class_id,c.face,c.hair,c.zone_id,c.pos_x,c.pos_y,c.pos_z,s.* FROM oldko.characters c JOIN oldko.character_stats s ON s.character_id=c.id WHERE c.account_id=$1 AND c.slot=$2 AND c.deleted_at IS NULL`,[accountId,slot]); return rows[0]??null; }
  async createCharacter(accountId, input) {
    assertSlot(input.slot); validateCharacterName(input.name);
    return withTransaction(this.pool, async client=>{
      await client.query(`SELECT id FROM oldko.accounts WHERE id=$1 FOR UPDATE`,[accountId]);
      try {
        const {rows}=await client.query(`INSERT INTO oldko.characters(account_id,slot,name,name_key,nation,race,class_id,face,hair,zone_id,pos_x,pos_y,pos_z) VALUES($1,$2,$3,lower($3),$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,[accountId,input.slot,input.name,input.nation,input.race,input.classId,input.face??0,input.hair??0,input.zoneId??21,input.posX??0,input.posY??0,input.posZ??0]);
        const c=rows[0];
        await client.query(`INSERT INTO oldko.character_stats(character_id,hp,mp,str,sta,dex,intel,cha) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[c.id,input.hp??100,input.mp??100,input.str??50,input.sta??50,input.dex??50,input.intel??50,input.cha??50]);
        return c;
      } catch(error) { if(error?.code==='23505') throw new DataConflictError('character name or slot already exists',{cause:error}); throw error; }
    });
  }
}

export class PgInventoryRepository {
  constructor(pool) { this.pool=pool; }
  async moveItem({itemInstanceId,from,to,actorAccountId=null}) {
    validateLocation(from); validateLocation(to);
    return withTransaction(this.pool, async client=>{
      const lock=await client.query(`SELECT id,serial,item_template_id,stack_count,durability FROM oldko.item_instances WHERE id=$1 FOR UPDATE`,[itemInstanceId]);
      if(!lock.rows[0]) throw new NotFoundError('item instance not found');
      const removed=await deletePlacement(client,itemInstanceId,from);
      if(removed.rowCount!==1) throw new NotFoundError('item is not at expected source');
      await insertPlacement(client,itemInstanceId,to);
      await client.query(`INSERT INTO oldko.audit_log(actor_account_id,action,target_type,target_id,details) VALUES($1,'item.move','item_instance',$2::text,$3::jsonb)`,[actorAccountId,itemInstanceId,JSON.stringify({from,to})]);
      return lock.rows[0];
    },{isolationLevel:'SERIALIZABLE',maxRetries:3});
  }
  async findDuplicateSerials() { const {rows}=await this.pool.query(`SELECT serial,count(*)::int copies FROM oldko.item_instances GROUP BY serial HAVING count(*)>1 ORDER BY copies DESC,serial`); return rows; }
}

export class PgAdminRepository {
  constructor(pool) { this.pool=pool; }
  async getAccountOverview(accountId) { const {rows}=await this.pool.query(`SELECT a.id,a.username,a.email,a.status,a.created_at,a.last_login_at,count(c.id)::int character_count,EXISTS(SELECT 1 FROM oldko.bans b WHERE b.account_id=a.id AND b.revoked_at IS NULL AND (b.expires_at IS NULL OR b.expires_at>now())) account_banned FROM oldko.accounts a LEFT JOIN oldko.characters c ON c.account_id=a.id AND c.deleted_at IS NULL WHERE a.id=$1 GROUP BY a.id`,[accountId]); return rows[0]??null; }
  async banAccount({accountId,reason,expiresAt=null,actorAccountId=null,requestId=null}) { return withTransaction(this.pool,async client=>{ const {rows}=await client.query(`INSERT INTO oldko.bans(account_id,reason,expires_at,created_by) VALUES($1,$2,$3,$4) RETURNING *`,[accountId,reason,expiresAt,actorAccountId]); await audit(client,actorAccountId,'account.ban','account',String(accountId),requestId,{reason,expiresAt}); return rows[0]; }); }
  async unbanAccount({accountId,reason=null,actorAccountId=null,requestId=null}) { return withTransaction(this.pool,async client=>{ await client.query(`UPDATE oldko.bans SET revoked_at=now(),revoked_by=$2,revoke_reason=$3 WHERE account_id=$1 AND revoked_at IS NULL`,[accountId,actorAccountId,reason]); await audit(client,actorAccountId,'account.unban','account',String(accountId),requestId,{reason}); }); }
  async banIp({network,reason,expiresAt=null,actorAccountId=null,requestId=null}) { return withTransaction(this.pool,async client=>{ const {rows}=await client.query(`INSERT INTO oldko.ip_bans(network,reason,expires_at,created_by) VALUES($1::cidr,$2,$3,$4) RETURNING *`,[network,reason,expiresAt,actorAccountId]); await audit(client,actorAccountId,'ip.ban','ip_network',network,requestId,{reason,expiresAt}); return rows[0]; }); }
  async unbanIp({network,reason=null,actorAccountId=null,requestId=null}) { return withTransaction(this.pool,async client=>{ await client.query(`UPDATE oldko.ip_bans SET revoked_at=now(),revoked_by=$2,revoke_reason=$3 WHERE network=$1::cidr AND revoked_at IS NULL`,[network,actorAccountId,reason]); await audit(client,actorAccountId,'ip.unban','ip_network',network,requestId,{reason}); }); }
  async appendAudit(entry) { const {rows}=await this.pool.query(`INSERT INTO oldko.audit_log(actor_account_id,action,target_type,target_id,request_id,source_ip,details) VALUES($1,$2,$3,$4,$5,$6::inet,$7::jsonb) RETURNING id,created_at`,[entry.actorAccountId??null,entry.action,entry.targetType,entry.targetId??null,entry.requestId??null,entry.ip??null,JSON.stringify(entry.details??{})]); return rows[0]; }
}

async function audit(client,actor,action,type,id,requestId,details) { await client.query(`INSERT INTO oldko.audit_log(actor_account_id,action,target_type,target_id,request_id,details) VALUES($1,$2,$3,$4,$5,$6::jsonb)`,[actor,action,type,id,requestId,JSON.stringify(details)]); }
function assertSlot(slot) { if(!Number.isInteger(slot)||slot<0||slot>2) throw new ValidationError('character slot must be 0, 1, or 2'); }
function validateCharacterName(name) { if(typeof name!=='string'||!/^[A-Za-z0-9_]{3,20}$/.test(name)) throw new ValidationError('character name must be 3..20 ASCII letters, digits, or underscore'); }
function validateLocation(x) { if(!x||!Object.hasOwn(ITEM_TABLES,x.kind)) throw new ValidationError('invalid item location'); if(!Number.isInteger(x.ownerId)||x.ownerId<=0||!Number.isInteger(x.slot)||x.slot<0||x.slot>255) throw new ValidationError('invalid item location owner/slot'); if(x.kind==='inn'&&(!Number.isInteger(x.page)||x.page<0||x.page>31)) throw new ValidationError('invalid inn page'); }
function deletePlacement(c,id,x) { if(x.kind==='equipment') return c.query(`DELETE FROM oldko.character_items WHERE character_id=$1 AND slot=$2 AND item_instance_id=$3`,[x.ownerId,x.slot,id]); if(x.kind==='inventory') return c.query(`DELETE FROM oldko.inventory WHERE character_id=$1 AND slot=$2 AND item_instance_id=$3`,[x.ownerId,x.slot,id]); return c.query(`DELETE FROM oldko.inn_storage WHERE account_id=$1 AND page=$2 AND slot=$3 AND item_instance_id=$4`,[x.ownerId,x.page,x.slot,id]); }
function insertPlacement(c,id,x) { if(x.kind==='equipment') return c.query(`INSERT INTO oldko.character_items(character_id,slot,item_instance_id) VALUES($1,$2,$3)`,[x.ownerId,x.slot,id]); if(x.kind==='inventory') return c.query(`INSERT INTO oldko.inventory(character_id,slot,item_instance_id) VALUES($1,$2,$3)`,[x.ownerId,x.slot,id]); return c.query(`INSERT INTO oldko.inn_storage(account_id,page,slot,item_instance_id) VALUES($1,$2,$3,$4)`,[x.ownerId,x.page,x.slot,id]); }
