#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');

const SHA40 = /^[0-9a-f]{40}$/i;
const CORE_OWNERS = ['WEBSITE','WS13','WS07','WS03','WS08','WS09','WS10','WS50'];
const KNOWN_BRANCHES = {
  WEBSITE: 'official-site-domain-release', WS03: 'ws03-ko1298-session', WS07: 'ws07-database',
  WS08: 'ws08-admin-api', WS09: 'ws09-production-infra', WS10: 'ws10-qa-integration',
  WS12: 'ws12-launcher', WS13: 'ws13-account-api', WS45: 'ws45-session-ownership',
  WS50: 'ws50-integration-rehearsal'
};
const CONTRACT_KEYS = [
  'contracts','api_contract_references','credential_contract_summary','api_contract_summary',
  'delivery_contract_summary','production_dependencies','persistence_contract','credential_contract',
  'adapter_contract','adapter_contracts','auth_contract','api_contract','command_contract',
  'frontend_owner_contract','ws09_required_config','migration_plan','production','automation',
  'tested_release','deployment','release_pointer','launcher_contract','play_contract'
];
const BAD_STATES = new Set([
  'INCOMPATIBLE','STALE_CONSUMER','RECONCILIATION_REQUIRED','MISSING_PROVIDER',
  'MISSING_REQUIRED_INPUT','SOURCE_INVALID','SCHEMA_INVALID'
]);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])]));
  }
  return value;
}
function canonicalJson(value) { return JSON.stringify(stable(value)); }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function asArray(value) { return value == null ? [] : Array.isArray(value) ? value : [value]; }
function deepGet(obj, dotted) { return dotted.split('.').reduce((v,k)=>v && v[k], obj); }
function deepText(value) {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(deepText).join(' ');
  return Object.values(value).map(deepText).join(' ');
}
function basenameOwner(file) { return path.basename(file || '', path.extname(file || '')).toUpperCase(); }
function normalizeOwner(raw, file) {
  const candidate = raw.workstream || raw.owner || basenameOwner(file);
  if (candidate === 'official website frontend' || candidate === 'official-site-domain-release') return 'WEBSITE';
  return String(candidate || basenameOwner(file)).toUpperCase();
}
function branchFor(owner, raw) { return raw.branch || KNOWN_BRANCHES[owner] || null; }
function evidenceFor(raw) {
  const out = {};
  for (const key of ['ci','checks','acceptance_run','automation','tested_release','artifacts']) if (raw[key] != null) out[key] = raw[key];
  return out;
}
function contractsFor(raw) {
  const out = {};
  for (const key of CONTRACT_KEYS) if (raw[key] != null) out[key] = raw[key];
  return out;
}
function hasAny(obj) { return obj && typeof obj === 'object' && Object.keys(obj).length > 0; }
function inputPinFor(raw, provider) {
  const pins = raw.input_pins || {};
  const names = [provider, provider.toLowerCase(), provider.replace(/^WS/,'ws')];
  for (const name of names) {
    if (!(name in pins)) continue;
    const v = pins[name];
    if (typeof v === 'string' && SHA40.test(v)) return v;
    if (v && typeof v === 'object') {
      for (const key of ['source_commit','commit','head','ws13_head','ws07_commit','ws08_source_commit','frozen_ws03_commit']) {
        if (SHA40.test(String(v[key] || ''))) return v[key];
      }
    }
  }
  const text = JSON.stringify(pins);
  const m = text.match(new RegExp(`(?:${provider}|${provider.toLowerCase()})[^0-9a-f]{0,40}([0-9a-f]{40})`, 'i'));
  return m ? m[1] : null;
}
function testedAtSource(raw, source) {
  const candidates = [
    deepGet(raw,'ci.head_sha'), deepGet(raw,'ci.run_head'), deepGet(raw,'checks.run_head'),
    deepGet(raw,'checks.domain_live_head'), deepGet(raw,'acceptance_run.head_sha')
  ];
  for (const item of asArray(raw.checks)) candidates.push(item && (item.tested_sha || item.commit || item.head_sha));
  return candidates.some(v => v === source);
}

function normalizeBlocker(item, consumerOwner) {
  if (typeof item === 'string') {
    return { code: item.match(/^[A-Z0-9_]{5,}$/) ? item : `TEXT_${sha256(item).slice(0,12).toUpperCase()}`,
      owner: null, detail: item, consumer: consumerOwner, class: classifyBlocker(item) };
  }
  const detail = item.detail || item.required || item.required_action || item.evidence || deepText(item.items || item.steps || '');
  const code = item.code || item.id || item.request_id || `BLOCKER_${sha256(canonicalJson(item)).slice(0,12).toUpperCase()}`;
  return { ...item, code, owner: item.owner || null, detail, consumer: consumerOwner, class: classifyBlocker(`${code} ${detail} ${item.owner || ''}`) };
}
function closedMarkerBlockers(raw, owner) {
  const out=[];
  function walk(value, trail=[]){
    if(!value || typeof value!=='object') return;
    for(const [key,v] of Object.entries(value)){
      const next=[...trail,key];
      if(/blocker/i.test(key) && typeof v==='string' && /^(closed|resolved|pass)$/i.test(v)){
        out.push(normalizeBlocker({code:next.join('_').toUpperCase(),owner,state:'CLOSED',detail:`${next.join('.')}=${v}`},owner));
      } else if(v && typeof v==='object') walk(v,next);
    }
  }
  walk(raw);
  return out;
}
function blockersFor(raw, owner) {
  return [...asArray(raw.blockers), ...asArray(raw.owner_blockers)].map(x => normalizeBlocker(x, owner)).concat(closedMarkerBlockers(raw,owner));
}
function classifyBlocker(text) {
  const s = String(text || '').toUpperCase();
  if (/DNS|TLS|CERT|HOSTNAME/.test(s)) return 'DNS_TLS';
  if (/SECRET|MAIL|WEBHOOK|SPF|DKIM|DMARC|CREDENTIAL.*CONFIG/.test(s)) return 'EXTERNAL_SECRET';
  if (/BROWSER|VISUAL|ACCEPTANCE|WS10|SCREENSHOT/.test(s)) return 'REAL_BROWSER_ACCEPTANCE';
  if (/DEPLOY|ORIGIN|HOST|COMPOSE|PRODUCTION_CONFIG|RELEASE_BUNDLE|LIVE_DOMAIN/.test(s)) return 'LIVE_DEPLOYMENT';
  if (/ADAPTER|CONTRACT|HANDOFF|RECONCIL|PIN|SCHEMA|ROUTE|METHOD|OUTBOX|STATUS/.test(s)) return 'CONTRACT_RECONCILIATION';
  return 'PRODUCT_IMPLEMENTATION';
}
function normalizeHandoff(raw, file, releaseId) {
  const owner = normalizeOwner(raw, file);
  const branch = branchFor(owner, raw);
  const sourceCommit = raw.source_commit || raw.sourceCommit || null;
  const contracts = contractsFor(raw);
  const evidence = evidenceFor(raw);
  const blockers = blockersFor(raw, owner);
  const warnings = [];
  const errors = [];
  if (!raw.release_id) errors.push('release_id missing');
  else if (releaseId && raw.release_id !== releaseId) errors.push(`release_id mismatch: ${raw.release_id}`);
  if (!owner) errors.push('owner/workstream missing');
  if (!branch) errors.push('branch missing and no supported legacy mapping');
  else if (!raw.branch) warnings.push(`branch inferred from legacy owner mapping: ${branch}`);
  if (!SHA40.test(String(sourceCommit || ''))) errors.push('source_commit must be exact 40-hex commit');
  if (!hasAny(evidence)) errors.push('tested CI/evidence missing');
  if (!hasAny(contracts)) errors.push('provided contracts missing');
  const consumerRequirements = raw.consumer_requirements || raw.consumers || raw.owner_blockers || raw.ws09_required_config || raw.rerun_policy || null;
  if (consumerRequirements == null) warnings.push('consumer requirements inferred from compatibility rules');
  if (!('blockers' in raw) && !('owner_blockers' in raw)) warnings.push('blockers field absent; normalized as empty');
  const contractDigest = `sha256:${sha256(canonicalJson(contracts))}`;
  return { owner, branch, source_commit: sourceCommit, schema_version: raw.schema_version ?? null,
    evidence, contracts, contract_digest: contractDigest, blockers, consumer_requirements: consumerRequirements,
    warnings, errors, raw, file };
}

function parseCredentialText(text) {
  const s = String(text || '');
  const range = s.match(/(\d+)\s*[-–]\s*(\d+)/);
  return {
    min: range ? Number(range[1]) : null,
    max: range ? Number(range[2]) : null,
    bytes: /byte/i.test(s),
    printable_ascii: /printable[ -]?ascii|U\+0021\s*[-–]\s*U\+007E/i.test(s),
    text: s
  };
}
function websiteCredential(h) {
  const raw = h?.raw || {};
  return parseCredentialText(
    deepGet(raw,'api_contract_references.credential_envelope_ws03.required_shared_boundary') ||
    deepText(deepGet(raw,'changes.website'))
  );
}
function ws13Credential(h) { return parseCredentialText(deepGet(h?.raw,'credential_contract_summary.password_write.accepted')); }
function ws03Credential(h) {
  const raw = h?.raw || {};
  const p = parseCredentialText(deepGet(raw,'credential_contract.shared_required_range'));
  if (p.max == null && Number.isInteger(deepGet(raw,'credential_contract.secret_max_bytes'))) p.max = deepGet(raw,'credential_contract.secret_max_bytes');
  return p;
}
function compatibleRange(consumer, provider) {
  if (consumer.min == null || consumer.max == null || provider.min == null || provider.max == null) return null;
  return consumer.min >= provider.min && consumer.max <= provider.max;
}
function matrixEntry(id, provider, consumer, state, evidence, detail) {
  return { id, provider, consumer, state, evidence: asArray(evidence).filter(Boolean), detail: detail || null };
}
function staleOrIncompatible(consumerH, providerH, compatible, id, detail, evidence) {
  if (compatible) return matrixEntry(id, providerH.owner, consumerH.owner, 'COMPATIBLE', evidence, detail);
  const pin = inputPinFor(consumerH.raw, providerH.owner);
  const state = pin && pin !== providerH.source_commit ? 'STALE_CONSUMER' : 'INCOMPATIBLE';
  return matrixEntry(id, providerH.owner, consumerH.owner, state, [...asArray(evidence), pin && `consumer_pin=${pin}`, `provider_source=${providerH.source_commit}`], detail);
}
function routeSet(raw) { return new Set(asArray(raw).map(x => String(x).trim().replace(/\s+/g,' '))); }
function setDiff(a,b) { return [...a].filter(x => !b.has(x)); }
function methodSet(value) { return new Set(asArray(value).map(String)); }

function checkCompatibility(byOwner) {
  const m = [];
  const web=byOwner.get('WEBSITE'), w13=byOwner.get('WS13'), w03=byOwner.get('WS03'), w07=byOwner.get('WS07'), w08=byOwner.get('WS08'), w09=byOwner.get('WS09'), w10=byOwner.get('WS10'), w50=byOwner.get('WS50'), w12=byOwner.get('WS12');
  if (web && w13) {
    const expected = routeSet(deepGet(web.raw,'api_contract_references.account_ws13.routes'));
    const provided = routeSet([...asArray(deepGet(w13.raw,'api_contract_summary.routes')), ...asArray(deepGet(w13.raw,'api_contract_summary.official_frontend_aliases'))]);
    const missing = setDiff(expected, provided);
    m.push(staleOrIncompatible(web,w13,missing.length===0,'WEBSITE_WS13_ACCOUNT_ROUTES',`missing routes: ${missing.join(', ') || 'none'}`,[...expected]));
    const wc=websiteCredential(web), c13=ws13Credential(w13);
    const credOk = compatibleRange(wc,c13) === true && (!wc.printable_ascii || c13.printable_ascii);
    m.push(staleOrIncompatible(web,w13,credOk,'WEBSITE_WS13_CREDENTIAL_POLICY',`website=${wc.text}; ws13=${c13.text}`,[web.contract_digest,w13.contract_digest]));
  }
  if (w03 && web && deepGet(w03.raw,'credential_contract.website_current_range')) {
    const observed=parseCredentialText(deepGet(w03.raw,'credential_contract.website_current_range'));
    const actual=websiteCredential(web);
    const same=observed.min===actual.min&&observed.max===actual.max;
    m.push(matrixEntry('WS03_WEBSITE_CREDENTIAL_OBSERVATION','WEBSITE','WS03',same?'COMPATIBLE':'STALE_CONSUMER',[observed.text,actual.text],`ws03_observed=${observed.text}; exact_website=${actual.text}`));
  }
  if (w13 && w03) {
    const c13=ws13Credential(w13), c03=ws03Credential(w03);
    const ok = c13.min != null && c13.max != null && c03.max != null && c13.max <= c03.max && (!c03.min || c13.min >= c03.min);
    m.push(staleOrIncompatible(w13,w03,ok,'WS13_WS03_CREDENTIAL_ENVELOPE',`ws13=${c13.text}; ws03=${c03.text || `max ${c03.max} bytes`}`,[w13.contract_digest,w03.contract_digest]));
  }
  if (w13 && w07) {
    const a=deepGet(w13.raw,'production_dependencies.account_table');
    const b=deepGet(w07.raw,'authoritative_identity.player_account_table');
    m.push(staleOrIncompatible(w13,w07,Boolean(a&&b&&a===b),'WS13_WS07_ACCOUNT_SCHEMA',`ws13=${a}; ws07=${b}`,[a,b]));
  }
  if (w03 && w07) {
    const account=deepGet(w03.raw,'persistence_contract.account');
    const p=deepGet(w07.raw,'authoritative_identity.player_account_table');
    const ch=deepGet(w07.raw,'authoritative_identity.character_table');
    const fk=String(deepGet(w03.raw,'persistence_contract.character_fk')||'');
    const ok=Boolean(account&&p&&account===p&&ch&&fk.includes(ch)&&fk.includes(p));
    m.push(staleOrIncompatible(w03,w07,ok,'WS03_WS07_ACCOUNT_CHARACTER_IDENTITY',`account=${account}; player=${p}; character=${ch}; fk=${fk}`,[account,p,ch,fk]));
  }
  if (w07) m.push(checkMigrations(w07));
  if (w08 && w07) {
    const need=methodSet(deepGet(w08.raw,'adapter_contracts.repository_methods'));
    const have=methodSet([...asArray(deepGet(w07.raw,'adapter_contract.required_methods')), ...asArray(deepGet(w07.raw,'adapter_contract.extra_persistence_methods'))]);
    const missing=setDiff(need,have);
    m.push(staleOrIncompatible(w08,w07,missing.length===0,'WS08_WS07_ADMIN_REPOSITORY_SURFACE',`missing exact methods: ${missing.join(', ') || 'none'}`,[...need]));
    const outbox=deepGet(w07.raw,'adapter_contract.table_mapping.command_outbox');
    const states=asArray(deepGet(w08.raw,'command_contract.states'));
    const statusEp=deepGet(w08.raw,'frontend_owner_contract.command_status_endpoint');
    const ok=Boolean(outbox && states.includes('SUCCEEDED') && states.includes('FAILED') && statusEp);
    m.push(staleOrIncompatible(w08,w07,ok,'WS08_WS07_COMMAND_STATUS_OUTBOX',`outbox=${deepText(outbox)}; status=${statusEp}; states=${states.join(',')}`,[outbox,statusEp]));
  }
  if (w08) {
    const need=methodSet(deepGet(w08.raw,'adapter_contracts.runtime_methods'));
    const providers=[...byOwner.values()].filter(h=>h.owner!=='WS08');
    let best=null;
    for(const h of providers){
      const text=deepText({runtime:h.raw.runtime_authority,session:h.raw.session_authority,adapter:h.raw.runtime_contract,contracts:h.raw.contracts});
      const hits=[...need].filter(x=>text.includes(x));
      if(!best||hits.length>best.hits.length) best={h,hits};
    }
    const missing=best?setDiff(need,new Set(best.hits)):[...need];
    m.push(matrixEntry('WS08_RUNTIME_AUTHORITY_REQUIREMENT',best?.h.owner||'RUNTIME_PROVIDER','WS08',missing.length?'MISSING_PROVIDER':'COMPATIBLE',best?[best.h.contract_digest]:[],`missing runtime methods: ${missing.join(', ')||'none'}`));
  }
  if (w09) {
    const required=new Set();
    for(const v of asArray(deepGet(w03?.raw||{},'production.required_env'))) required.add(v);
    for(const v of asArray(deepGet(w13?.raw||{},'delivery_contract_summary.production_env'))) required.add(v);
    for(const v of asArray(deepGet(w08?.raw||{},'ws09_required_config'))) required.add(v);
    const ws09Text=deepText(w09.raw);
    const missing=[...required].filter(v=>!ws09Text.includes(v));
    m.push(matrixEntry('WS09_REQUIRED_SERVICE_ENV_MIGRATION_INPUTS','OWNER_SET','WS09',missing.length?'MISSING_REQUIRED_INPUT':'COMPATIBLE',[...required],`missing explicit WS09 inputs: ${missing.join(', ')||'none'}`));
  }
  if (w10) {
    const expectedWebsite=deepGet(w10.raw,'tested_release.accepted_website_source_commit');
    const websiteOk=!web||!expectedWebsite||expectedWebsite===web.source_commit;
    const receipt=deepGet(w09?.raw||{},'deployment.deployment_receipt');
    const child=deepGet(w50?.raw||{},'child_candidate') || deepGet(w50?.raw||{},'tested_release.child_candidate');
    const state=websiteOk && receipt && child ? 'COMPATIBLE' : 'MISSING_REQUIRED_INPUT';
    m.push(matrixEntry('WS10_ACCEPTED_PROVIDER_DEPLOYMENT_RECEIPT','WS50/WS09/WEBSITE','WS10',state,[expectedWebsite,web?.source_commit,receipt,child],`website_match=${websiteOk}; deployment_receipt=${Boolean(receipt)}; child_candidate=${Boolean(child)}`));
  }
  if (w12) {
    const pointer=deepGet(w12.raw,'release_pointer')||deepGet(w12.raw,'launcher_contract.release_pointer');
    const release=deepText({ws09:w09?.raw?.release_pointer,ws50:w50?.raw?.release_pointer,release_id:w12.raw.release_id});
    m.push(matrixEntry('PLAY_LAUNCHER_RELEASE_POINTER','WS12','WS09/WS50',pointer&&release.includes(String(pointer))?'COMPATIBLE':'INCOMPATIBLE',[pointer,release],null));
  } else {
    m.push(matrixEntry('PLAY_LAUNCHER_RELEASE_POINTER','WS12','WS09/WS50','NOT_APPLICABLE',[],'WS12 handoff not supplied'));
  }
  return m;
}

function checkMigrations(w07) {
  const plan=asArray(deepGet(w07.raw,'migration_plan.order'));
  const ws07Rows=plan.filter(x=>String(x.owner||'').toUpperCase()==='WS07');
  const serviceRows=plan.filter(x=>String(x.owner||'').toUpperCase()!=='WS07');
  const nums = row => { const m=path.basename(row.path||'').match(/^(\d+)_/); return m?Number(m[1]):null; };
  const numbers=ws07Rows.map(nums);
  const unique=new Set(numbers.filter(Number.isInteger));
  const monotonic=numbers.every((n,i)=>i===0||n>numbers[i-1]);
  const dup=unique.size!==numbers.filter(Number.isInteger).length;
  const ledger=deepGet(w07.raw,'migration_plan.ledger');
  const collision=serviceRows.some(s=>{
    const n=nums(s); if(n==null||!unique.has(n)) return false;
    const sl=String(s.ledger||'').toLowerCase();
    return !sl.includes('service-owned') && (!s.ledger || s.ledger===ledger);
  });
  const ok=plan.length>0 && monotonic && !dup && !collision;
  return matrixEntry('WS07_MIGRATION_ORDER','WS07','WS09',ok?'COMPATIBLE':'INCOMPATIBLE',plan.map(x=>`${x.owner}:${x.path}:${x.ledger||ledger||''}`),`monotonic=${monotonic}; duplicate_number=${dup}; ledger_collision=${collision}`);
}

function providerEvidenceFor(blocker, byOwner) {
  const code=String(blocker.code||'').toUpperCase();
  const detail=String(blocker.detail||'').toUpperCase();
  if (code.includes('HANDOFF_MISSING')) {
    const owner=String(blocker.owner||'').toUpperCase();
    if (byOwner.has(owner)) return {provider:owner, reason:'exact owner handoff is now present'};
  }
  if (code==='UPSTREAM_DOMAIN_LIVE_HANDOFFS_MISSING' || code.includes('DOMAIN_LIVE_OWNER_HANDOFFS')) {
    const missing=CORE_OWNERS.filter(o=>o!=='WS50'&&!byOwner.has(o));
    if(!missing.length) return {provider:'OWNER_SET',reason:'all core upstream handoffs are present'};
  }
  if (code.includes('ENTRYPOINT_MISSING')) {
    const owner=String(blocker.owner||'').toUpperCase(); const h=byOwner.get(owner);
    if(h && hasAny(h.raw.automation||{})) return {provider:owner,reason:'owner handoff publishes an automation/entrypoint contract'};
  }
  if (code==='WS07_ADMIN_ADAPTER_MISSING' || code==='WS08_PRODUCTION_PERSISTENCE_ADAPTER' || /(?:REPOSITORY|PERSISTENCE).*ADAPTER.*MISSING/.test(code+' '+detail)) {
    const h=byOwner.get('WS07'); if(deepGet(h?.raw||{},'adapter_contract.class')&&asArray(deepGet(h.raw,'adapter_contract.required_methods')).length) return {provider:'WS07',reason:'WS07 publishes concrete admin adapter class and method surface'};
  }
  if (code==='WS13_SHARED_CREDENTIAL_ENVELOPE_SERVER_ENFORCEMENT') {
    const h=byOwner.get('WS13'), c=ws13Credential(h);
    if(c.min===10&&c.max===12&&c.printable_ascii) return {provider:'WS13',reason:'WS13 exact handoff publishes 10-12 printable ASCII write policy'};
  }
  if (code==='WS08_COMMAND_TERMINAL_STATUS' || /COMMAND.*STATUS/.test(code)) {
    const h=byOwner.get('WS08'); const states=asArray(deepGet(h?.raw||{},'command_contract.states'));
    if(states.includes('SUCCEEDED')&&states.includes('FAILED')&&deepGet(h.raw,'frontend_owner_contract.command_status_endpoint')) return {provider:'WS08',reason:'WS08 publishes terminal states and command status endpoint'};
  }
  if (code==='ADMIN_V10_FRONTEND_WIRING_REQUIRED') {
    const h=byOwner.get('WEBSITE'); if(deepText(deepGet(h?.raw||{},'changes.admin')).match(/CSRF|idempot|expectedVersion|production calls/i)) return {provider:'WEBSITE',reason:'WEBSITE publishes admin production wiring evidence'};
  }
  return null;
}
function reconcileBlockers(byOwner) {
  const open=[], closed=[], stale=[];
  for(const consumer of byOwner.values()) {
    for(const blocker of consumer.blockers) {
      const explicitState=String(blocker.state||blocker.status||'').toUpperCase();
      if (['CLOSED','RESOLVED','PASS'].includes(explicitState)) { closed.push({...blocker,state:'CLOSED'}); continue; }
      const ev=providerEvidenceFor(blocker,byOwner);
      if(!ev){ open.push({...blocker,state:'OPEN'}); continue; }
      const provider=byOwner.get(ev.provider);
      const pin=provider?inputPinFor(consumer.raw,provider.owner):null;
      const retested=provider && pin===provider.source_commit && testedAtSource(consumer.raw,consumer.source_commit);
      stale.push({...blocker,state:'SUPERSEDED_BY_PROVIDER_EVIDENCE',provider:ev.provider,provider_source_commit:provider?.source_commit||null,
        provider_evidence:ev.reason,reconciliation:retested?'RECONCILED':'RECONCILIATION_REQUIRED',consumer_provider_pin:pin});
    }
  }
  return {open,closed,stale};
}

function defaultGitRunner(args, cwd) {
  return cp.execFileSync('git', args, {cwd, encoding:'utf8', stdio:['ignore','pipe','pipe']}).trim();
}
function validateSourceCommit(h, opts={}) {
  const run=opts.gitRunner||defaultGitRunner, cwd=opts.repoRoot||process.cwd();
  const result={owner:h.owner,branch:h.branch,source_commit:h.source_commit,reachable:false,in_branch_history:false,observed_branch_head:null,errors:[]};
  try {
    try { run(['cat-file','-e',`${h.source_commit}^{commit}`],cwd); }
    catch { if(opts.fetch!==false) run(['fetch','--no-tags','origin',h.source_commit],cwd); run(['cat-file','-e',`${h.source_commit}^{commit}`],cwd); }
    result.reachable=true;
    const safe=h.branch.replace(/[^A-Za-z0-9._-]/g,'_'); const ref=`refs/ws39-validation/${safe}`;
    if(opts.fetch!==false) run(['fetch','--no-tags','--force','origin',`refs/heads/${h.branch}:${ref}`],cwd);
    const branchRef=opts.fetch===false?h.branch:ref;
    try { result.observed_branch_head=run(['rev-parse',branchRef],cwd); } catch { result.observed_branch_head=null; }
    run(['merge-base','--is-ancestor',h.source_commit,branchRef],cwd); result.in_branch_history=true;
  } catch (e) { result.errors.push(String(e.stderr||e.message||e).trim()); }
  return result;
}

function pinDigest(handoffs) {
  const records=[...handoffs].sort((a,b)=>a.owner.localeCompare(b.owner)).map(h=>`${h.owner}\t${h.source_commit}\t${h.contract_digest}\n`).join('');
  return `sha256:${sha256(records)}`;
}
function externalGates(blockers, matrix) {
  const gateClasses=new Set(['LIVE_DEPLOYMENT','EXTERNAL_SECRET','DNS_TLS','REAL_BROWSER_ACCEPTANCE']);
  const out=blockers.filter(b=>gateClasses.has(b.class)).map(b=>({code:b.code,class:b.class,owner:b.owner,consumer:b.consumer,detail:b.detail}));
  for(const x of matrix.filter(x=>x.state==='MISSING_REQUIRED_INPUT'&&/WS09|WS10|LAUNCHER/.test(x.id))) out.push({code:x.id,class:'LIVE_DEPLOYMENT',owner:x.provider,consumer:x.consumer,detail:x.detail});
  return out;
}
function validateRelease({releaseId, files, handoffs, sourceValidation=true, repoRoot=process.cwd(), fetch=true, gitRunner}={}) {
  const raws=[];
  if(handoffs){
    for(const [file,raw] of Object.entries(handoffs)) raws.push({file,raw});
  } else {
    for(const file of files||[]) raws.push({file,raw:JSON.parse(fs.readFileSync(file,'utf8'))});
  }
  const normalized=raws.map(({file,raw})=>normalizeHandoff(raw,file,releaseId));
  const duplicates=[]; const byOwner=new Map();
  for(const h of normalized){ if(byOwner.has(h.owner)) duplicates.push(h.owner); byOwner.set(h.owner,h); }
  const schemaErrors=normalized.flatMap(h=>h.errors.map(error=>({owner:h.owner,error})));
  if(duplicates.length) schemaErrors.push(...duplicates.map(owner=>({owner,error:'duplicate owner handoff'})));
  const sourceResults=sourceValidation?normalized.map(h=>validateSourceCommit(h,{repoRoot,fetch,gitRunner})):normalized.map(h=>({owner:h.owner,branch:h.branch,source_commit:h.source_commit,skipped:true,reachable:null,in_branch_history:null,errors:[]}));
  const matrix=checkCompatibility(byOwner);
  const blockers=reconcileBlockers(byOwner);
  const missingExternal=externalGates(blockers.open,matrix);
  const staleReconciliation=blockers.stale.filter(b=>b.reconciliation==='RECONCILIATION_REQUIRED');
  const sourceBad=sourceResults.some(x=>!x.skipped&&(!x.reachable||!x.in_branch_history));
  const matrixBad=matrix.some(x=>BAD_STATES.has(x.state));
  const valid=!schemaErrors.length&&!sourceBad&&!matrixBad&&!blockers.open.length&&!staleReconciliation.length&&!missingExternal.length;
  return {
    schema_version:'ws39.domain-live-validation/v1', release_id:releaseId, valid,
    tooling_state:'READY_TO_FREEZE_AFTER_OWNER_COMPLETION', final_set_frozen:false,
    exact_source_pins:Object.fromEntries([...byOwner].sort().map(([o,h])=>[o,{branch:h.branch,source_commit:h.source_commit,contract_digest:h.contract_digest}])),
    pin_digest:pinDigest(normalized),
    handoff_schema:{errors:schemaErrors,warnings:normalized.flatMap(h=>h.warnings.map(warning=>({owner:h.owner,warning})))},
    source_commit_validation:sourceResults,
    compatibility_matrix:matrix,
    closed_blockers:blockers.closed,
    open_blockers:blockers.open,
    stale_superseded_blockers:blockers.stale,
    missing_external_gates:missingExternal
  };
}

function collectRoot(root) {
  const names=fs.readdirSync(root).filter(n=>n.endsWith('.json')&&n.toUpperCase()!=='WS39.JSON').sort();
  return names.map(n=>path.join(root,n));
}
function parseArgs(argv) {
  const out={files:[],sourceValidation:true,fetch:true,pretty:true};
  for(let i=0;i<argv.length;i++){
    const a=argv[i];
    if(a==='--release') out.releaseId=argv[++i];
    else if(a==='--root') out.root=argv[++i];
    else if(a==='--no-source-validation') out.sourceValidation=false;
    else if(a==='--no-fetch') out.fetch=false;
    else if(a==='--compact') out.pretty=false;
    else if(a==='--out') out.out=argv[++i];
    else out.files.push(a);
  }
  if(out.root) out.files.push(...collectRoot(out.root));
  return out;
}
function cli() {
  const args=parseArgs(process.argv.slice(2));
  if(!args.releaseId||!args.files.length){
    console.error('usage: node tools/ws39_contracts/domain_live.cjs --release <release_id> --root coordination/handoffs/domain-live [--out report.json]');
    process.exitCode=2; return;
  }
  const result=validateRelease({releaseId:args.releaseId,files:[...new Set(args.files)],sourceValidation:args.sourceValidation,repoRoot:process.cwd(),fetch:args.fetch});
  const text=JSON.stringify(result,null,args.pretty?2:0)+'\n';
  if(args.out) fs.writeFileSync(args.out,text); else process.stdout.write(text);
  if(!result.valid) process.exitCode=1;
}
if(require.main===module) cli();

module.exports={stable,canonicalJson,sha256,normalizeHandoff,classifyBlocker,parseCredentialText,checkMigrations,
  validateSourceCommit,pinDigest,reconcileBlockers,checkCompatibility,validateRelease,collectRoot};
