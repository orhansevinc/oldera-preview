import { PLAYER_SELECT, ITEM_LOCATION_SELECT, characterRow, emptyInventory, identity, itemLocationRow, itemSlot, latestIp, locationsBySerial, player, sanctionRow, iso } from './ws08-admin-shared.js';

export async function overview(repo) {
  const now=Math.trunc(repo.now());
  const {rows}=await repo.db.query(`SELECT
    (SELECT count(*)::int FROM oldko.characters WHERE deleted_at IS NULL) characters,
    (SELECT count(*)::int FROM oldko.bans WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now()))+(SELECT count(*)::int FROM oldko.ip_bans WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now())) sanctions,
    (SELECT count(DISTINCT c.id)::int FROM oldko.characters c WHERE c.deleted_at IS NULL AND EXISTS(SELECT 1 FROM oldko.session_leases l WHERE l.scope='character' AND l.state='active' AND l.lease_until>$1 AND l.character_id IN(c.id::text,c.name,c.name_key))) online`,[now]);
  const duplicates=await findDuplicateSerials(repo);
  return {online:Number(rows[0].online),characters:Number(rows[0].characters),sanctions:Number(rows[0].sanctions),duplicateSerials:duplicates.duplicates.length};
}

export async function listPlayers(repo,{online=false,q='',limit=1000}={}) {
  const needle=String(q??'').trim().toLowerCase(), bounded=Math.max(1,Math.min(Number(limit)||1000,5000));
  const {rows}=await repo.db.query(`${PLAYER_SELECT} WHERE c.deleted_at IS NULL AND ($2::text='' OR lower(c.name) LIKE '%'||$2||'%' OR lower(a.username) LIKE '%'||$2||'%') ORDER BY c.name_key LIMIT $3`,[Math.trunc(repo.now()),needle,bounded]);
  const out=[]; for(const row of rows){const value=await player(repo,row); if(!online||value.online) out.push(value);} return out;
}

export async function getCharacter(repo,name){const row=await characterRow(repo,name); return row?player(repo,row,{includeSkills:true}):null;}

export async function getInventory(repo,name){
  const who=await identity(repo,name); if(!who) return emptyInventory();
  const equipment=Array.from({length:14},(_,slot)=>({slot,empty:true})), inventory=Array.from({length:28},(_,slot)=>({slot,empty:true}));
  const {rows}=await repo.db.query(`SELECT p.scope,p.slot,i.item_template_id,i.serial,i.stack_count,i.durability FROM (SELECT 'equipment'::text scope,ci.slot::int slot,ci.item_instance_id FROM oldko.character_items ci WHERE ci.character_id=$1 UNION ALL SELECT 'inventory',iv.slot::int,iv.item_instance_id FROM oldko.inventory iv WHERE iv.character_id=$1) p JOIN oldko.item_instances i ON i.id=p.item_instance_id ORDER BY p.scope,p.slot`,[who.id]);
  for(const row of rows){const slot=itemSlot(row); if(row.scope==='equipment') equipment[slot.slot]=slot; else inventory[slot.slot]=slot;} return {equipment,inventory};
}

export async function getInn(repo,name){
  const who=await identity(repo,name); const slots=Array.from({length:192},(_,slot)=>({slot,empty:true})); if(!who) return {slots};
  const {rows}=await repo.db.query(`SELECT ins.flat_slot::int slot,i.item_template_id,i.serial,i.stack_count,i.durability FROM oldko.inn_storage ins JOIN oldko.item_instances i ON i.id=ins.item_instance_id WHERE ins.account_id=$1 AND ins.flat_slot<192 ORDER BY ins.flat_slot`,[who.account_id]);
  for(const row of rows) slots[Number(row.slot)]=itemSlot(row); return {slots};
}

export async function getTransactions(repo,name){
  const who=await identity(repo,name); if(!who) return [];
  const {rows}=await repo.db.query(`SELECT created_at at,action,target_type,target_id,request_id,details FROM oldko.audit_log WHERE (target_type IN('character','admin_target') AND lower(COALESCE(target_id,''))=lower($1)) OR (target_type='account' AND target_id=$2::text) ORDER BY created_at DESC LIMIT 250`,[who.name,who.account_id]);
  return rows.map(r=>({at:iso(r.at),action:r.action,targetType:r.target_type,targetId:r.target_id,traceId:r.request_id,details:r.details??{}}));
}

export async function getSanctions(repo,name){
  const who=await identity(repo,name); if(!who) return []; const ip=await latestIp(repo,who.account_id);
  const {rows}=await repo.db.query(`SELECT 'ACCOUNT'::text type,b.id::text id,b.reason,b.created_at,b.expires_at,b.revoked_at,b.request_id,b.created_by_admin_id,NULL::text ip FROM oldko.bans b WHERE b.account_id=$1 UNION ALL SELECT 'IP',ib.id::text,ib.reason,ib.created_at,ib.expires_at,ib.revoked_at,ib.request_id,ib.created_by_admin_id,ib.network::text FROM oldko.ip_bans ib WHERE $2::inet IS NOT NULL AND $2::inet <<= ib.network ORDER BY created_at DESC`,[who.account_id,ip]);
  return rows.map(r=>sanctionRow(r,who));
}

export async function searchItems(repo,query){
  const q=String(query??'').trim().toLowerCase();
  const {rows}=await repo.db.query(`${ITEM_LOCATION_SELECT} WHERE $1::text='' OR i.serial::text LIKE '%'||$1||'%' OR i.item_template_id::text LIKE '%'||$1||'%' OR lower(COALESCE(c.name,'')) LIKE '%'||$1||'%' OR lower(a.username) LIKE '%'||$1||'%' ORDER BY i.serial,p.scope,p.slot LIMIT 250`,[q]);
  return rows.map(itemLocationRow);
}

export async function itemHistory(repo,serial){
  const current=await locationsBySerial(repo,serial);
  const {rows}=await repo.db.query(`SELECT id,created_at,action,actor_label,trace_id,details FROM oldko.item_serial_events WHERE serial=$1::bigint ORDER BY created_at DESC`,[String(serial)]);
  return [...rows.map(r=>({id:String(r.id),at:iso(r.created_at),action:r.action,actor:r.actor_label,traceId:r.trace_id,...(r.details??{})})),...current.map(r=>({at:null,action:'CURRENT_LOCATION',...r}))];
}

export async function findDuplicateSerials(repo){
  const {rows}=await repo.db.query(`WITH locations AS (SELECT i.serial,'equipment'::text scope,ci.character_id::text owner,ci.slot::int slot FROM oldko.character_items ci JOIN oldko.item_instances i ON i.id=ci.item_instance_id UNION ALL SELECT i.serial,'inventory',iv.character_id::text,iv.slot::int FROM oldko.inventory iv JOIN oldko.item_instances i ON i.id=iv.item_instance_id UNION ALL SELECT i.serial,'inn',ins.account_id::text,ins.flat_slot::int FROM oldko.inn_storage ins JOIN oldko.item_instances i ON i.id=ins.item_instance_id) SELECT serial::text,count(*)::int count,jsonb_agg(jsonb_build_object('scope',scope,'owner',owner,'slot',slot) ORDER BY scope,slot) locations FROM locations GROUP BY serial HAVING count(*)>1 ORDER BY count DESC,serial`);
  return {duplicates:rows.map(r=>({serial:r.serial,count:Number(r.count),locations:r.locations}))};
}
