'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = __dirname;
const REPO_ROOT = path.resolve(ROOT, '..', '..');

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, name), 'utf8'));
}
function readRepoJson(repoPath) {
  const resolved = path.resolve(REPO_ROOT, repoPath);
  if (!resolved.startsWith(REPO_ROOT + path.sep)) throw new Error(`receipt escapes repo root: ${repoPath}`);
  return JSON.parse(fs.readFileSync(resolved, 'utf8'));
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])]));
  return value;
}
function stableStringify(value) {
  return JSON.stringify(stable(value));
}
function fingerprintCapability(capability) {
  const payload = {
    id: capability.id,
    semantic_version: capability.semantic_version,
    provider_ws: capability.provider_ws,
    contract: capability.contract
  };
  return `sha256:${crypto.createHash('sha256').update(stableStringify(payload)).digest('hex')}`;
}
function requiredFields(schema) {
  return Array.isArray(schema.required) ? schema.required : [];
}
function validateRequired(object, schema, label) {
  const errors = [];
  for (const field of requiredFields(schema)) {
    if (!Object.prototype.hasOwnProperty.call(object, field)) errors.push(`${label}: missing ${field}`);
  }
  return errors;
}
function validateRegistry(registry, schema = readJson('schema/registry.schema.json')) {
  const errors = validateRequired(registry, schema, 'registry');
  const wsIds = new Set(), capIds = new Set(), wsById = new Map();
  for (const ws of registry.workstreams || []) {
    for (const field of ['ws','branch','role','ownership_paths','handoff_location','provides','consumes','requires_protocol','requires_data']) {
      if (!Object.prototype.hasOwnProperty.call(ws, field)) errors.push(`${ws.ws || 'workstream'}: missing ${field}`);
    }
    if (wsIds.has(ws.ws)) errors.push(`duplicate workstream ${ws.ws}`);
    wsIds.add(ws.ws);
    wsById.set(ws.ws, ws);
  }
  for (const cap of registry.capabilities || []) {
    if (capIds.has(cap.id)) errors.push(`duplicate capability ${cap.id}`);
    capIds.add(cap.id);
    if (cap.provider_ws !== null && !wsById.has(cap.provider_ws)) errors.push(`${cap.id}: unknown provider ${cap.provider_ws}`);
    if (cap.contract_hash !== fingerprintCapability(cap)) errors.push(`${cap.id}: contract fingerprint mismatch`);
  }
  for (const ws of registry.workstreams || []) {
    for (const id of [...ws.provides, ...ws.consumes]) if (!capIds.has(id)) errors.push(`${ws.ws}: unknown capability ${id}`);
  }
  const roles = new Map((registry.authorities || []).map(a => [a.ws, a.kind]));
  if (roles.get('WS11') !== 'protocol') errors.push('WS11 must be protocol authority');
  if (roles.get('WS31') !== 'data') errors.push('WS31 must be data authority');
  return errors;
}
function validateSourceManifest(manifest, schema = readJson('schema/handoff-source-manifest.schema.json')) {
  const errors = validateRequired(manifest, schema, `manifest ${manifest.ws || '?'}`);
  for (const forbidden of ['source_head','source_sha','commit_sha','exact_commit_sha']) {
    if (Object.prototype.hasOwnProperty.call(manifest, forbidden)) errors.push(`${manifest.ws || 'manifest'}: forbidden manual ${forbidden}`);
  }
  return errors;
}
function validateReceipt(receipt, schema = readJson('schema/handoff-receipt.schema.json')) {
  const errors = validateRequired(receipt, schema, 'receipt');
  if (receipt.exact_commit_sha && !/^[0-9a-f]{40}$/.test(receipt.exact_commit_sha)) errors.push('receipt: exact_commit_sha must be 40 lowercase hex chars');
  if (receipt.provider_set_id !== undefined && (!receipt.provider_set_id || typeof receipt.provider_set_id !== 'string')) errors.push('receipt: provider_set_id required');
  return errors;
}
function validateBlocker(blocker, schema = readJson('schema/blocker.schema.json')) {
  const errors = validateRequired(blocker, schema, `blocker ${blocker.request_id || '?'}`);
  if (blocker.consumer && !/^WS\d{2}$/.test(blocker.consumer)) errors.push('blocker: consumer must be WSxx');
  if (blocker.owner && !/^WS\d{2}$/.test(blocker.owner)) errors.push('blocker: owner must be WSxx');
  if (!Array.isArray(blocker.evidence) || blocker.evidence.length === 0) errors.push('blocker: evidence required');
  if (blocker.provider_set !== 'WS50-C3') errors.push(`${blocker.request_id}: blocker must retain immutable WS50-C3 identity`);
  if (blocker.resolution) {
    if (blocker.resolution.status !== 'RESOLVED_BY_PROVIDER_CANDIDATE') errors.push(`${blocker.request_id}: invalid resolution status`);
    if (!/^[0-9a-f]{40}$/.test(blocker.resolution.exact_sha || '')) errors.push(`${blocker.request_id}: resolution exact_sha must be 40 lowercase hex chars`);
    if (blocker.resolution.set_inclusion !== 'NOT_IN_WS50_C3') errors.push(`${blocker.request_id}: provider candidate cannot claim inclusion in WS50-C3`);
  }
  return errors;
}
function loadProviderSetReceipt(providerSets, kind) {
  if (!['accepted','candidate'].includes(kind)) throw new Error(`unknown provider-set kind ${kind}`);
  const slot = providerSets[kind];
  if (!slot || slot.state !== 'AVAILABLE') return null;
  return readRepoJson(slot.receipt);
}
function providerSetBlockerIds(receipt) {
  const ids = new Set();
  for (const capability of Object.values(receipt?.capabilities || {})) {
    for (const blocker of capability.blockers || []) {
      if (blocker !== 'NOT_IN_BASELINE_SCOPE') ids.add(blocker);
    }
  }
  return [...ids].sort();
}
function validateProviderSets(doc) {
  const errors = [];
  if (doc.authority_ws !== 'WS50') errors.push('provider sets must be owned by WS50');
  if (!doc.source || !/^[0-9a-f]{40}$/.test(doc.source.exact_commit_sha || '')) errors.push('provider sets require exact WS50 source commit');
  for (const name of ['accepted','candidate']) {
    const slot = doc[name];
    if (!slot) { errors.push(`missing ${name}`); continue; }
    if (!['UNAVAILABLE','AVAILABLE'].includes(slot.state)) errors.push(`${name}: invalid state`);
    if (slot.state === 'AVAILABLE') {
      if (!slot.provider_set_id || !slot.receipt) errors.push(`${name}: available slot requires id and receipt`);
      else {
        try {
          const receipt = loadProviderSetReceipt(doc, name);
          if (receipt.set_id !== slot.provider_set_id) errors.push(`${name}: receipt set_id mismatch`);
          if (!receipt.immutable_key || !receipt.immutable_key.startsWith(`${slot.provider_set_id}@`)) errors.push(`${name}: invalid immutable_key`);
        } catch (error) {
          errors.push(`${name}: unreadable receipt ${error.message}`);
        }
      }
    }
    if (slot.state === 'UNAVAILABLE' && (slot.provider_set_id !== null || slot.receipt !== null)) errors.push(`${name}: unavailable slot must not carry identity`);
  }
  return errors;
}
function validateBlockerRouting(providerSets, blockers) {
  const errors = [];
  const candidate = loadProviderSetReceipt(providerSets, 'candidate');
  if (!candidate) return ['candidate receipt unavailable'];
  const canonical = providerSetBlockerIds(candidate);
  const central = (blockers.requests || []).filter(r => r.provider_set === candidate.set_id).map(r => r.request_id).sort();
  if (stableStringify(canonical) !== stableStringify(central)) {
    errors.push(`central blocker routing mismatch canonical=${canonical.join(',')} central=${central.join(',')}`);
  }
  return errors;
}
function providerCoordinate(providerSets, kind, ws) {
  const receipt = loadProviderSetReceipt(providerSets, kind);
  if (!receipt) return null;
  const provider = (receipt.providers || []).find(entry => entry.ws === ws);
  const authority =
    receipt.protocol_authority?.ws === ws ? receipt.protocol_authority :
    receipt.data_authority?.ws === ws ? receipt.data_authority :
    null;
  const source = provider || authority;
  return Object.freeze({
    provider_set_id: receipt.set_id,
    immutable_key: receipt.immutable_key,
    ws,
    exact_sha: source?.exact_sha || null,
    tested_implementation_sha: source?.tested_implementation_sha || null,
    present: Boolean(source),
    candidate_result: receipt.candidate_result
  });
}
function providerSetIdentity(providerSets, kind) {
  const receipt = loadProviderSetReceipt(providerSets, kind);
  if (!receipt) return null;
  return Object.freeze({
    kind: kind.toUpperCase(),
    provider_set_id: receipt.set_id,
    immutable_key: receipt.immutable_key,
    receipt: providerSets[kind].receipt,
    candidate_result: receipt.candidate_result,
    blockers: providerSetBlockerIds(receipt)
  });
}
function blockingRequestsFor(registry, blockers, wsId) {
  const ws = (registry.workstreams || []).find(entry => entry.ws === wsId);
  const consumed = new Set(ws?.consumes || []);
  return (blockers.requests || []).filter(request =>
    request.state === 'OPEN' &&
    (request.consumer === wsId || request.owner === wsId || consumed.has(request.capability))
  );
}
function authorityDependencies(registry, providerSets, blockers, ws) {
  const authorities = new Map((registry.authorities || []).map(a => [a.ws, a.kind]));
  const refs = [
    ...(ws.requires_protocol || []).map(ref => ({ relation:'protocol', ref })),
    ...(ws.requires_data || []).map(ref => ({ relation:'data', ref }))
  ];
  return refs.map(({relation, ref}) => {
    const [authority_ws, ...scopeParts] = ref.split(':');
    const scope = scopeParts.join(':');
    return {
      relation,
      authority_ws,
      authority_kind: authorities.get(authority_ws) || null,
      scope,
      accepted: providerCoordinate(providerSets, 'accepted', authority_ws),
      candidate: providerCoordinate(providerSets, 'candidate', authority_ws),
      blocker_ids: blockingRequestsFor(registry, blockers, ws.ws).filter(r => r.owner === authority_ws).map(r => r.request_id).sort()
    };
  });
}
function providerCandidateResolution(blockers, capabilityId) {
  const request = (blockers.requests || []).find(r => r.capability === capabilityId && r.resolution?.status === 'RESOLVED_BY_PROVIDER_CANDIDATE');
  if (!request) return null;
  return Object.freeze({
    blocker_id: request.request_id,
    status: request.resolution.status,
    provider_ws: request.resolution.provider_ws,
    exact_sha: request.resolution.exact_sha,
    branch_head_evidence_sha: request.resolution.branch_head_evidence_sha || null,
    ci_run_id: request.resolution.ci_run_id || null,
    set_inclusion: request.resolution.set_inclusion
  });
}
function discoverDependencies(registry, providerSets, blockers, wsId) {
  const ws = (registry.workstreams || []).find(entry => entry.ws === wsId);
  if (!ws) throw new Error(`unknown workstream ${wsId}`);
  const caps = new Map((registry.capabilities || []).map(c => [c.id, c]));
  return Object.freeze({
    ws: wsId,
    branch: ws.branch,
    accepted_provider_set: providerSetIdentity(providerSets, 'accepted'),
    candidate_provider_set: providerSetIdentity(providerSets, 'candidate'),
    direct_contracts: ws.consumes.map(id => {
      const cap = caps.get(id);
      return {
        capability: id,
        provider_ws: cap ? cap.provider_ws : null,
        contract_identity: cap ? { semantic_version: cap.semantic_version, contract_hash: cap.contract_hash } : null,
        accepted: cap?.provider_ws ? providerCoordinate(providerSets, 'accepted', cap.provider_ws) : null,
        candidate: cap?.provider_ws ? providerCoordinate(providerSets, 'candidate', cap.provider_ws) : null,
        provider_candidate_resolution: providerCandidateResolution(blockers, id),
        unresolved: !cap || cap.provider_ws === null
      };
    }),
    authority_dependencies: authorityDependencies(registry, providerSets, blockers, ws),
    blockers: blockingRequestsFor(registry, blockers, wsId)
  });
}
function buildWorkstreamEdges(registry) {
  const capById = new Map((registry.capabilities || []).map(c => [c.id, c])), edges = [];
  for (const consumer of registry.workstreams || []) {
    for (const capability of consumer.consumes || []) {
      const cap = capById.get(capability);
      if (cap && cap.provider_ws && cap.provider_ws !== consumer.ws) edges.push({provider:cap.provider_ws, consumer:consumer.ws, capability});
    }
  }
  return edges;
}
function impactAnalysis(registry, providerSets, blockers, capabilityId) {
  const cap = (registry.capabilities || []).find(entry => entry.id === capabilityId);
  if (!cap) throw new Error(`unknown capability ${capabilityId}`);
  const edges = buildWorkstreamEdges(registry);
  const direct = edges.filter(edge => edge.capability === capabilityId).map(edge => edge.consumer);
  const impacted = new Set(direct), queue = [...direct];
  while (queue.length) {
    const provider = queue.shift();
    for (const edge of edges.filter(e => e.provider === provider)) {
      if (edge.consumer !== cap.provider_ws && !impacted.has(edge.consumer)) {
        impacted.add(edge.consumer);
        queue.push(edge.consumer);
      }
    }
  }
  const scenarios = (registry.scenarios || []).filter(s => s.requires.includes(capabilityId)).map(s => s.id).sort();
  const replacement = providerCandidateResolution(blockers, capabilityId);
  return Object.freeze({
    capability: capabilityId,
    owner: cap.provider_ws,
    contract_identity: { semantic_version: cap.semantic_version, contract_hash: cap.contract_hash },
    accepted_provider: cap.provider_ws ? providerCoordinate(providerSets, 'accepted', cap.provider_ws) : null,
    candidate_provider: cap.provider_ws ? providerCoordinate(providerSets, 'candidate', cap.provider_ws) : null,
    replacement_provider_candidate: replacement,
    direct_consumers: [...new Set(direct)].sort(),
    impacted_workstreams: [...impacted].sort(),
    impacted_scenarios: scenarios,
    requires_new_ws50_candidate: Boolean(replacement && replacement.set_inclusion === 'NOT_IN_WS50_C3')
  });
}
function ownerInbox(blockers, owner) {
  return Object.freeze({
    owner,
    generated_from: 'contracts/pilot-moradon-visibility/blockers.json',
    requests: (blockers.requests || []).filter(request => request.owner === owner && request.state === 'OPEN')
  });
}
function loadAll() {
  return {
    registry: readJson('registry.json'),
    providerSets: readJson('provider-sets.json'),
    blockers: readJson('blockers.json'),
    manifests: readJson('source-manifests.json')
  };
}
if (require.main === module) {
  const [command, arg] = process.argv.slice(2);
  const {registry, providerSets, blockers} = loadAll();
  let result;
  if (command === 'dependencies') result = discoverDependencies(registry, providerSets, blockers, arg);
  else if (command === 'impact') result = impactAnalysis(registry, providerSets, blockers, arg);
  else if (command === 'inbox') result = ownerInbox(blockers, arg);
  else if (command === 'validate-routing') result = { errors: validateBlockerRouting(providerSets, blockers) };
  else {
    console.error('usage: node tooling.cjs dependencies WS16 | impact terrain.height-authority | inbox WS11 | validate-routing');
    process.exitCode = 2;
    return;
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
module.exports = {
  stableStringify,
  fingerprintCapability,
  validateRegistry,
  validateSourceManifest,
  validateReceipt,
  validateBlocker,
  validateProviderSets,
  validateBlockerRouting,
  providerSetBlockerIds,
  providerCoordinate,
  providerSetIdentity,
  discoverDependencies,
  impactAnalysis,
  ownerInbox,
  loadAll
};
