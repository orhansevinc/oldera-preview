'use strict';

const SEMVER = /^\d+\.\d+\.\d+$/;
const TYPE_SPLIT = /:(.+)$/;

function parseDescriptor(value) {
  const text = String(value);
  const i = text.indexOf(':');
  if (i < 0) return { name: text, type: null };
  return { name: text.slice(0, i), type: text.slice(i + 1) };
}

function compareDescriptors(expected = [], actual = [], kind = 'field') {
  const actualMap = new Map(actual.map(v => { const d=parseDescriptor(v); return [d.name,d]; }));
  const issues=[];
  for (const raw of expected) {
    const exp=parseDescriptor(raw); const got=actualMap.get(exp.name);
    if (!got) { issues.push({ code:`MISSING_REQUIRED_${kind.toUpperCase()}`, name:exp.name, breaking:true }); continue; }
    if (exp.type && got.type && exp.type !== got.type) issues.push({ code:'CONFLICTING_TYPE', name:exp.name, expected:exp.type, actual:got.type, breaking:true });
  }
  return issues;
}

function evaluateContract(contract) {
  const issues=[];
  const unavailable = new Set(['missing-branch','branch-empty','partial']);
  if (contract.required && unavailable.has(contract.provider.interfaceStatus)) issues.push({code:'PROVIDER_INTERFACE_UNAVAILABLE',breaking:true});
  if (contract.required && ['missing-branch','branch-empty'].includes(contract.consumer.interfaceStatus)) issues.push({code:'CONSUMER_INTERFACE_UNAVAILABLE',breaking:true});
  issues.push(...compareDescriptors(contract.expected.fields, contract.actual.fields, 'field'));
  // Method descriptors in this registry are mostly semantic names. Exact-name matching is still useful for published-to-published boundaries.
  if (contract.provider.interfaceStatus === 'published' && contract.consumer.interfaceStatus.startsWith('published')) {
    const expectedMethods=contract.expected.methods||[], actualMethods=contract.actual.methods||[];
    for (const method of expectedMethods) if (!actualMethods.includes(method)) issues.push({code:'MISSING_REQUIRED_METHOD',name:method,breaking:true});
  }
  const actualSemantics=new Set(contract.actual.semantics||[]);
  for (const semantic of contract.expected.semantics||[]) if (!actualSemantics.has(semantic)) issues.push({code:'MISSING_REQUIRED_SEMANTIC',name:semantic,breaking:true});
  return { breaking:issues.some(i=>i.breaking), issues };
}

function classifyChange(previous, next) {
  const issues=[];
  issues.push(...compareDescriptors(previous.fields||[], next.fields||[], 'field'));
  const prevMethods=new Set(previous.methods||[]), nextMethods=new Set(next.methods||[]);
  for (const m of prevMethods) if (!nextMethods.has(m)) issues.push({code:'REMOVED_METHOD',name:m,breaking:true});
  const prevSem=new Set(previous.semantics||[]), nextSem=new Set(next.semantics||[]);
  for (const s of prevSem) if (!nextSem.has(s)) issues.push({code:'REMOVED_SEMANTIC',name:s,breaking:true});
  return { breaking:issues.some(i=>i.breaking), issues };
}

function validateRegistry(registry) {
  const errors=[];
  if (registry.schemaVersion !== 'oldko.contract-registry/v1') errors.push('invalid registry schemaVersion');
  if (!SEMVER.test(registry.policyVersion||'')) errors.push('invalid policyVersion');
  const ids=new Set();
  for (const c of registry.contracts||[]) {
    if (ids.has(c.id)) errors.push(`duplicate contract id: ${c.id}`); ids.add(c.id);
    if (c.schemaVersion !== 'oldko.contract/v1') errors.push(`${c.id}: invalid schemaVersion`);
    if (!SEMVER.test(c.contractVersion||'')) errors.push(`${c.id}: invalid contractVersion`);
    if (!c.provider?.ws || !c.consumer?.ws) errors.push(`${c.id}: provider/consumer missing`);
    if (!Array.isArray(c.sourceRefs) || c.sourceRefs.length===0) errors.push(`${c.id}: sourceRefs missing`);
    if (typeof c.assessment?.breaking !== 'boolean') errors.push(`${c.id}: assessment.breaking missing`);
  }
  return errors;
}

module.exports={parseDescriptor,compareDescriptors,evaluateContract,classifyChange,validateRegistry};
