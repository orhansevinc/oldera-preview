'use strict';
const HIT_OUTCOME=Object.freeze({GREAT_SUCCESS:'GREAT_SUCCESS',SUCCESS:'SUCCESS',NORMAL:'NORMAL',FAIL:'FAIL'});
function outcomeForRoll(rate,roll){if(!Number.isFinite(rate))throw new TypeError('rate must be finite');if(!Number.isInteger(roll)||roll<1||roll>10000)throw new RangeError('roll must be an integer in 1..10000');const b=rate>=5?[3500,7500,9800]:rate>=3?[2500,6000,9600]:rate>=2?[2000,5000,9400]:rate>=1.25?[1500,4000,9200]:rate>=.8?[1000,3000,9000]:rate>=.5?[800,2500,8000]:rate>=.33?[600,2000,7000]:rate>=.2?[400,1500,6000]:[200,1000,5000];return roll<=b[0]?HIT_OUTCOME.GREAT_SUCCESS:roll<=b[1]?HIT_OUTCOME.SUCCESS:roll<=b[2]?HIT_OUTCOME.NORMAL:HIT_OUTCOME.FAIL;}
function rollHitOutcome(rate,rng=Math.random){const r=rng();if(!(r>=0&&r<1))throw new RangeError('rng must return [0,1)');return outcomeForRoll(rate,1+Math.floor(r*10000));}
module.exports={HIT_OUTCOME,outcomeForRoll,rollHitOutcome};
