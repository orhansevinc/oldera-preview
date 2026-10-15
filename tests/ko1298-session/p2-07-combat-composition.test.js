'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createP207CombatComposition } = require('../../services/ko1298-session/p2-07-combat-composition');

function mobService() {
  const mob = { runtimeId: 12000, id: 12000, instanceId:'m1', zoneId:21, position:{x:1,y:0,z:1}, hp:100, maxHp:100, alive:true, targetable:true, attackable:true, defense:{ac:10,evasionRate:1}, attack:{attack:10,hitRate:1,baseDamage:10,attackDelayMs:1000,attackRange:3} };
  return {
    getCombatSnapshot(){ return { ...mob, position:{...mob.position}, defense:{...mob.defense}, attack:{...mob.attack} }; },
    applyCombatResult(id, result){ mob.hp = result.absoluteTargetHp; if (mob.hp === 0) mob.alive=false; return { applied:true, deathTransition:mob.hp===0, mob:{...mob} }; },
  };
}
function playerPort() {
  const player = { id:77, zoneId:21, position:{x:1,y:0,z:1}, hp:100,maxHp:100,mp:20,maxMp:20,resourceKind:'MP',level:3,lifeState:'ALIVE',combat:{ap:20,ac:10,hitRate:1,evasionRate:1} };
  return {
    getCombatSnapshot(){ return { ...player, position:{...player.position}, combat:{...player.combat} }; },
    applyHealthResult(r){ player.hp=r.absoluteHp; return {applied:true,deathTransition:player.hp===0,player:{...player}}; },
    applyResourceResult(r){ player.mp=r.absoluteValue; return {applied:true,player:{...player}}; },
  };
}

test('P2-07 production composition refuses to create a second implicit authority', () => {
  assert.throws(() => createP207CombatComposition({ mobService:mobService() }), /playerCombatPort/);
});

test('P2-07 adapter executes a server-authoritative normal attack through shared ports', async () => {
  const p = playerPort();
  const { combatAdapter } = createP207CombatComposition({
    mobService:mobService(),
    playerCombatPort:p,
    equipmentPort:{ getCombatSnapshot(){return {weaponRange:3,attackDelayMs:1000,damage:10,weaponItemId:1,weaponType:21};} },
    worldPort:{ validateAttackRange(){return {ok:true,distance:0,maxRange:3};},validateMobAttackRange(){return {ok:true,distance:0,maxRange:3};} },
    rng:()=>0.5,
    clock:()=>1000,
  });
  const out=await combatAdapter.execute({actor:{entityId:77},operation:{kind:'NORMAL_ATTACK',sourceEntityId:77,targetRuntimeId:12000,requestKey:'r1'}});
  assert.equal(out.ok,true);
  assert.equal(out.target,12000);
});
