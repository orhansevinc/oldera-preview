'use strict';

const {HIT_OUTCOME,rollHitOutcome}=require('./hit-rate');
const {applyWeaponArmor}=require('./damage');
const {trunc}=require('./stat-calculator');

function randomInclusive(max,rng=Math.random){
  const m=Math.max(0,trunc(max));
  const value=rng();
  if(!(value>=0&&value<1))throw new RangeError('rng must return [0,1)');
  return Math.floor(value*(m+1));
}

function pvpPhysicalBase({attacker,target}){
  const attack=Number(attacker?.combat?.ap);
  const attackAmount=Number(attacker?.combat?.attackAmount??100);
  const ac=Number(target?.combat?.ac??0)+Number(target?.combat?.flatAcAmount??0);
  if(!Number.isFinite(attack)||!Number.isFinite(attackAmount)||!Number.isFinite(ac))throw new TypeError('finite AP, attackAmount and AC are required');
  if(ac+240===0)throw new RangeError('target AC + 240 cannot be zero');
  return trunc((attack*attackAmount/100*200)/(ac+240));
}

function relativePhysicalSkillHit({attacker,target,hitRateMod,rng=Math.random}){
  const attack=Number(attacker?.combat?.hitRate);
  const avoid=Number(target?.combat?.evasionRate);
  if(!(attack>=0)||!(avoid>0))throw new RangeError('valid hit/evasion rates are required');
  return rollHitOutcome((attack/avoid)*(Number(hitRateMod)/100),rng);
}

function nonRelativePhysicalSkillHit({hitRateMod,rng=Math.random}){
  const roll=randomInclusive(100,rng);
  return Object.freeze({outcome:Number(hitRateMod)>roll?HIT_OUTCOME.SUCCESS:HIT_OUTCOME.FAIL,roll});
}

/**
 * Verified OldKO/Open-KO PvP physical Type1/Type2 damage core.
 *
 * This intentionally stops at explicit adapter seams for GetMagicDamage/item
 * bonuses and target armour item wear/absorption. Those item-domain semantics
 * belong to WS17 and are not guessed here.
 */
class OpenKo1298PvpPhysicalSkillDamagePolicy{
  constructor({rng=Math.random,magicDamageAdapter=null,weaponArmorAdapter=null}={}){
    this.rng=rng;
    this.magicDamageAdapter=magicDamageAdapter;
    this.weaponArmorAdapter=weaponArmorAdapter;
  }

  resolve({skill,type,data,caster,target,context=null}){
    if(type!==1&&type!==2)throw new RangeError('physical skill policy supports Type1 or Type2 only');
    if(!data)throw new TypeError('type data is required');

    let hitOutcome,hitRoll=null;
    if(type===1&&Number(data.type)!==0){
      const hit=nonRelativePhysicalSkillHit({hitRateMod:data.hitRateMod,rng:this.rng});
      hitOutcome=hit.outcome;hitRoll=hit.roll;
    }else if(type===2&&(Number(data.hitType)===1||Number(data.hitType)===2)){
      const hit=nonRelativePhysicalSkillHit({hitRateMod:data.hitRateMod,rng:this.rng});
      hitOutcome=hit.outcome;hitRoll=hit.roll;
    }else{
      hitOutcome=relativePhysicalSkillHit({attacker:caster,target,hitRateMod:data.hitRateMod,rng:this.rng});
    }

    if(hitOutcome===HIT_OUTCOME.FAIL){
      return Object.freeze({damage:0,hitOutcome,events:Object.freeze([]),stages:Object.freeze({failedHit:true,hitRoll,type})});
    }

    const tempHitB=pvpPhysicalBase({attacker:caster,target});
    let tempHit;
    if(type===2&&Number(data.hitType)===1){
      tempHit=trunc(Number(caster.combat.ap)*Number(caster.combat.attackAmount??100)/100*(Number(data.damageMod)/100));
    }else{
      tempHit=trunc(tempHitB*(Number(data.damageMod)/100));
    }

    const randomDamage=randomInclusive(tempHit,this.rng);
    const preMagic=type===1
      ?trunc(tempHit+0.3*randomDamage+0.99)
      :trunc(0.6*tempHit+randomDamage+0.99);

    let damage=preMagic,magicApplied=false,weaponArmorApplied=false;
    if(this.magicDamageAdapter){
      damage=trunc(this.magicDamageAdapter({damage,addDamage:type===2?Number(data.addDamage??0):0,skill,type,data,caster,target,context}));
      magicApplied=true;
    }
    if(this.weaponArmorAdapter){
      const armorValues=this.weaponArmorAdapter({damage,skill,type,data,caster,target,context});
      for(const armor of (Array.isArray(armorValues)?armorValues:[armorValues])){
        if(armor!=null){damage=applyWeaponArmor(damage,armor);weaponArmorApplied=true;}
      }
    }

    const finalDamage=Math.max(0,trunc(damage/3));
    return Object.freeze({
      damage:finalDamage,
      hitOutcome,
      events:Object.freeze([]),
      stages:Object.freeze({type,hitRoll,tempHitB,tempHit,randomDamage,preMagic,magicApplied,weaponArmorApplied,finalDivisor:3})
    });
  }
}

module.exports={OpenKo1298PvpPhysicalSkillDamagePolicy,nonRelativePhysicalSkillHit,pvpPhysicalBase,randomInclusive,relativePhysicalSkillHit};
