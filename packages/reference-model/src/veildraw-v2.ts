import { selectWinnerFromPrefixes } from "./model.js";

export const VEILDRAW_V2_MAX_PARTICIPANTS = 128;
export const VEILDRAW_V2_SHARD_SIZE = 8;
export const VEILDRAW_V2_SHARD_COUNT = VEILDRAW_V2_MAX_PARTICIPANTS / VEILDRAW_V2_SHARD_SIZE;
export const VEILDRAW_V2_PRIZE_SLOTS = 3;

export type PrizeTarget = bigint | null;

export interface PrivateShardedResolution {
  /**
   * Oracle-only clear values used to prove mathematical equivalence.
   *
   * The production protocol MUST NOT expose the shard or winner publicly.
   */
  readonly winnerIndex: number;
  readonly shardIndex: number;
  readonly localIndex: number;
  readonly localTarget: bigint;
}

export type PrizeResolution = PrivateShardedResolution | null;

function assertWeights(weights: readonly bigint[]): void {
  if (weights.length > VEILDRAW_V2_MAX_PARTICIPANTS) {
    throw new RangeError(`weights exceed ${String(VEILDRAW_V2_MAX_PARTICIPANTS)} participants`);
  }

  for (let index = 0; index < weights.length; index += 1) {
    const weight = weights[index]!;
    if (weight < 0n) {
      throw new RangeError(`weights[${String(index)}] must be non-negative`);
    }
  }
}

function assertPositiveTarget(target: bigint, total: bigint): void {
  if (total <= 0n) {
    throw new RangeError("positive aggregate weight required");
  }

  if (target < 0n || target >= total) {
    throw new RangeError("target is outside the positive aggregate interval");
  }
}

export function totalWeight(weights: readonly bigint[]): bigint {
  assertWeights(weights);

  let total = 0n;

  for (const weight of weights) {
    total += weight;
  }

  return total;
}

export function activeShardCount(participantCount: number): number {
  if (
    !Number.isInteger(participantCount) ||
    participantCount < 0 ||
    participantCount > VEILDRAW_V2_MAX_PARTICIPANTS
  ) {
    throw new RangeError("participantCount is outside the VeilDraw V2 envelope");
  }

  return Math.ceil(participantCount / VEILDRAW_V2_SHARD_SIZE);
}

export function shardTotals(weights: readonly bigint[]): readonly bigint[] {
  assertWeights(weights);

  const totals = Array<bigint>(VEILDRAW_V2_SHARD_COUNT).fill(0n);

  for (let index = 0; index < weights.length; index += 1) {
    const shardIndex = Math.floor(index / VEILDRAW_V2_SHARD_SIZE);
    totals[shardIndex] = totals[shardIndex]! + weights[index]!;
  }

  return totals;
}

/**
 * Canonical legacy winner oracle.
 *
 * This deliberately delegates to the already-reviewed Gate 0 prefix rule.
 */
export function resolveLegacyWinner(weights: readonly bigint[], target: bigint): number {
  const total = totalWeight(weights);
  assertPositiveTarget(target, total);

  return selectWinnerFromPrefixes(weights, target);
}

/**
 * Hierarchical 16 x 8 decomposition of the exact same global weighted interval.
 *
 * The clear shard/local values exist only in this independent oracle. Production
 * implementation must represent routing and winner predicates as ciphertexts.
 */
export function resolvePrivateShardedWinner(
  weights: readonly bigint[],
  target: bigint,
): PrivateShardedResolution {
  const total = totalWeight(weights);
  assertPositiveTarget(target, total);

  const totals = shardTotals(weights);

  const shardIndex = selectWinnerFromPrefixes(totals, target);

  let shardPrefix = 0n;

  for (let index = 0; index < shardIndex; index += 1) {
    shardPrefix += totals[index]!;
  }

  const localTarget = target - shardPrefix;
  const shardStart = shardIndex * VEILDRAW_V2_SHARD_SIZE;

  const localWeights = Array.from(
    { length: VEILDRAW_V2_SHARD_SIZE },
    (_, localIndex) => weights[shardStart + localIndex] ?? 0n,
  );

  const localIndex = selectWinnerFromPrefixes(localWeights, localTarget);
  const winnerIndex = shardStart + localIndex;

  if (
    winnerIndex >= weights.length ||
    weights[winnerIndex] === undefined ||
    weights[winnerIndex] <= 0n
  ) {
    throw new Error("private sharded winner violated the positive-weight invariant");
  }

  return {
    winnerIndex,
    shardIndex,
    localIndex,
    localTarget,
  };
}

export function winnerPredicates(weights: readonly bigint[], target: bigint): readonly boolean[] {
  const winner = resolvePrivateShardedWinner(weights, target).winnerIndex;

  return weights.map((_, index) => index === winner);
}

/**
 * Resolve the three independent prize slots.
 *
 * Zero-total rounds MUST carry no random target and therefore fabricate no
 * winner. Positive-total rounds MUST provide one independent target per slot.
 */
export function resolveThreePrizeRound(
  weights: readonly bigint[],
  targets: readonly [PrizeTarget, PrizeTarget, PrizeTarget],
): readonly [PrizeResolution, PrizeResolution, PrizeResolution] {
  const total = totalWeight(weights);

  if (total === 0n) {
    if (targets.some((target) => target !== null)) {
      throw new RangeError("zero-total round must not contain draw targets");
    }

    return [null, null, null];
  }

  const first = targets[0];
  const second = targets[1];
  const third = targets[2];

  if (first === null || second === null || third === null) {
    throw new RangeError("positive-total round requires all three prize targets");
  }

  return [
    resolvePrivateShardedWinner(weights, first),
    resolvePrivateShardedWinner(weights, second),
    resolvePrivateShardedWinner(weights, third),
  ];
}

/**
 * Allocate exactly three consecutive draw IDs from the existing monotonic
 * draw-ID namespace.
 */
export function allocateRoundDrawIds(
  lastAssignedDrawId: bigint,
): readonly [bigint, bigint, bigint] {
  if (lastAssignedDrawId < 0n) {
    throw new RangeError("lastAssignedDrawId must be non-negative");
  }

  return [lastAssignedDrawId + 1n, lastAssignedDrawId + 2n, lastAssignedDrawId + 3n];
}

/**
 * Deterministically split one already-recognized prize amount.
 *
 * The first two slots receive floor(total / 3). The third receives the exact
 * residual, so conservation holds for every remainder without additional
 * comparison/decryption.
 */
export function allocateThreePrizeFunding(totalFunding: bigint): readonly [bigint, bigint, bigint] {
  if (totalFunding < 0n) {
    throw new RangeError("totalFunding must be non-negative");
  }

  const quotient = totalFunding / 3n;

  return [quotient, quotient, totalFunding - quotient - quotient];
}
