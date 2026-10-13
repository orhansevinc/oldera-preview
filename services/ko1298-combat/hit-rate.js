'use strict';

const HIT_OUTCOME = Object.freeze({ GREAT_SUCCESS: 'GREAT_SUCCESS', SUCCESS: 'SUCCESS', NORMAL: 'NORMAL', FAIL: 'FAIL' });

function outcomeForRoll(rate, roll) {
  if (!Number.isFinite(rate)) throw new TypeError('rate must be finite');
  if (!Number.isInteger(roll) || roll < 1 || roll > 10000) throw new RangeError('roll must be an integer in 1..10000');

  const bands = rate >= 5.0 ? [3500, 7500, 9800]
    : rate >= 3.0 ? [2500, 6000, 9600]
      : rate >= 2.0 ? [2000, 5000, 9400]
        : rate >= 1.25 ? [1500, 4000, 9200]
          : rate >= 0.8 ? [1000, 3000, 9000]
            : rate >= 0.5 ? [800, 2500, 8000]
              : rate >= 0.33 ? [600, 2000, 7000]
                : rate >= 0.2 ? [400, 1500, 6000]
                  : [200, 1000, 5000];

  if (roll <= bands[0]) return HIT_OUTCOME.GREAT_SUCCESS;
  if (roll <= bands[1]) return HIT_OUTCOME.SUCCESS;
  if (roll <= bands[2]) return HIT_OUTCOME.NORMAL;
  return HIT_OUTCOME.FAIL;
}

function rollHitOutcome(rate, rng = Math.random) {
  const random = rng();
  if (!(random >= 0 && random < 1)) throw new RangeError('rng must return [0,1)');
  const roll = 1 + Math.floor(random * 10000);
  return outcomeForRoll(rate, roll);
}

module.exports = { HIT_OUTCOME, outcomeForRoll, rollHitOutcome };
