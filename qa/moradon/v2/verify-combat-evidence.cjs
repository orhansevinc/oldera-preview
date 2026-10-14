'use strict';
const fs = require('node:fs');

function fail(message) { throw new Error(message); }
function events(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const at = line.indexOf('WS10_COMBAT_OBS ');
    if (at < 0) continue;
    try { out.push(JSON.parse(line.slice(at + 'WS10_COMBAT_OBS '.length))); }
    catch { fail(`invalid WS10_COMBAT_OBS JSON: ${line}`); }
  }
  return out;
}
function one(rows, predicate, label) {
  const found = rows.filter(predicate);
  if (found.length !== 1) fail(`${label}: expected exactly one, got ${found.length}`);
  return found[0];
}
function atLeastOne(rows, predicate, label) {
  const found = rows.filter(predicate);
  if (!found.length) fail(`${label}: missing`);
  return found[0];
}
function same(expected, actual, label) { if (expected !== actual) fail(`${label}: expected=${expected} actual=${actual}`); }
function positiveInt(value, label) { if (!Number.isInteger(value) || value <= 0) fail(`${label}: positive integer required`); }
function nativeInput(row, label) {
  if (!row || !['playwright.mouse', 'playwright.keyboard'].includes(row.source)) fail(`${label}: non-native/test input source`);
}

function proveCombat({ serverLog, driverLog, expectedProviderSet }) {
  const all = events(`${serverLog}\n${driverLog}`);
  if (!all.length) fail('no combat observability evidence');
  const binding = atLeastOne(all, (e) => e.event === 'provider_set', 'provider set binding');
  same(expectedProviderSet, binding.immutableKey, 'provider set');

  const targetInput = one(all, (e) => e.event === 'browser_input' && e.action === 'target-select', 'target browser input');
  nativeInput(targetInput, 'target browser input');
  const targetAction = targetInput.actionId;
  const hit = one(all, (e) => e.event === 'native_hit_test' && e.actionId === targetAction, 'native hit test');
  const nativeTarget = one(all, (e) => e.event === 'native_current_target' && e.actionId === targetAction, 'native current target');
  const hpBefore = one(all, (e) => e.event === 'target_hp_ui' && e.actionId === targetAction && e.phase === 'selected', 'target HP UI');
  const serverTarget = one(all, (e) => e.event === 'server_target' && e.actionId === targetAction, 'server target');
  const target = hit.targetRuntimeId;
  positiveInt(target, 'target runtime ID');
  same(target, nativeTarget.targetRuntimeId, 'native target runtime ID');
  same(target, hpBefore.targetRuntimeId, 'target HP UI runtime ID');
  same(target, serverTarget.targetRuntimeId, 'server target runtime ID');
  positiveInt(serverTarget.actorRuntimeId, 'actor runtime ID');
  const actor = serverTarget.actorRuntimeId;
  if (!(hpBefore.hp >= 0 && hpBefore.maxHp > 0 && hpBefore.hp <= hpBefore.maxHp)) fail('selected target HP UI invalid');

  const normalInput = one(all, (e) => e.event === 'browser_input' && e.action === 'normal-attack', 'normal attack browser input');
  nativeInput(normalInput, 'normal attack browser input');
  const normal = normalInput.actionId;
  const c2s = one(all, (e) => e.event === 'c2s_packet' && e.actionId === normal && e.opcode === '0x08', 'WIZ_ATTACK C2S');
  same(actor, c2s.actorRuntimeId, 'attack actor'); same(target, c2s.targetRuntimeId, 'attack target');
  if (!/^[0-9a-f]+$/i.test(c2s.wireHex || '')) fail('WIZ_ATTACK exact wireHex missing');
  const normalServer = one(all, (e) => e.event === 'server_combat_result' && e.actionId === normal, 'server normal result');
  same(actor, normalServer.actorRuntimeId, 'normal result actor'); same(target, normalServer.targetRuntimeId, 'normal result target');
  if (!(normalServer.hpAfter < normalServer.hpBefore)) fail('normal attack did not decrease authoritative target HP');
  const normalS2c = atLeastOne(all, (e) => e.event === 's2c_packet' && e.actionId === normal && e.authority === 'WS11', 'normal attack exact S2C');
  if (!/^[0-9a-f]+$/i.test(normalS2c.wireHex || '')) fail('normal attack exact S2C wireHex missing');
  atLeastOne(all, (e) => e.event === 'client_attack_state' && e.actionId === normal && e.actorRuntimeId === actor && e.targetRuntimeId === target, 'client attack animation/state');
  const normalHpUi = atLeastOne(all, (e) => e.event === 'target_hp_ui' && e.actionId === normal && e.phase === 'after-normal' && e.targetRuntimeId === target, 'normal target HP UI delta');
  if (!(normalHpUi.hp < hpBefore.hp)) fail('native target HP UI did not decrease after normal attack');

  const skillUi = atLeastOne(all, (e) => e.event === 'skill_ui' && e.native === true && e.available === true && Number.isInteger(e.skillId) && e.iconRef, 'native available skill UI');
  const skillInput = one(all, (e) => e.event === 'browser_input' && e.action === 'active-skill', 'skill browser input');
  nativeInput(skillInput, 'skill browser input');
  const skill = skillInput.actionId;
  const magicC2s = one(all, (e) => e.event === 'c2s_packet' && e.actionId === skill && e.opcode === '0x31', 'WIZ_MAGIC_PROCESS C2S');
  same(skillUi.skillId, magicC2s.skillId, 'skill ID'); same(actor, magicC2s.actorRuntimeId, 'skill actor'); same(target, magicC2s.targetRuntimeId, 'skill target');
  if (!/^[0-9a-f]+$/i.test(magicC2s.wireHex || '')) fail('WIZ_MAGIC_PROCESS wireHex missing');
  const skillServer = one(all, (e) => e.event === 'server_skill_result' && e.actionId === skill, 'server skill result');
  same(skillUi.skillId, skillServer.skillId, 'server skill ID'); same(target, skillServer.targetRuntimeId, 'server skill target');
  if (!(skillServer.mpAfter < skillServer.mpBefore)) fail('authoritative mana/resource did not decrease');
  if (!(skillServer.hpAfter < skillServer.hpBefore) && !skillServer.effectApplied) fail('skill changed neither HP nor effect');
  const magicS2c = atLeastOne(all, (e) => e.event === 's2c_packet' && e.actionId === skill && e.opcode === '0x31' && e.authority === 'WS11', 'WIZ_MAGIC_PROCESS S2C');
  if (!/^[0-9a-f]+$/i.test(magicS2c.wireHex || '')) fail('WIZ_MAGIC_PROCESS S2C wireHex missing');
  atLeastOne(all, (e) => e.event === 'client_skill_effect' && e.actionId === skill && e.skillId === skillUi.skillId && e.targetRuntimeId === target, 'client skill effect');
  const resourceUi = atLeastOne(all, (e) => e.event === 'resource_ui' && e.actionId === skill, 'native resource UI');
  if (!(resourceUi.after < resourceUi.before)) fail('native mana/resource UI did not decrease');
  atLeastOne(all, (e) => e.event === 'target_effect' && e.actionId === skill && e.targetRuntimeId === target && (e.hpAfter < e.hpBefore || e.effectApplied), 'target skill effect/HP');

  const deaths = all.filter((e) => e.event === 'server_death' && e.targetRuntimeId === target);
  if (deaths.length !== 1) fail(`server death exactly once required, got ${deaths.length}`);
  const death = deaths[0];
  atLeastOne(all, (e) => e.event === 'client_death_state' && e.targetRuntimeId === target, 'client death state/animation');
  atLeastOne(all, (e) => e.event === 'target_attackable' && e.targetRuntimeId === target && e.attackable === false, 'target no longer attackable');
  if (death.outRequired === true) atLeastOne(all, (e) => e.event === 'entity_out' && e.targetRuntimeId === target, 'death OUT');
  const respawn = atLeastOne(all, (e) => e.event === 'server_respawn' && e.targetRuntimeId === target, 'server respawn');
  atLeastOne(all, (e) => e.event === 'entity_in' && e.targetRuntimeId === target && e.respawnId === respawn.respawnId, 'respawn IN');
  atLeastOne(all, (e) => e.event === 'respawn_visible' && e.targetRuntimeId === target && e.respawnId === respawn.respawnId && e.humanVisible === true, 'respawn human-visible');

  const retaliation = all.some((e) => e.event === 'mob_retaliation' && e.actorRuntimeId === target && e.targetRuntimeId === actor);
  return {
    schema: 'oldkoweb.ws10.playable-combat-proof.v1', result: 'PASS', providerSet: expectedProviderSet,
    actorRuntimeId: actor, targetRuntimeId: target, normalAttackActionId: normal, skillActionId: skill,
    skillId: skillUi.skillId, mobRetaliationObserved: retaliation, serverDeathExactlyOnce: true, realBrowserInputOnly: true,
  };
}

if (require.main === module) {
  const [serverPath, driverPath, expectedProviderSet, outputPath] = process.argv.slice(2);
  if (!serverPath || !driverPath || !expectedProviderSet) process.exit(64);
  try {
    const proof = proveCombat({ serverLog: fs.readFileSync(serverPath, 'utf8'), driverLog: fs.readFileSync(driverPath, 'utf8'), expectedProviderSet });
    if (outputPath) fs.writeFileSync(outputPath, `${JSON.stringify(proof, null, 2)}\n`);
    console.log(`WS10_PLAYABLE_COMBAT_GATE PASS target=${proof.targetRuntimeId} skill=${proof.skillId}`);
  } catch (error) {
    console.error(`WS10_PLAYABLE_COMBAT_GATE FAIL ${error.message}`); process.exit(1);
  }
}
module.exports = { proveCombat };
