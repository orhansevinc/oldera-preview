'use strict';

const fs = require('node:fs');
const path = require('node:path');

const serverPath = process.argv[2];
const driverPath = process.argv[3];
const outPath = process.argv[4] || 'artifacts/moradon/visibility-proof.json';
if (!serverPath || !driverPath) throw new Error('usage: verify-visibility-evidence.cjs <server.log> <driver.log> [out.json]');
const server = fs.readFileSync(serverPath, 'utf8');
const driver = fs.readFileSync(driverPath, 'utf8');
const expectedSet = 'WS50-C5@sha256:7ac3b8a4c06b67e52b8d18518ef8c82209a60c6101c33609a4c16e64d84f119e';
if (!server.includes(`WS10_AUTH provider_set=${expectedSet}`)) throw new Error('server did not consume exact C5 provider set');

function authIds(kind) {
  const ids = new Set();
  const re = new RegExp(`WS10_AUTH type=${kind} id=(\\d+)`, 'g');
  for (const match of server.matchAll(re)) ids.add(Number(match[1]));
  if (!ids.size) throw new Error(`no authoritative ${kind} IDs in source-backed overlap region`);
  return ids;
}
function stageIds(stage, extra = null) {
  const ids = new Set();
  const re = new RegExp(`WS10_VISIBILITY ${stage} id=(\\d+)([^\\n]*)`, 'g');
  for (const match of driver.matchAll(re)) {
    if (!extra || match[2].includes(extra)) ids.add(Number(match[1]));
  }
  return ids;
}
function intersection(...sets) {
  const [first, ...rest] = sets;
  return [...first].filter((id) => rest.every((set) => set.has(id)));
}

const npc = authIds('npc');
const mob = authIds('mob');
const detail = stageIds('DETAIL_RECORD');
const entity = stageIds('ENTITY_CREATE');
const model = stageIds('MODEL_READY', 'source=authority');
const rendered = stageIds('RENDERED');
const npcPass = intersection(npc, detail, entity, model, rendered);
const mobPass = intersection(mob, detail, entity, model, rendered);
if (!npcPass.length) throw new Error('no authoritative real NPC reached DETAIL_RECORD -> ENTITY_CREATE -> MODEL_READY(authority) -> RENDERED');
if (!mobPass.length) throw new Error('no authoritative real mob reached DETAIL_RECORD -> ENTITY_CREATE -> MODEL_READY(authority) -> RENDERED');

const requestLine = server.split(/\r?\n/).find((line) => line.includes('WS10_AUTH event=client-detail-request') && /npc=\d/.test(line) && /mob=\d/.test(line));
if (!requestLine) throw new Error('real client did not request mixed NPC+mob details from unified 0x1C');
const regionLine = server.split(/\r?\n/).find((line) => line.includes('WS10_AUTH event=region-list') && /npc=\d/.test(line) && /mob=\d/.test(line));
if (!regionLine) throw new Error('server did not emit unified real NPC+mob 0x1C region list');

const starts = [...server.matchAll(/WS10_COMPOSE event=game-rx opcode=0x0d/g)].map((m) => m.index);
const moves = [...server.matchAll(/WS10_AUTH event=browser-movement/g)].map((m) => m.index);
if (!moves.length || !starts.length || !moves.some((index) => index > starts.at(-1))) {
  throw new Error('real browser movement packet was not observed after world bootstrap');
}
if (!driver.includes('WS10_VISIBILITY_CAPTURE_OK')) throw new Error('post-visibility native framebuffer capture missing');
if (!driver.includes('WS10_MORADON_E2E_PASS')) throw new Error('browser E2E did not pass');

const proof = {
  schema_version: 'ws10-c5-real-browser-visibility/v1',
  provider_set: expectedSet,
  result: 'PASS',
  synthetic_entities: false,
  client: 'real KO1298 C++/Emscripten/WASM/WebGL2',
  network: { unified_0x1c: true, client_0x1d_mixed_request: true, server_0x1d_detail: true },
  client_boundaries: { parse: true, entity_create: true, model_asset_authority: true, render: true },
  movement: true,
  real_npc_rendered_ids: npcPass,
  real_mob_rendered_ids: mobPass,
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(proof, null, 2)}\n`);
console.log(`WS10_C5_REAL_VISIBILITY_PASS npc=${npcPass.join(',')} mob=${mobPass.join(',')}`);
