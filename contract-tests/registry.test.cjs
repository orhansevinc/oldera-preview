'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const { validateRegistry }=require('./lib/compatibility.cjs');
const ROOT=path.resolve(__dirname,'..');
const registry=JSON.parse(fs.readFileSync(path.join(ROOT,'contracts/registry.json'),'utf8'));
const graph=JSON.parse(fs.readFileSync(path.join(ROOT,'contracts/dependency-graph.json'),'utf8'));

test('registry is structurally valid and IDs are unique',()=>{
  assert.deepEqual(validateRegistry(registry),[]);
  assert.equal(registry.contracts.length,16);
});

test('all requested priority contracts are represented',()=>{
  const ids=new Set(registry.contracts.map(c=>c.id));
  for (const id of [
    'character.create.session-to-rules','world.entry.session-to-world','movement.world-to-sync','npc.world-to-npc',
    'merchant.npc-to-economy','quest.npc-to-quest','inventory.items-to-economy','inn.items-to-storage',
    'combat.combat-to-mobs','loot.mobs-to-loot','progression.combat-mob-to-progression','gm.admin-to-command-bus',
    'persistence.data-to-consumers','content.launcher-to-manifest','friends.social-to-messenger','observability.common-adoption'
  ]) assert.ok(ids.has(id),`missing ${id}`);
});

test('dependency graph covers every registry contract exactly once',()=>{
  const regIds=registry.contracts.map(c=>c.id).sort();
  const edgeIds=graph.edges.map(e=>e.contract).sort();
  assert.deepEqual(edgeIds,regIds);
});

test('current declared breaking count is pinned to audited snapshot',()=>{
  const breaking=registry.contracts.filter(c=>c.assessment.breaking);
  assert.equal(breaking.length,14);
  const nonBreaking=registry.contracts.filter(c=>!c.assessment.breaking);
  assert.deepEqual(nonBreaking.map(c=>c.id).sort(),['inn.items-to-storage','observability.common-adoption'].sort());
});

test('every breaking contract names a recommended owner',()=>{
  for (const c of registry.contracts.filter(c=>c.assessment.breaking)) assert.match(c.assessment.recommendedOwnerWs,/^WS\d{2}$/);
});
