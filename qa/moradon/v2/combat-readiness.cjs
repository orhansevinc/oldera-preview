'use strict';
const fs = require('node:fs');
const { lockProviderSet } = require('./lock-provider-set.cjs');

const REQUIRED_PROVIDERS = ['WS03', 'WS11', 'WS19', 'WS25', 'WS31'];
const REQUIRED_CAPABILITIES = [
  'playable_targeting',
  'playable_normal_attack',
  'target_hp_surface',
  'playable_active_skill',
  'mob_death_respawn',
];

function assessCombatReadiness(document, immutableKey) {
  const lock = lockProviderSet(document, immutableKey);
  const blockers = [];
  for (const ws of REQUIRED_PROVIDERS) if (!lock.providers[ws]) blockers.push(`MISSING_PROVIDER_${ws}`);
  if (!Array.isArray(document.feature_profile) || !document.feature_profile.includes('moradon_playable_combat')) {
    blockers.push('MISSING_FEATURE_moradon_playable_combat');
  }
  for (const name of REQUIRED_CAPABILITIES) {
    const cap = document.capabilities?.[name];
    if (!cap) { blockers.push(`MISSING_CAPABILITY_${name}`); continue; }
    for (const phase of ['DOMAIN_READY', 'CONTRACT_READY', 'PROTOCOL_READY', 'COMPOSITION_READY']) {
      if (cap[phase] !== true) blockers.push(`${name}:${phase}`);
    }
  }
  return {
    schema: 'oldkoweb.ws10.combat-readiness.v1',
    immutableKey,
    status: blockers.length ? 'BLOCKED' : 'PREPARED',
    blockers,
    realBrowserInputOnly: true,
  };
}

if (require.main === module) {
  const [manifestPath, immutableKey, outputPath] = process.argv.slice(2);
  if (!manifestPath || !immutableKey) process.exit(64);
  try {
    const result = assessCombatReadiness(JSON.parse(fs.readFileSync(manifestPath, 'utf8')), immutableKey);
    const text = `${JSON.stringify(result, null, 2)}\n`;
    if (outputPath) fs.writeFileSync(outputPath, text); else process.stdout.write(text);
    console.error(`WS10_COMBAT_READINESS ${result.status} blockers=${result.blockers.join(',') || 'none'}`);
    process.exitCode = result.status === 'BLOCKED' ? 2 : 0;
  } catch (error) {
    console.error(`WS10_COMBAT_READINESS FAIL ${error.message}`);
    process.exit(1);
  }
}
module.exports = { assessCombatReadiness };
