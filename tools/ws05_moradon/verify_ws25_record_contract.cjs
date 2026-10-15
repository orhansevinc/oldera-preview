#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const required = ['WS14_ROOT','WS16_ROOT','WS25_ROOT','WS14_MORADON_SMD','WS16_NPC_DATA','WS25_MOB_DATA','WS05_RECORD_CONTRACT_OUT'];
for (const key of required) if (!process.env[key]) throw new Error(`${key} is required`);

const worldApi = require(path.resolve(process.env.WS14_ROOT, 'services/ko1298-world/index.js'));
const ws16 = require(path.resolve(process.env.WS16_ROOT, 'services/ko1298-npc'));
const ws25 = require(path.resolve(process.env.WS25_ROOT, 'services/ko1298-mobs'));
const { createMoradonHeightResolver, createSharedNpcRuntimeIdNamespace } = worldApi;

const BANDICOOT_TEMPLATE_ID = 'ko1298:monster:850';
const BANDICOOT_PID = 800;
const resolver = createMoradonHeightResolver({ smdPath: process.env.WS14_MORADON_SMD });
const npcDocument = JSON.parse(fs.readFileSync(process.env.WS16_NPC_DATA, 'utf8'));
const mobDocument = JSON.parse(fs.readFileSync(process.env.WS25_MOB_DATA, 'utf8'));
const npcPopulation = ws16.materializeNpcPopulation(npcDocument, { heightAuthority: resolver });
if (npcPopulation.records.length !== 37) throw new Error(`expected 37 Moradon NPCs, got ${npcPopulation.records.length}`);

function runtimeNamespace() {
  return createSharedNpcRuntimeIdNamespace({
    minInclusive: ws25.RUNTIME_ID_CONTRACT.NPC_BAND,
    maxExclusive: ws25.RUNTIME_ID_CONTRACT.INVALID_BAND,
    reserved: npcPopulation.records,
  });
}

const definition = ws25.loadVerifiedWorldDefinition(mobDocument);
const terrain = { resolveHeight(zoneId, x, z) { return resolver.resolveHeight(Number(zoneId), x, z); } };
const visibilityService = new ws25.MobVisibilityService(definition, { terrain, runtimeIds: runtimeNamespace() });
const initializeResult = visibilityService.initialize(0);
const visibility = visibilityService.visibilitySnapshot();
if (initializeResult.length !== 135 || visibility.length !== 135) {
  throw new Error(`expected 135 Moradon mobs, initialize=${initializeResult.length} visibility=${visibility.length}`);
}

function isBandicoot(record) {
  return record?.detail?.template_id === BANDICOOT_TEMPLATE_ID && record?.detail?.pid === BANDICOOT_PID;
}

const bandicoots = visibility.filter(isBandicoot);
if (!bandicoots.length) throw new Error('public WS25 visibility contract produced no canonical Bandicoot SID=850 PID=800');
for (const record of bandicoots) {
  if (!Number.isInteger(record.runtimeId)) throw new Error('Bandicoot runtimeId is not integer');
  if (record.instanceId !== record.runtimeId || record.nid !== record.runtimeId || record.detail.runtime_id !== record.runtimeId) {
    throw new Error(`Bandicoot runtime identity aliases disagree for ${record.runtimeId}`);
  }
  if (![record.x, record.y, record.z, record.detail.x, record.detail.y, record.detail.z].every(Number.isFinite)) {
    throw new Error(`Bandicoot ${record.runtimeId} has non-finite authoritative XYZ`);
  }
  if (record.x !== record.detail.x || record.y !== record.detail.y || record.z !== record.detail.z) {
    throw new Error(`Bandicoot ${record.runtimeId} top-level/detail XYZ disagree`);
  }
  if (record.detail.template_id !== BANDICOOT_TEMPLATE_ID || record.detail.pid !== BANDICOOT_PID) {
    throw new Error(`Bandicoot ${record.runtimeId} semantic identity mismatch`);
  }
}

const selected = bandicoots[0];
const detail = visibilityService.detailSnapshot(selected.runtimeId);
const nearby = visibilityService.getNearby({ zoneId: 21, x: selected.x, z: selected.z });
if (!nearby.some((record) => record.runtimeId === selected.runtimeId)) {
  throw new Error(`getNearby omitted selected Bandicoot runtimeId=${selected.runtimeId}`);
}

const combatService = new ws25.MobCombatService(definition, { terrain, runtimeIds: runtimeNamespace() });
combatService.initialize(0);
const combat = combatService.getCombatSnapshot(selected.sourceIdentity);
if (combat.runtimeId !== selected.runtimeId) {
  throw new Error(`combat/visibility runtime identity mismatch ${combat.runtimeId} != ${selected.runtimeId}`);
}
if (combat.templateId !== BANDICOOT_TEMPLATE_ID || combat.zoneId !== '21' || !Number.isFinite(combat.position?.x)) {
  throw new Error('combat snapshot does not match canonical Bandicoot contract');
}

const keys = (value) => Object.keys(value || {}).sort();
const first = visibility.slice(0, 5);
const payload = {
  schema_version: 1,
  result: 'PASS',
  provider_pins: {
    ws14: process.env.WS14_PIN || null,
    ws16: process.env.WS16_PIN || null,
    ws25: process.env.WS25_PIN || null,
    ws31: process.env.WS31_PIN || null,
  },
  counts: { npc: npcPopulation.records.length, mob: visibility.length, bandicoot: bandicoots.length },
  public_contract: {
    initialize: {
      record_keys: keys(initializeResult[0]),
      note: 'MobVisibilityService.initialize() returns list() after authoritative height resolution and runtime-ID attachment.'
    },
    visibilitySnapshot: {
      record_keys: keys(visibility[0]),
      detail_keys: keys(visibility[0]?.detail),
      template_identity_field: 'detail.template_id',
      resource_identity_field: 'detail.pid',
      runtime_identity_fields: ['runtimeId','instanceId','nid','detail.runtime_id'],
      xyz_fields: ['x','y','z','detail.x','detail.y','detail.z']
    },
    detailSnapshot: { record_keys: keys(detail) },
    getNearby: {
      record_keys: keys(nearby[0]),
      semantics: 'visibilitySnapshot records in current/adjacent 48-unit regions, sorted by runtimeId'
    },
    getCombatSnapshot: {
      record_keys: keys(combat),
      position_keys: keys(combat.position),
      attack_keys: keys(combat.attack),
      defense_keys: keys(combat.defense)
    }
  },
  selector: {
    semantic_contract: 'visibilitySnapshot.detail',
    template_id: BANDICOOT_TEMPLATE_ID,
    sid: 850,
    pid: BANDICOOT_PID,
    pid_exposed_by_ws25: true,
    ws31_pid_mapping_required: false
  },
  selected_bandicoot: {
    runtimeId: selected.runtimeId,
    instanceId: selected.instanceId,
    nid: selected.nid,
    sourceIdentity: selected.sourceIdentity,
    templateId: selected.templateId,
    sid: 850,
    pid: selected.detail.pid,
    name: selected.detail.name,
    zoneId: selected.zoneId,
    x: selected.x,
    y: selected.y,
    z: selected.z
  },
  samples: {
    initialize_first_5: initializeResult.slice(0, 5),
    visibility_first_5: first,
    detail_first_5: first.map((record) => visibilityService.detailSnapshot(record.runtimeId)),
    nearby_first_5: nearby.slice(0, 5),
    combat_selected_bandicoot: combat
  }
};

const out = path.resolve(process.env.WS05_RECORD_CONTRACT_OUT);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(payload, null, 2) + '\n');
console.log(`WS05_WS25_RECORD_CONTRACT PASS mobs=${visibility.length} bandicoots=${bandicoots.length} runtimeId=${selected.runtimeId} out=${out}`);
