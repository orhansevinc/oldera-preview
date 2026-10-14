'use strict';

function createAuthoritativeWorldPort({getSnapshot,distance}){
  if(typeof getSnapshot!=='function'||typeof distance!=='function')throw new TypeError('getSnapshot and distance are required');
  const validate=(source,target,maxRange,rangeName)=>{
    const sourceId=source?.id??source?.runtimeId??source?.instanceId;
    const targetId=target?.id??target?.runtimeId??target?.instanceId;
    const a=getSnapshot(sourceId),b=getSnapshot(targetId);
    if(!a||!b||a.zoneId!==b.zoneId)return {ok:false,reason:!a||!b?'POSITION_UNAVAILABLE':'ZONE_MISMATCH'};
    if(!Number.isFinite(maxRange))return {ok:false,reason:`${rangeName}_UNAVAILABLE`};
    const d=distance(a.position,b.position);
    return {ok:d<=maxRange,reason:d<=maxRange?null:'OUT_OF_RANGE',distance:d,maxRange};
  };
  return {
    getZoneId(entity){const entityId=entity?.id??entity?.runtimeId??entity?.instanceId;return getSnapshot(entityId)?.zoneId??entity?.zoneId??null;},
    validateAttackRange({attacker,target,weaponRange}){return validate(attacker,target,weaponRange,'WEAPON_RANGE');},
    validateSkillRange({caster,target,range}){return validate(caster,target,range,'SKILL_RANGE');},
    validateMobAttackRange({source,target,attackRange}){return validate(source,target,attackRange,'MOB_ATTACK_RANGE');},
  };
}

function createWs17EquipmentCombatPort({getEquipmentSnapshot}){
  if(typeof getEquipmentSnapshot!=='function')throw new TypeError('getEquipmentSnapshot is required');
  return {
    getCombatSnapshot(entity){
      const entityId=entity?.id??entity;
      const s=getEquipmentSnapshot(entityId);
      if(!s)return null;
      return Object.freeze({weaponRange:s.weaponRange??null,attackDelayMs:s.attackDelayMs??null,damage:s.damage??null,weaponItemId:s.weaponItemId??null,weaponType:s.weaponType??null,weaponClass:s.weaponClass??null,weapon:s.weapon??null,attack:s.attack??null,armor:s.armor??null,raw:s});
    },
    hasRequiredItemClass(entity,requiredClass){
      const entityId=entity?.id??entity;
      const s=getEquipmentSnapshot(entityId);
      if(!s)return false;
      const left=Math.trunc(Number(s.leftItemClass??0)/10),right=Math.trunc(Number(s.rightItemClass??0)/10);
      return requiredClass===left||requiredClass===right;
    },
  };
}

function createWs25MobCombatPort({combatService,getEntity}){
  return {
    isAlive(id){const e=getEntity(id);return !!e&&e.lifeState==='ALIVE'&&e.hp>0;},
    canMobTarget(mob,target){const a=getEntity(mob.id),b=getEntity(target.id);return !!a&&!!b&&a.zoneId!=null&&a.zoneId===b.zoneId&&a.lifeState==='ALIVE'&&b.lifeState==='ALIVE';},
    normalAttack({mobId,targetId,requestKey,context={}}){const attacker=getEntity(mobId),target=getEntity(targetId);const result=combatService.normalAttack(attacker,target,{...context,requestKey});return Object.freeze({result,absoluteTargetHp:target?.hp??null,deathEvent:result.deathEvent??null});},
  };
}

function createPlayerCombatPort({combatService,skillService,getEntity}){
  return {
    normalAttack({sourceId,targetId,requestKey,context={}}){return combatService.normalAttack(getEntity(sourceId),getEntity(targetId),{...context,requestKey});},
    skill({skillId,sourceId,targetId,requestKey,context={}}){return skillService.request({skillId,caster:getEntity(sourceId),target:getEntity(targetId),context:{...context,requestKey}});},
  };
}

function createAuthoritativePlayerCombatPort({getCombatSnapshot,applyHealthResult,applyResourceResult}){
  if(typeof getCombatSnapshot!=='function')throw new TypeError('getCombatSnapshot is required');
  if(typeof applyHealthResult!=='function')throw new TypeError('applyHealthResult is required');
  if(typeof applyResourceResult!=='function')throw new TypeError('applyResourceResult is required');
  return Object.freeze({
    getCombatSnapshot(id){return getCombatSnapshot(id);},
    applyHealthResult(result){return applyHealthResult(result);},
    applyResourceResult(result){return applyResourceResult(result);},
  });
}

module.exports={createAuthoritativePlayerCombatPort,createAuthoritativeWorldPort,createPlayerCombatPort,createWs17EquipmentCombatPort,createWs25MobCombatPort};
