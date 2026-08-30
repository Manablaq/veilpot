/** Design-only numeric envelope; no production contract constants are defined here. */

export const DESIGN_DECIMALS = 6n;
export const MAX_PARTICIPANTS = 128n;
export const MAX_DRAW_DURATION_SECONDS = 30n * 24n * 60n * 60n;
export const MAX_USER_PRINCIPAL_BASE_UNITS = 1_000_000n * 10n ** DESIGN_DECIMALS;
export const MAX_POOL_PRINCIPAL_BASE_UNITS = MAX_PARTICIPANTS * MAX_USER_PRINCIPAL_BASE_UNITS;
export const MAX_PRIZE_ENTITLEMENT_BASE_UNITS = MAX_USER_PRINCIPAL_BASE_UNITS;
export const MAX_TOTAL = MAX_POOL_PRINCIPAL_BASE_UNITS * MAX_DRAW_DURATION_SECONDS;
export const MAX_BUCKET = 2n ** 69n;
export const MAX_CANDIDATE = MAX_BUCKET - 1n;
export const SIMULATED_RATE_BPS_PER_DAY = 1n;
export const MAX_GROSS_SYNTHETIC_YIELD =
  (MAX_TOTAL * SIMULATED_RATE_BPS_PER_DAY) / (10_000n * 86_400n);

export function nextPowerOfTwo(value: bigint): bigint {
  if (value <= 0n) throw new RangeError("value must be positive");
  let result = 1n;
  while (result < value) result <<= 1n;
  return result;
}

export function bitLength(value: bigint): number {
  if (value < 0n) throw new RangeError("value must be non-negative");
  return value === 0n ? 0 : value.toString(2).length;
}

export interface NumericEnvelope {
  readonly userPrincipal: bigint;
  readonly aggregatePrincipal: bigint;
  readonly userTwabArea: bigint;
  readonly aggregateTwabArea: bigint;
  readonly aggregateDrawTotal: bigint;
  readonly prefixSum: bigint;
  readonly bucket: bigint;
  readonly candidate: bigint;
  readonly target: bigint;
  readonly prizeEntitlement: bigint;
}

export function conservativeEnvelope(): NumericEnvelope {
  const userTwabArea = MAX_USER_PRINCIPAL_BASE_UNITS * MAX_DRAW_DURATION_SECONDS;
  const aggregateTwabArea = userTwabArea * MAX_PARTICIPANTS;
  const aggregateDrawTotal = MAX_TOTAL;
  const bucket = nextPowerOfTwo(aggregateDrawTotal);
  return {
    userPrincipal: MAX_USER_PRINCIPAL_BASE_UNITS,
    aggregatePrincipal: MAX_POOL_PRINCIPAL_BASE_UNITS,
    userTwabArea,
    aggregateTwabArea,
    aggregateDrawTotal,
    prefixSum: aggregateDrawTotal,
    bucket,
    candidate: MAX_CANDIDATE,
    target: MAX_CANDIDATE,
    prizeEntitlement: MAX_PRIZE_ENTITLEMENT_BASE_UNITS,
  };
}
