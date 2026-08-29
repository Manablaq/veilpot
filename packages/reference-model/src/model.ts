export interface FirstValidResult {
  readonly valid: boolean;
  readonly value: bigint;
  readonly index: number | null;
}

export interface Rational {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

function assertNonNegative(value: bigint, name: string): void {
  if (value < 0n) throw new RangeError(`${name} must be non-negative`);
}

export function isPowerOfTwo(value: bigint): boolean {
  return value > 0n && (value & (value - 1n)) === 0n;
}

export function nextPowerOfTwoBucket(total: bigint): bigint {
  if (total <= 0n) throw new RangeError("total must be positive");
  let bucket = 1n;
  while (bucket < total) bucket <<= 1n;
  return bucket;
}

export function candidateValid(candidate: bigint, total: bigint): boolean {
  assertNonNegative(candidate, "candidate");
  assertNonNegative(total, "total");
  return candidate < total;
}

export function serialFirstValid(candidates: readonly bigint[], total: bigint): FirstValidResult {
  assertNonNegative(total, "total");
  for (let index = 0; index < candidates.length; index += 1) {
    const value = candidates[index]!;
    if (candidateValid(value, total)) return { valid: true, value, index };
  }
  return { valid: false, value: 0n, index: null };
}

type OrderedNode = FirstValidResult;

function combineOrdered(left: OrderedNode, right: OrderedNode): OrderedNode {
  return left.valid ? left : right;
}

export function balancedFirstValid(candidates: readonly bigint[], total: bigint): FirstValidResult {
  assertNonNegative(total, "total");
  if (candidates.length === 0) return { valid: false, value: 0n, index: null };

  let level: OrderedNode[] = candidates.map((value, index) => ({
    valid: candidateValid(value, total),
    value,
    index,
  }));

  while (level.length > 1) {
    const next: OrderedNode[] = [];
    for (let index = 0; index < level.length; index += 2) {
      const left = level[index]!;
      const right = level[index + 1];
      next.push(right === undefined ? left : combineOrdered(left, right));
    }
    level = next;
  }

  const result = level[0]!;
  return result.valid ? result : { valid: false, value: 0n, index: null };
}

export function selectWinnerFromPrefixes(weights: readonly bigint[], target: bigint): number {
  assertNonNegative(target, "target");
  let prefix = 0n;
  for (let index = 0; index < weights.length; index += 1) {
    const weight = weights[index]!;
    assertNonNegative(weight, `weights[${String(index)}]`);
    const after = prefix + weight;
    if (prefix <= target && target < after) return index;
    prefix = after;
  }
  throw new RangeError("target is outside the positive aggregate interval");
}

function gcd(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

export function reduceRational(value: Rational): Rational {
  if (value.denominator <= 0n) throw new RangeError("denominator must be positive");
  const divisor = gcd(value.numerator, value.denominator);
  return { numerator: value.numerator / divisor, denominator: value.denominator / divisor };
}

export function batchFailureProbability(total: bigint, bucket: bigint, size: number): Rational {
  if (total <= 0n || total > bucket) throw new RangeError("require 0 < total <= bucket");
  if (!isPowerOfTwo(bucket)) throw new RangeError("bucket must be a power of two");
  if (!Number.isInteger(size) || size < 1) throw new RangeError("size must be a positive integer");
  return reduceRational({
    numerator: (bucket - total) ** BigInt(size),
    denominator: bucket ** BigInt(size),
  });
}

export function expectedBatchAttempts(total: bigint, bucket: bigint, size: number): Rational {
  const failure = batchFailureProbability(total, bucket, size);
  return reduceRational({
    numerator: failure.denominator,
    denominator: failure.denominator - failure.numerator,
  });
}

export function rationalToDecimal(value: Rational, digits = 18): string {
  const reduced = reduceRational(value);
  const scale = 10n ** BigInt(digits);
  const scaled = (reduced.numerator * scale) / reduced.denominator;
  const whole = scaled / scale;
  const fraction = (scaled % scale).toString().padStart(digits, "0").replace(/0+$/, "");
  return fraction.length === 0 ? whole.toString() : `${whole.toString()}.${fraction}`;
}

export class SplitMix64 {
  private state: bigint;

  public constructor(seed: bigint) {
    this.state = BigInt.asUintN(64, seed);
  }

  public next(): bigint {
    this.state = BigInt.asUintN(64, this.state + 0x9e3779b97f4a7c15n);
    let value = this.state;
    value = BigInt.asUintN(64, (value ^ (value >> 30n)) * 0xbf58476d1ce4e5b9n);
    value = BigInt.asUintN(64, (value ^ (value >> 27n)) * 0x94d049bb133111ebn);
    return BigInt.asUintN(64, value ^ (value >> 31n));
  }

  public belowPowerOfTwo(bound: bigint): bigint {
    if (!isPowerOfTwo(bound) || bound > 1n << 64n) {
      throw new RangeError("bound must be a power of two no greater than 2^64");
    }
    return this.next() & (bound - 1n);
  }
}
