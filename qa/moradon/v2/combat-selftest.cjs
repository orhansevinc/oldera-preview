'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { proveCombat } = require('./verify-combat-evidence.cjs');
const { assessCombatReadiness } = require('./combat-readiness.cjs');
const { computeContentHash } = require('./lock-provider-set.cjs');

const key = 'WS50-C6@sha256:' + 'c'.repeat(64);
const rows = [
  {event:'provider_set', immutableKey:key},
  {event:'browser_input', action:'target-select', actionId:'target-1', source:'playwright.mouse'},
  {event:'native_hit_test', actionId:'target-1', targetRuntimeId:21001},
  {event:'native_current_target', actionId:'target-1', targetRuntimeId:21001},
  {event:'target_hp_ui', actionId:'target-1', phase:'selected', targetRuntimeId:21001, hp:100, maxHp:100},
  {event:'server_target', actionId:'target-1', actorRuntimeId:9001, targetRuntimeId:21001},
  {event:'browser_input', action:'normal-attack', actionId:'attack-1', source:'playwright.keyboard'},
  {event:'c2s_packet', actionId:'attack-1', opcode:'0x08', actorRuntimeId:9001, targetRuntimeId:21001, wireHex:'080123'},
  {event:'server_combat_result', actionId:'attack-1', actorRuntimeId:9001, targetRuntimeId:21001, hpBefore:100, hpAfter:88},
  {event:'s2c_packet', actionId:'attack-1', opcode:'0x08', authority:'WS11', wireHex:'080456'},
  {event:'client_attack_state', actionId:'attack-1', actorRuntimeId:9001, targetRuntimeId:21001, animation:'attack'},
  {event:'target_hp_ui', actionId:'attack-1', phase:'after-normal', targetRuntimeId:21001, hp:88, maxHp:100},
  {event:'skill_ui', native:true, available:true, skillId:101003, iconRef:'ui/skill_101003.dxt'},
  {event:'browser_input', action:'active-skill', actionId:'skill-1', source:'playwright.keyboard'},
  {event:'c2s_packet', actionId:'skill-1', opcode:'0x31', actorRuntimeId:9001, targetRuntimeId:21001, skillId:101003, wireHex:'31010203'},
  {event:'server_skill_result', actionId:'skill-1', actorRuntimeId:9001, targetRuntimeId:21001, skillId:101003, mpBefore:80, mpAfter:70, hpBefore:88, hpAfter:60, effectApplied:true},
  {event:'s2c_packet', actionId:'skill-1', opcode:'0x31', authority:'WS11', wireHex:'31040506'},
  {event:'client_skill_effect', actionId:'skill-1', targetRuntimeId:21001, skillId:101003, effect:'hit'},
  {event:'resource_ui', actionId:'skill-1', resource:'mp', before:80, after:70},
  {event:'target_effect', actionId:'skill-1', targetRuntimeId:21001, hpBefore:88, hpAfter:60, effectApplied:true},
  {event:'mob_retaliation', actorRuntimeId:21001, targetRuntimeId:9001},
  {event:'server_death', targetRuntimeId:21001, outRequired:true},
  {event:'client_death_state', targetRuntimeId:21001, animation:'death'},
  {event:'target_attackable', targetRuntimeId:21001, attackable:false},
  {event:'entity_out', targetRuntimeId:21001},
  {event:'server_respawn', targetRuntimeId:21001, respawnId:'r1'},
  {event:'entity_in', targetRuntimeId:21001, respawnId:'r1'},
  {event:'respawn_visible', targetRuntimeId:21001, respawnId:'r1', humanVisible:true},
];
const log = rows.map((r) => `WS10_COMBAT_OBS ${JSON.stringify(r)}`).join('\n');
const proof = proveCombat({ serverLog:log, driverLog:'', expectedProviderSet:key });
assert.equal(proof.targetRuntimeId,21001); assert.equal(proof.realBrowserInputOnly,true);
const expectFail = (mutator, pattern) => {
  const changed = rows.map((r) => ({...r})); mutator(changed);
  assert.throws(() => proveCombat({serverLog:changed.map((r)=>`WS10_COMBAT_OBS ${JSON.stringify(r)}`).join('\n'), driverLog:'', expectedProviderSet:key}), pattern);
};
expectFail((r)=>{r.find((x)=>x.event==='native_current_target').targetRuntimeId=21002;}, /native target runtime ID/);
expectFail((r)=>{r.find((x)=>x.event==='browser_input'&&x.action==='normal-attack').source='js.game-method';}, /non-native/);
expectFail((r)=>{const x=r.find((e)=>e.event==='server_combat_result');x.hpAfter=x.hpBefore;}, /did not decrease/);
expectFail((r)=>{r.splice(r.findIndex((e)=>e.event==='skill_ui'),1);}, /skill UI/);
expectFail((r)=>{r.push({event:'server_death',targetRuntimeId:21001,outRequired:true});}, /exactly once/);

const manifest={schema_version:'ws50-provider-set/v1',set_id:'WS50-C6',candidate_result:'PASS',feature_profile:['moradon_playable_combat'],providers:['WS03','WS11','WS19','WS25','WS31'].map((ws,i)=>({ws,branch:ws.toLowerCase(),exact_sha:String(i+1).repeat(40)})),capabilities:{}};
for(const name of ['playable_targeting','playable_normal_attack','target_hp_surface','playable_active_skill','mob_death_respawn']) manifest.capabilities[name]={DOMAIN_READY:true,CONTRACT_READY:true,PROTOCOL_READY:true,COMPOSITION_READY:true};
manifest.content_hash=computeContentHash(manifest);manifest.immutable_key=`WS50-C6@${manifest.content_hash}`;
assert.equal(assessCombatReadiness(manifest,manifest.immutable_key).status,'PREPARED');
const missing=structuredClone(manifest);missing.providers=missing.providers.filter((p)=>p.ws!=='WS19');missing.content_hash=computeContentHash(missing);missing.immutable_key=`WS50-C6@${missing.content_hash}`;
assert.equal(assessCombatReadiness(missing,missing.immutable_key).status,'BLOCKED');

const inputSource=fs.readFileSync(path.join(__dirname,'real-browser-input.cjs'),'utf8');
for(const forbidden of ['page.evaluate(', 'ccall(', 'cwrap(', 'Module._', 'applyDamage(', 'injectDamage', 'hp =']) assert.equal(inputSource.includes(forbidden),false,`forbidden input helper token: ${forbidden}`);
console.log('WS10_PLAYABLE_COMBAT_HARNESS_SELFTEST PASS target-correlation=fail-closed attack-skill-death=correlated real-input-only=1 readiness=blocked-when-incomplete');
