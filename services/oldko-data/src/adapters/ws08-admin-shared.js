import { DataConflictError, ValidationError } from '../index.js';

export const ZONE_IDS = Object.freeze({ Luferson: 1, 'El Morad Castle': 2, Moradon: 21, 'Colony Zone': 201 });
export const ZONE_NAMES = new Map(Object.entries(ZONE_IDS).map(([name, id]) => [id, name]));
const CLASS_NAMES = new Map([[1, 'Warrior'], [2, 'Rogue'], [3, 'Mage'], [4, 'Priest']]);

export const PLAYER_SELECT = `SELECT c.id,c.account_id,c.name,c.name_key,c.nation,c.class_id,c.zone_id,c.pos_x,c.pos_y,c.pos_z,c.world_version,c.item_version,
 a.username AS account,s.level,s.loyalty,s.gold,s.str,s.sta,s.dex,s.intel,s.cha,s.progression_version,
 sess.ip,sess.last_seen_at,
 EXISTS(SELECT 1 FROM oldko.bans b WHERE b.account_id=a.id AND b.revoked_at IS NULL AND (b.expires_at IS NULL OR b.expires_at>now())) account_banned,
 CASE WHEN sess.ip IS NULL THEN false ELSE EXISTS(SELECT 1 FROM oldko.ip_bans ib WHERE sess.ip::inet <<= ib.network AND ib.revoked_at IS NULL AND (ib.expires_at IS NULL OR ib.expires_at>now())) END ip_banned,
 EXISTS(SELECT 1 FROM oldko.session_leases l WHERE l.scope='character' AND l.state='active' AND l.lease_until>$1 AND l.character_id IN (c.id::text,c.name,c.name_key)) online
 FROM oldko.characters c JOIN oldko.accounts a ON a.id=c.account_id AND a.deleted_at IS NULL
 JOIN oldko.character_stats s ON s.character_id=c.id
 LEFT JOIN LATERAL (SELECT host(source_ip) ip,COALESCE(last_seen_at,created_at) last_seen_at FROM oldko.account_sessions WHERE account_id=a.id AND source_ip IS NOT NULL ORDER BY COALESCE(last_seen_at,created_at) DESC,id DESC LIMIT 1) sess ON true`;

export const ITEM_LOCATION_SELECT = `SELECT i.id item_instance_id,i.serial,i.item_template_id,i.stack_count,i.durability,p.scope,p.slot,p.character_id,c.name AS character_name,a.username account
 FROM (SELECT ci.item_instance_id,'equipment'::text scope,ci.slot::int slot,ci.character_id,NULL::bigint account_id FROM oldko.character_items ci
 UNION ALL SELECT iv.item_instance_id,'inventory',iv.slot::int,iv.character_id,NULL::bigint FROM oldko.inventory iv
 UNION ALL SELECT ins.item_instance_id,'inn',ins.flat_slot::int,NULL::bigint,ins.account_id FROM oldko.inn_storage ins) p
 JOIN oldko.item_instances i ON i.id=p.item_instance_id LEFT JOIN oldko.characters c ON c.id=p.character_id
 JOIN oldko.accounts a ON a.id=COALESCE(c.account_id,p.account_id)`;

export async function characterRow(repo, name, { forUpdate = false } = {}) {
  const suffix = forUpdate ? ' FOR UPDATE OF c,s,a' : '';
  const { rows } = await repo.db.query(`${PLAYER_SELECT} WHERE c.name_key=lower($2) AND c.deleted_at IS NULL${suffix}`, [Math.trunc(repo.now()), String(name ?? '').trim()]);
  return rows[0] ?? null;
}

export async function identity(repo, name, { forUpdate = false } = {}) {
  const suffix = forUpdate ? ' FOR UPDATE OF c,a' : '';
  const { rows } = await repo.db.query(`SELECT c.id,c.account_id,c.name,c.name_key,a.username account FROM oldko.characters c JOIN oldko.accounts a ON a.id=c.account_id WHERE c.name_key=lower($1) AND c.deleted_at IS NULL AND a.deleted_at IS NULL${suffix}`, [String(name ?? '').trim()]);
  return rows[0] ?? null;
}

export async function isOnline(repo, row) {
  if (repo.runtimeAuthority) return Boolean(await repo.runtimeAuthority.isCharacterOnline?.({ id: String(row.id), name: row.name, accountId: String(row.account_id), account: row.account }));
  const { rows } = await repo.db.query(`SELECT EXISTS(SELECT 1 FROM oldko.session_leases WHERE scope='character' AND state='active' AND lease_until>$1 AND character_id IN ($2,$3,$4)) online`, [Math.trunc(repo.now()), String(row.id), row.name, String(row.name).toLowerCase()]);
  return Boolean(rows[0]?.online);
}

export async function lockOffline(repo, name) {
  const row = await characterRow(repo, name, { forUpdate: true });
  if (row && await isOnline(repo, row)) throw new DataConflictError(`character ${row.name} is online; route mutation through game authority/outbox`);
  return row;
}

export async function latestIp(repo, accountId) {
  const { rows } = await repo.db.query(`SELECT host(source_ip) ip FROM oldko.account_sessions WHERE account_id=$1 AND source_ip IS NOT NULL ORDER BY COALESCE(last_seen_at,created_at) DESC,id DESC LIMIT 1`, [accountId]);
  return rows[0]?.ip ?? null;
}

export async function resolveAdminActorId(repo, value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const { rows } = await repo.db.query(`SELECT id FROM oldko.admin_actors WHERE id=$1 OR username_key=lower($1) LIMIT 1`, [text]);
  return rows[0]?.id ?? null;
}

export async function locationsBySerial(repo, serial) {
  const { rows } = await repo.db.query(`${ITEM_LOCATION_SELECT} WHERE i.serial=$1::bigint ORDER BY scope,slot`, [positiveDecimal(serial, 'serial')]);
  return rows.map(itemLocationRow);
}

export async function player(repo, row, { includeSkills = false } = {}) {
  const online = repo.runtimeAuthority ? await isOnline(repo, row) : Boolean(row.online);
  const skills = includeSkills ? ((await repo.db.query(`SELECT skills FROM oldko.character_skills WHERE character_id=$1`, [row.id])).rows[0]?.skills ?? {}) : {};
  return { name: row.name, account: row.account, nation: Number(row.nation)===1?'Karus':Number(row.nation)===2?'El Morad':`Nation ${row.nation}`, className: className(row.class_id), level: Number(row.level), np: Number(row.loyalty), coin: Number(row.gold), zone: ZONE_NAMES.get(Number(row.zone_id)) ?? `Zone ${row.zone_id}`, online, banned: Boolean(row.account_banned), ipBanned: Boolean(row.ip_banned), last: row.last_seen_at?iso(row.last_seen_at):null, ip: row.ip ?? null, x:Number(row.pos_x), y:Number(row.pos_y), z:Number(row.pos_z), initial:String(row.name).slice(0,1).toUpperCase(), stats:{str:Number(row.str),hp:Number(row.sta),dex:Number(row.dex),int:Number(row.intel),mp:Number(row.cha)}, skills, versions:{world:Number(row.world_version),progression:Number(row.progression_version),items:Number(row.item_version)} };
}

export function itemSlot(row) { return { slot:Number(row.slot), itemId:Number(row.item_template_id), serial:String(row.serial), count:Number(row.stack_count), duration:row.durability==null?0:Number(row.durability), empty:false }; }
export function itemLocationRow(row) { return { character:row.character_name??null, account:row.account, scope:row.scope, slot:Number(row.slot), itemId:Number(row.item_template_id), serial:String(row.serial), count:Number(row.stack_count), duration:row.durability==null?0:Number(row.durability) }; }
export function sanctionRow(row, who) { const active=row.revoked_at==null&&(row.expires_at==null||new Date(row.expires_at).getTime()>Date.now()); return { id:String(row.id),character:who.name,account:who.account,ip:row.ip==null?null:String(row.ip),type:row.type,reason:row.reason,actor:row.created_by_admin_id??null,traceId:row.request_id??null,active,createdAt:iso(row.created_at),expiresAt:row.expires_at?iso(row.expires_at):null,revokedAt:row.revoked_at?iso(row.revoked_at):null }; }
export function commandRow(row) { return { id:row.id,command:row.command,target:row.target,arg:row.arg,requestedBy:row.requested_by,traceId:row.trace_id,source:row.source,status:row.status,attemptCount:Number(row.attempt_count),expected:{characterId:row.expected_character_id==null?null:String(row.expected_character_id),worldVersion:num(row.expected_world_version),progressionVersion:num(row.expected_progression_version),itemVersion:num(row.expected_item_version)},createdAt:iso(row.created_at),updatedAt:iso(row.updated_at) }; }
export function emptyInventory() { return { equipment:Array.from({length:14},(_,slot)=>({slot,empty:true})), inventory:Array.from({length:28},(_,slot)=>({slot,empty:true})) }; }
export function positiveDecimal(value,name) { const text=String(value??''); if(!/^[1-9]\d*$/.test(text)) throw new ValidationError(`${name} must be a positive decimal identifier`); return text; }
export function iso(value) { return value==null?null:new Date(value).toISOString(); }
export function nullable(value) { return value===undefined?null:value; }
function num(value) { return value==null?null:Number(value); }
function className(id) { const value=Number(id); return CLASS_NAMES.get(value%100) ?? `Class ${value}`; }
