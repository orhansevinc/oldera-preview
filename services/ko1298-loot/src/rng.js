import { fail } from './errors.js';

export class SeededRng {
  constructor(seed) {
    if (!Number.isSafeInteger(seed)) {
      fail('INVALID_RNG_SEED', 'RNG seed must be a safe integer.', { seed });
    }
    this.state = (seed >>> 0) || 0x6d2b79f5;
  }

  nextUint32() {
    let x = this.state >>> 0;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return this.state;
  }

  nextFloat() {
    return this.nextUint32() / 0x100000000;
  }

  nextIntInclusive(min, max) {
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min > max) {
      fail('INVALID_RNG_RANGE', 'RNG integer range is invalid.', { min, max });
    }
    const span = max - min + 1;
    if (!Number.isSafeInteger(span) || span <= 0) {
      fail('INVALID_RNG_RANGE', 'RNG integer range is too large.', { min, max });
    }
    return min + Math.floor(this.nextFloat() * span);
  }
}
