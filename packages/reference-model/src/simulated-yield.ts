/** Gate 1A design-only simulated adapter accounting; not production code. */
export const SIMULATED_RATE_BPS_PER_DAY = 1n;
export const BPS_DENOMINATOR = 10_000n;
export const DAY_SECONDS = 86_400n;

export interface DrawYieldState {
  readonly drawId: bigint;
  readonly rawTotalTwab: bigint;
  readonly grossSyntheticYield: bigint;
  readonly realizedSimulatedYield: bigint;
  readonly yieldSwept: bigint;
  readonly yieldRecognized: boolean;
}

export function recognizeDrawYield(
  drawId: bigint,
  rawTotalTwab: bigint,
  fundedYieldLiquidityAvailable: bigint,
): DrawYieldState {
  if (drawId < 0n || rawTotalTwab < 0n || fundedYieldLiquidityAvailable < 0n) {
    throw new RangeError("draw-yield values must be non-negative");
  }
  const grossSyntheticYield =
    (rawTotalTwab * SIMULATED_RATE_BPS_PER_DAY) / (BPS_DENOMINATOR * DAY_SECONDS);
  const realizedSimulatedYield =
    grossSyntheticYield < fundedYieldLiquidityAvailable
      ? grossSyntheticYield
      : fundedYieldLiquidityAvailable;
  return {
    drawId,
    rawTotalTwab,
    grossSyntheticYield,
    realizedSimulatedYield,
    yieldSwept: 0n,
    yieldRecognized: true,
  };
}

export function sweepActualYield(state: DrawYieldState, actualTransferred: bigint): DrawYieldState {
  if (
    actualTransferred < 0n ||
    actualTransferred > state.realizedSimulatedYield - state.yieldSwept
  ) {
    throw new RangeError("actual yield transfer exceeds unswept recognized yield");
  }
  return { ...state, yieldSwept: state.yieldSwept + actualTransferred };
}

export function recognizeAgain(state: DrawYieldState): never {
  if (state.yieldRecognized) throw new Error("draw yield already recognized");
  throw new Error("invalid draw yield state");
}
