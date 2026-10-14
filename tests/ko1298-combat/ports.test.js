'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {
  CombatService,
  OpenKo1298NormalAttackDamagePolicy,
  SkillService,
  createAuthoritativeWorldPort,
  createCombatant,
  createGoldenSkillTable,
  createPlayerCombatPort,
  createWs17EquipmentCombatPort,
  createWs25MobCombatPort,
}=require('../../services/ko1298-combat');

function actor(id,{x=0,z=0,zoneId=21,hp=100,maxHp=100,nationId=1,classId=104}={}){
  return createCombatant({id,hp,maxHp,mp:100,maxMp:100,zoneId,nationId,classId,level:20,position:{x,y:0,z},combat:{ap:200,ac:100,hitRate:5,evasionRate:1}});
}

test('WS15-shaped world port uses authoritative snapshots and exact range boundary',()=>{
  const snapshots=new Map([
    ['a',{zoneId:21,position:{x:0,y:0,z:0}}],
    ['b',{zoneId:21,position:{x:3,y:0,z:4}}],
  ]);
  const world=createAuthoritativeWorldPort({getSnapshot:id=>snapshots.get(id),distance:(a,b)=>Math.hypot(a.x-b.x,a.z-b.z)});
  const a=actor('a'),b=actor('b');
  assert.deepEqual(world.validateAttackRange({attacker:a,target:b,weaponRange:5}),{ok:true,distance:5,maxRange:5});
  assert.equal(world.validateAttackRange({attacker:a,target:b,weaponRange:4.999}).ok,false);
  snapshots.set('b',{zoneId:1,position:{x:0,y:0,z:0}});
  assert.equal(world.validateSkillRange({caster:a,target:b,range:99}).reason,'ZONE_MISMATCH');
});

test('WS17-shaped equipment port projects combat snapshot without owning inventory',()=>{
  const port=createWs17EquipmentCombatPort({getEquipmentSnapshot:()=>({weaponRange:2.5,attackDelayMs:700,leftItemClass:0,rightItemClass:70,weaponClass:7})});
  const a=actor('a');
  assert.equal(port.getCombatSnapshot(a).attackDelayMs,700);
  assert.equal(port.getCombatSnapshot(a).weaponRange,2.5);
  assert.equal(port.hasRequiredItemClass(a,7),true);
  assert.equal(port.hasRequiredItemClass(a,8),false);
});

test('WS25 mob combat port returns absolute authoritative HP and one death event',()=>{
  const entities=new Map();
  const mob=actor('mob',{hp:100}),target=actor('player',{hp:10});
  entities.set(mob.id,mob);entities.set(target.id,target);
  const combat=new CombatService({
    damagePolicy:{resolve:()=>({damage:50,hitOutcome:'SUCCESS',stages:{}})},
    clock:()=>1000,
    rng:()=>0,
    worldPort:{getZoneId:e=>e.zoneId,validateAttackRange:()=>true},
    equipmentPort:{getCombatSnapshot:()=>({weaponRange:2,attackDelayMs:0})},
  });
  const port=createWs25MobCombatPort({combatService:combat,getEntity:id=>entities.get(id)});
  const out=port.normalAttack({mobId:'mob',targetId:'player',requestKey:'mob-hit-1'});
  assert.equal(out.result.ok,true);
  assert.equal(out.absoluteTargetHp,0);
  assert.equal(out.deathEvent.type,'DEATH');
  assert.equal(port.isAlive('player'),false);
});

test('generic player port routes normal attack and skill without importing session code',()=>{
  const entities=new Map();
  const a=actor('a',{nationId:1,classId:104}),b=actor('b',{nationId:1,hp:50});
  entities.set(a.id,a);entities.set(b.id,b);
  const combat=new CombatService({damagePolicy:new OpenKo1298NormalAttackDamagePolicy({rng:()=>0}),clock:()=>1000,rng:()=>0,worldPort:{getZoneId:e=>e.zoneId,validateAttackRange:()=>true},equipmentPort:{getCombatSnapshot:()=>({weaponRange:2,attackDelayMs:0})}});
  const skills=new SkillService({table:createGoldenSkillTable(),worldPort:{getZoneId:e=>e.zoneId,validateSkillRange:()=>true}});
  const port=createPlayerCombatPort({combatService:combat,skillService:skills,getEntity:id=>entities.get(id)});
  assert.equal(port.normalAttack({sourceId:'a',targetId:'b',requestKey:'p-hit'}).ok,true);
  b.hp=50;b.lifeState='ALIVE';
  assert.equal(port.skill({skillId:104001,sourceId:'a',targetId:'b',requestKey:'p-heal'}).ok,true);
  assert.equal(b.hp,65);
});
