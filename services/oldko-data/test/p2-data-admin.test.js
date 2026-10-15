import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PgP2DataAdminRepository, assertRuntimeConfigKey, isRealApplyProof, projectServerStatus } from '../src/adapters/p2-data-admin.js';

test('P2-11 common repository surface is exported and rejects secret-bearing runtime keys', () => {
  assert.equal(typeof PgP2DataAdminRepository, 'function');
  assert.equal(assertRuntimeConfigKey('world.event.rate'), 'world.event.rate');
  for (const key of ['smtp_password','API-TOKEN','private_key','credential.mail']) assert.throws(() => assertRuntimeConfigKey(key), /secret-bearing/);
});

test('admin command success requires runtime applied proof, not DB status alone', () => {
  assert.equal(isRealApplyProof({ status:'ok', forwarded:true, applied:true }), true);
  assert.equal(isRealApplyProof({ status:'ok', forwarded:true, data:{ applied:true } }), true);
  assert.equal(isRealApplyProof({ status:'ok', forwarded:true }), false);
  assert.equal(isRealApplyProof({ status:'succeeded', applied:true }), false);
  assert.equal(isRealApplyProof({ status:'ok', forwarded:false, applied:true }), false);
});

test('server status never invents online state or player count from stale/missing heartbeat', () => {
  const now = Date.parse('2026-10-15T19:00:00Z');
  assert.deepEqual(projectServerStatus(null,{now,maxAgeMs:30000}), {
    availability:'offline',online:false,maintenance:false,population:'unknown',stale:true,lastHeartbeat:null,
  });
  const fresh = projectServerStatus({ realm_id:'oldko',availability:'online',player_count:17,last_heartbeat:'2026-10-15T18:59:50Z' },{now,maxAgeMs:30000});
  assert.equal(fresh.online,true); assert.equal(fresh.onlinePlayerCount,17); assert.equal(fresh.stale,false);
  const stale = projectServerStatus({ realm_id:'oldko',availability:'online',player_count:999,last_heartbeat:'2026-10-15T18:00:00Z' },{now,maxAgeMs:30000});
  assert.equal(stale.online,false); assert.equal(stale.availability,'offline'); assert.equal('onlinePlayerCount' in stale,false); assert.equal(stale.stale,true);
});

test('0005 folds service-owned persistence into one canonical additive migration', async () => {
  const root = path.resolve('..','..','database','migrations');
  const sql = (await readFile(path.join(root,'0005_phase2_data_admin.sql'),'utf8')).toLowerCase();
  for (const table of ['account_rate_limits','character_quests','boss_runtime_state','runtime_config','runtime_config_apply_receipts','server_runtime_heartbeats','runtime_content_observations','admin_runtime_command_confirmations']) {
    assert.match(sql,new RegExp(`create table(?: if not exists)? oldko\\.${table}\\b`),table);
  }
  assert.doesNotMatch(sql,/\bbegin\s*;/);
  assert.doesNotMatch(sql,/\bcommit\s*;/);
});

test('legacy WS13 migration command is verification-only and NullDelivery is fail-closed', async () => {
  const rateScript = await readFile(path.resolve('..','account-api','src','scripts','apply-rate-limit-schema.js'),'utf8');
  assert.match(rateScript,/canonical P2-11 migration ledger/);
  assert.doesNotMatch(rateScript,/readFile\(/);
  const delivery = await readFile(path.resolve('..','account-api','src','delivery.js'),'utf8');
  assert.match(delivery,/class NullDelivery/);
  assert.match(delivery,/Verification delivery is not configured/);
  assert.match(delivery,/Password reset delivery is not configured/);
});
