import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, withTransaction } from '../src/index.js';
import * as adapters from '../src/adapters/index.js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

test('passwords are salted scrypt hashes', async()=>{
  const h=await hashPassword('development-only-password');
  assert.match(h,/^scrypt\$/); assert.equal(h.includes('development-only-password'),false);
  assert.equal(await verifyPassword('development-only-password',h),true);
  assert.equal(await verifyPassword('wrong-password',h),false);
});

test('transaction retries serialization failure and rolls back failed attempt', async()=>{
  let attempt=0; const logs=[];
  const pool={connect:async()=>({query:async sql=>{logs.push(String(sql));return{rows:[],rowCount:0}},release:()=>logs.push('RELEASE')})};
  const value=await withTransaction(pool,async()=>{attempt++;if(attempt===1){const e=new Error('retry');e.code='40001';throw e;}return 7;},{maxRetries:1});
  assert.equal(value,7); assert.ok(logs.includes('ROLLBACK')); assert.ok(logs.includes('COMMIT'));
});

test('production adapter surface is separated by consumer workstream',()=>{
  for(const name of ['PgWs03SessionRepository','PgAccountSessionRepository','PgWs14WorldRepository','PgWs17ItemRepository','PgEconomyTransactionManager','PgCoinRepository','PgTradeRepository','PgWs27ProgressionRepository','PgWs45LeaseStore','PgWs46CharacterLifecycleRepository','PgOperationReceiptRepository']) assert.equal(typeof adapters[name],'function',name);
});

test('migrations declare persistence hardening without editing baseline semantics',async()=>{
  const root=path.resolve('..','..','database','migrations');
  const one=(await readFile(path.join(root,'0001_init.sql'),'utf8')).toLowerCase();
  const two=(await readFile(path.join(root,'0002_persistence_hardening.sql'),'utf8')).toLowerCase();
  for(const table of ['accounts','account_sessions','characters','character_stats','inventory','inn_storage','audit_log']) assert.match(one,new RegExp(`create table oldko\\.${table}\\b`));
  for(const table of ['economy_trades','economy_trade_participants','session_leases','persistence_operations']) assert.match(two,new RegExp(`create table oldko\\.${table}\\b`));
  assert.match(two,/accounts_guard_hard_delete/); assert.match(two,/character_items_slot_ck/); assert.match(two,/inventory_slot_ck/);
  assert.match(two,/economy_trade_one_active_per_character_uq/); assert.match(two,/progression_version/); assert.match(two,/world_version/);
});

test('development seed contains no hardcoded password or personal demo account',async()=>{
  const seed=await readFile(path.resolve('src','scripts','seed-dev.js'),'utf8');
  assert.match(seed,/OLDKO_DEV_SEED_PASSWORD/); assert.doesNotMatch(seed,/osevinc/i); assert.doesNotMatch(seed,/password\s*=\s*['"][^'"]+['"]/i);
});
