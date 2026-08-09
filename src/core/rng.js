/** Deterministic xorshift32 RNG used by both wave generation and strategy RNG. */

export const UINT32_MAX = 0xffffffff;
export const DEFAULT_SEED = 0x9e3779b9;

export const hashSeed = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    const number = Math.trunc(value) >>> 0;
    return number || DEFAULT_SEED;
  }
  const text = String(value ?? "0");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) || DEFAULT_SEED;
};

export const normalizeSeed = (value) => hashSeed(value);

export const xorshift32 = (state) => {
  let value = (state >>> 0) || DEFAULT_SEED;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return value >>> 0;
};

export class XorShift32 {
  constructor(seed = DEFAULT_SEED) {
    this.seed = normalizeSeed(seed);
    this.state = this.seed;
  }

  nextUint32() {
    this.state = xorshift32(this.state);
    return this.state;
  }

  next() {
    return this.nextUint32() / 4294967296;
  }

  int(minInclusive, maxExclusive) {
    const min = Math.ceil(Number.isFinite(minInclusive) ? minInclusive : 0);
    const max = Math.ceil(Number.isFinite(maxExclusive) ? maxExclusive : min + 1);
    if (max <= min) return min;
    return min + Math.floor(this.next() * (max - min));
  }

  intInclusive(minInclusive, maxInclusive) {
    return this.int(minInclusive, Number(maxInclusive) + 1);
  }

  pick(values) {
    if (!Array.isArray(values) || values.length === 0) return undefined;
    return values[this.int(0, values.length)];
  }

  signed() {
    return this.int(0, 2) === 0 ? -1 : 1;
  }

  fork(label = "fork") {
    return new XorShift32(hashSeed(`${this.seed}:${this.state}:${String(label)}`));
  }

  clone() {
    const copy = new XorShift32(this.seed);
    copy.state = this.state >>> 0;
    return copy;
  }
}

export const createRng = (seed = DEFAULT_SEED) => new XorShift32(seed);
export const rngFromState = (state = DEFAULT_SEED) => {
  const rng = new XorShift32(DEFAULT_SEED);
  rng.state = normalizeSeed(state);
  return rng;
};

export default XorShift32;
