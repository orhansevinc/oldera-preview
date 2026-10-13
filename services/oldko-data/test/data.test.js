import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, withTransaction, PgInventoryRepository } from '../src/index.js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

test('passwords are salted scrypt hashes', async()=>{ const h=await hashPassword('development-only-password'); assert.match(h,/^scrypt\$/); assert.equal(h.includes('development-only-password'),false); assert.equal(await verifyPassword('development-only-password',h),true); assert.equal(await verifyPassword('wrong-password',h),false); });

test('transaction retries serialization failure', async()=>{ let attempt=0; const logs=[]; const pool={connect:async()=>({query:async sql=>{logs.push(sql);return{rows:[],rowCount:0}},release:()=>logs.push('RELEASE')})}; const v=await withTransaction(pool,async()=>{attempt++; if(attempt===1){const e=new Error('retry');e.code='40001';throw e;} return 7;},{maxRetries:1}); assert.equal(v,7); assert.ok(logs.includes('ROLLBACK')); assert.ok(logs.includes('COMMIT')); });

test('item move locks canonical item before placement mutation', async()=>{ const calls=[]; const client={query:async(sql)=>{const text=String(sql).replace(/\s+/g,' ').trim(); calls.push(text); if(text.includes('FROM oldko.item_instances'))return{rows:[{id:9,serial:'123'}],rowCount:1}; if(text.startsWith('DELETE FROM'))return{rows:[],rowCount:1}; return{rows:[],rowCount:1};},release(){}}; const repo=new PgInventoryRepository({connect:async()=>client}); await repo.moveItem({itemInstanceId:9,from:{kind:'inventory',ownerId:1,slot:1},to:{kind:'equipment',ownerId:1,slot:2}}); assert.ok(calls.findIndex(x=>x.includes('FOR UPDATE'))<calls.findIndex(x=>x.startsWith('DELETE FROM oldko.inventory'))); });

test('migration declares required schema and duplicate protections', async()=>{ const sql=(await readFile(path.resolve('..','..','database','migrations','0001_init.sql'),'utf8')).toLowerCase(); for(const t of ['accounts','account_sessions','characters','character_stats','character_items','inventory','inn_storage','clans','bans','ip_bans','audit_log','server_state']) assert.match(sql,new RegExp(`create table oldko\\.${t}\\b`)); assert.match(sql,/serial bigint not null unique/); assert.match(sql,/for update/); assert.match(sql,/prevent_duplicate_item_placement/); });
