/**
 * Gate 1C independent bigint oracle for prize/yield accounting.
 *
 * DESIGN MODEL ONLY / NOT PRODUCTION / MUST NOT DEPLOY.
 *
 * It deliberately contains no FHE implementation details. The production
 * contracts must be tested differentially against these economic and
 * state-machine invariants.
 */

export const GATE1C_RATE_BPS_PER_DAY = 1n;
export const GATE1C_BPS_DENOMINATOR = 10_000n;
export const GATE1C_DAY_SECONDS = 86_400n;
export const GATE1C_YIELD_DENOMINATOR = GATE1C_BPS_DENOMINATOR * GATE1C_DAY_SECONDS;

const requireNonNegative = (value: bigint, name: string): void => {
  if (value < 0n) {
    throw new RangeError(`${name} must be non-negative`);
  }
};

const minimum = (a: bigint, b: bigint): bigint => (a < b ? a : b);

export type YieldFundingState = "Recognized" | "SweepProofPending" | "FundingFinalized";

interface MutableYieldDraw {
  readonly drawId: bigint;
  readonly rawTotalTwab: bigint;
  readonly grossYield: bigint;
  readonly recognizedYield: bigint;
  remainingUnswept: bigint;
  state: YieldFundingState;
  pendingComplete: boolean | null;
}

export interface YieldDrawSnapshot {
  readonly drawId: bigint;
  readonly rawTotalTwab: bigint;
  readonly grossYield: bigint;
  readonly recognizedYield: bigint;
  readonly remainingUnswept: bigint;
  readonly state: YieldFundingState;
}

/**
 * Models the competition adapter.
 *
 * Funding is dedicated non-principal liquidity. Recognition reserves that
 * liquidity immediately, preventing another draw from recognizing the same
 * backing while the first draw is still unswept.
 */
export class Gate1CYieldAdapterModel {
  private fundedAvailableValue = 0n;
  private committedUnsweptValue = 0n;
  private rawTokenBalanceValue = 0n;
  private readonly draws = new Map<bigint, MutableYieldDraw>();

  public fundYield(actualTransferred: bigint): void {
    requireNonNegative(actualTransferred, "actualTransferred");
    this.fundedAvailableValue += actualTransferred;
    this.rawTokenBalanceValue += actualTransferred;
  }

  /**
   * A direct token donation changes raw custody but must never become
   * recognized yield backing.
   */
  public directDonation(actualTransferred: bigint): void {
    requireNonNegative(actualTransferred, "actualTransferred");
    this.rawTokenBalanceValue += actualTransferred;
  }

  public recognize(drawId: bigint, rawTotalTwab: bigint): YieldDrawSnapshot {
    requireNonNegative(drawId, "drawId");
    requireNonNegative(rawTotalTwab, "rawTotalTwab");

    if (this.draws.has(drawId)) {
      throw new Error("draw yield already recognized");
    }

    const grossYield = rawTotalTwab / GATE1C_YIELD_DENOMINATOR;
    const recognizedYield = minimum(grossYield, this.fundedAvailableValue);

    // Reserve backing at recognition time. It is no longer available to
    // another draw even though the actual token transfer happens later.
    this.fundedAvailableValue -= recognizedYield;
    this.committedUnsweptValue += recognizedYield;

    const draw: MutableYieldDraw = {
      drawId,
      rawTotalTwab,
      grossYield,
      recognizedYield,
      remainingUnswept: recognizedYield,
      state: "Recognized",
      pendingComplete: null,
    };

    this.draws.set(drawId, draw);

    this.assertBackingInvariant();

    return this.snapshot(drawId);
  }

  /**
   * Models one ERC-7984 sweep attempt using the token-returned actual amount.
   */
  public beginSweep(drawId: bigint, actualTransferred: bigint): bigint {
    requireNonNegative(actualTransferred, "actualTransferred");

    const draw = this.requireDraw(drawId);

    if (draw.state !== "Recognized") {
      throw new Error("yield sweep is not available");
    }

    if (actualTransferred > draw.remainingUnswept) {
      throw new RangeError("actual sweep exceeds recognized residual");
    }

    if (actualTransferred > this.rawTokenBalanceValue) {
      throw new RangeError("actual sweep exceeds token custody");
    }

    draw.remainingUnswept -= actualTransferred;
    this.committedUnsweptValue -= actualTransferred;
    this.rawTokenBalanceValue -= actualTransferred;
    draw.pendingComplete = draw.remainingUnswept === 0n;
    draw.state = "SweepProofPending";

    this.assertBackingInvariant();

    return actualTransferred;
  }

  /**
   * Models proof-backed settlement of the encrypted residual-zero predicate.
   */
  public settleSweep(drawId: bigint, clearComplete: boolean): void {
    const draw = this.requireDraw(drawId);

    if (draw.state !== "SweepProofPending" || draw.pendingComplete === null) {
      throw new Error("yield sweep proof is not pending");
    }

    if (clearComplete !== draw.pendingComplete) {
      throw new Error("invalid yield sweep completion proof");
    }

    draw.pendingComplete = null;
    draw.state = clearComplete ? "FundingFinalized" : "Recognized";
  }

  public snapshot(drawId: bigint): YieldDrawSnapshot {
    const draw = this.requireDraw(drawId);

    return {
      drawId: draw.drawId,
      rawTotalTwab: draw.rawTotalTwab,
      grossYield: draw.grossYield,
      recognizedYield: draw.recognizedYield,
      remainingUnswept: draw.remainingUnswept,
      state: draw.state,
    };
  }

  public get fundedAvailable(): bigint {
    return this.fundedAvailableValue;
  }

  public get committedUnswept(): bigint {
    return this.committedUnsweptValue;
  }

  public get rawTokenBalance(): bigint {
    return this.rawTokenBalanceValue;
  }

  public get accountedBacking(): bigint {
    return this.fundedAvailableValue + this.committedUnsweptValue;
  }

  public assertBackingInvariant(): void {
    if (this.rawTokenBalanceValue < this.accountedBacking) {
      throw new Error("adapter backing invariant violated");
    }
  }

  private requireDraw(drawId: bigint): MutableYieldDraw {
    const draw = this.draws.get(drawId);

    if (draw === undefined) {
      throw new Error("unknown draw yield");
    }

    return draw;
  }
}

export type PrizeState =
  | "Unprepared"
  | "StatusProofPending"
  | "Claimable"
  | "TransferProofPending"
  | "Claimed"
  | "NoPrize";

export interface HistoricalClaimIdentity {
  readonly drawId: bigint;
  readonly slotIndex: bigint;
  readonly participant: string;
  readonly registrationVersion: bigint;
  readonly reservationNonce: bigint;
}

export interface Gate1CClaimAuthorization {
  readonly chainId: bigint;
  readonly reserve: string;
  readonly pool: string;
  readonly drawId: bigint;
  readonly slotIndex: bigint;
  readonly participant: string;
  readonly recipient: string;
  readonly registrationVersion: bigint;
  readonly reservationNonce: bigint;
  readonly nonce: bigint;
  readonly expiry: bigint;
}

interface MutablePrize {
  readonly drawId: bigint;
  yieldFunding: bigint;
  sponsorFunding: bigint;
  remaining: bigint;
  state: PrizeState;
  pendingZero: boolean | null;
  pendingComplete: boolean | null;
  pendingParticipant: string | null;
  pendingNonce: bigint | null;
}

export interface PrizeSnapshot {
  readonly drawId: bigint;
  readonly yieldFunding: bigint;
  readonly sponsorFunding: bigint;
  readonly remaining: bigint;
  readonly state: PrizeState;
}

/**
 * Models an isolated reserve.
 *
 * Raw donations never become accounted yield or sponsor funding. A prize
 * liability is created only from actual recorded assets.
 */
export class Gate1CPrizeReserveModel {
  private rawTokenBalanceValue = 0n;
  private accountedReserveAssetsValue = 0n;
  private outstandingPrizeLiabilitiesValue = 0n;

  private readonly prizes = new Map<bigint, MutablePrize>();
  private readonly claimNonces = new Map<string, bigint>();

  public constructor(
    private readonly chainId: bigint,
    private readonly reserveId: string,
    private readonly poolId: string,
    private readonly adapterId: string,
  ) {}

  public recordYield(caller: string, drawId: bigint, actualTransferred: bigint): void {
    requireNonNegative(actualTransferred, "actualTransferred");

    if (caller !== this.adapterId) {
      throw new Error("unauthorized yield source");
    }

    const prize = this.requireMutablePrize(drawId);

    if (prize.state !== "Unprepared") {
      throw new Error("prize funding already frozen");
    }

    prize.yieldFunding += actualTransferred;
    this.rawTokenBalanceValue += actualTransferred;
    this.accountedReserveAssetsValue += actualTransferred;

    this.assertSolvent();
  }

  public fundSponsorForDraw(drawId: bigint, actualTransferred: bigint): void {
    requireNonNegative(actualTransferred, "actualTransferred");

    const prize = this.requireMutablePrize(drawId);

    if (prize.state !== "Unprepared") {
      throw new Error("prize funding already frozen");
    }

    prize.sponsorFunding += actualTransferred;
    this.rawTokenBalanceValue += actualTransferred;
    this.accountedReserveAssetsValue += actualTransferred;

    this.assertSolvent();
  }

  /**
   * Raw token balance surplus is never treated as yield or sponsor funding.
   */
  public directDonation(actualTransferred: bigint): void {
    requireNonNegative(actualTransferred, "actualTransferred");
    this.rawTokenBalanceValue += actualTransferred;
    this.assertSolvent();
  }

  /**
   * Freeze exactly the assets assigned to this draw after adapter funding
   * has reached its proof-backed terminal state.
   */
  public preparePrize(drawId: bigint, adapterFundingFinalized: boolean): void {
    if (!adapterFundingFinalized) {
      throw new Error("adapter funding not finalized");
    }

    const prize = this.requireMutablePrize(drawId);

    if (prize.state !== "Unprepared") {
      throw new Error("prize already prepared");
    }

    prize.remaining = prize.yieldFunding + prize.sponsorFunding;
    prize.pendingZero = prize.remaining === 0n;
    prize.state = "StatusProofPending";

    this.outstandingPrizeLiabilitiesValue += prize.remaining;

    this.assertSolvent();
  }

  /**
   * Models the proof of the encrypted prize-zero predicate.
   */
  public settlePrizeStatus(drawId: bigint, clearZero: boolean): void {
    const prize = this.requireMutablePrize(drawId);

    if (prize.state !== "StatusProofPending" || prize.pendingZero === null) {
      throw new Error("prize status proof is not pending");
    }

    if (clearZero !== prize.pendingZero) {
      throw new Error("invalid prize status proof");
    }

    prize.pendingZero = null;
    prize.state = clearZero ? "NoPrize" : "Claimable";
  }

  /**
   * Models one participant-authorized fixed-recipient claim attempt.
   *
   * `isWinner` is a plaintext oracle input only in this independent model.
   * Production uses the encrypted historical winner predicate.
   */
  public beginClaim(
    authorization: Gate1CClaimAuthorization,
    identity: HistoricalClaimIdentity,
    isWinner: boolean,
    actualTransferred: bigint,
    now: bigint,
  ): void {
    requireNonNegative(actualTransferred, "actualTransferred");
    requireNonNegative(now, "now");

    const prize = this.requireMutablePrize(identity.drawId);

    if (prize.state !== "Claimable") {
      throw new Error("prize is not claimable");
    }

    this.validateAuthorization(authorization, identity, now);

    const expectedNonce = this.nextClaimNonce(identity.participant);

    if (authorization.nonce !== expectedNonce) {
      throw new Error("invalid claim nonce");
    }

    const requested = isWinner ? prize.remaining : 0n;

    if (actualTransferred > requested) {
      throw new RangeError("actual transfer exceeds authorized entitlement");
    }

    if (actualTransferred > this.rawTokenBalanceValue) {
      throw new RangeError("actual transfer exceeds reserve custody");
    }

    this.claimNonces.set(identity.participant, expectedNonce + 1n);

    prize.remaining -= actualTransferred;
    this.outstandingPrizeLiabilitiesValue -= actualTransferred;
    this.accountedReserveAssetsValue -= actualTransferred;
    this.rawTokenBalanceValue -= actualTransferred;

    prize.pendingComplete = prize.remaining === 0n;
    prize.pendingParticipant = identity.participant;
    prize.pendingNonce = authorization.nonce;
    prize.state = "TransferProofPending";

    this.assertSolvent();
  }

  /**
   * A claim is terminal only after proof that the global encrypted prize
   * residual is zero. A nonwinner's zero transfer therefore cannot close
   * another participant's prize.
   */
  public settleClaim(
    drawId: bigint,
    participant: string,
    nonce: bigint,
    clearComplete: boolean,
  ): void {
    const prize = this.requireMutablePrize(drawId);

    if (
      prize.state !== "TransferProofPending" ||
      prize.pendingComplete === null ||
      prize.pendingParticipant === null ||
      prize.pendingNonce === null
    ) {
      throw new Error("claim proof is not pending");
    }

    if (participant !== prize.pendingParticipant || nonce !== prize.pendingNonce) {
      throw new Error("claim proof domain mismatch");
    }

    if (clearComplete !== prize.pendingComplete) {
      throw new Error("invalid claim completion proof");
    }

    prize.pendingComplete = null;
    prize.pendingParticipant = null;
    prize.pendingNonce = null;
    prize.state = clearComplete ? "Claimed" : "Claimable";
  }

  public snapshot(drawId: bigint): PrizeSnapshot {
    const prize = this.requireMutablePrize(drawId);

    return {
      drawId: prize.drawId,
      yieldFunding: prize.yieldFunding,
      sponsorFunding: prize.sponsorFunding,
      remaining: prize.remaining,
      state: prize.state,
    };
  }

  public nextClaimNonce(participant: string): bigint {
    return this.claimNonces.get(participant) ?? 0n;
  }

  public get rawTokenBalance(): bigint {
    return this.rawTokenBalanceValue;
  }

  public get accountedReserveAssets(): bigint {
    return this.accountedReserveAssetsValue;
  }

  public get outstandingPrizeLiabilities(): bigint {
    return this.outstandingPrizeLiabilitiesValue;
  }

  public assertSolvent(): void {
    if (this.accountedReserveAssetsValue < this.outstandingPrizeLiabilitiesValue) {
      throw new Error("reserve solvency invariant violated");
    }

    if (this.rawTokenBalanceValue < this.accountedReserveAssetsValue) {
      throw new Error("reserve custody invariant violated");
    }
  }

  private validateAuthorization(
    authorization: Gate1CClaimAuthorization,
    identity: HistoricalClaimIdentity,
    now: bigint,
  ): void {
    if (
      authorization.chainId !== this.chainId ||
      authorization.reserve !== this.reserveId ||
      authorization.pool !== this.poolId ||
      authorization.drawId !== identity.drawId ||
      authorization.slotIndex !== identity.slotIndex ||
      authorization.participant !== identity.participant ||
      authorization.recipient !== identity.participant ||
      authorization.registrationVersion !== identity.registrationVersion ||
      authorization.reservationNonce !== identity.reservationNonce ||
      (authorization.expiry !== 0n && now > authorization.expiry)
    ) {
      throw new Error("invalid claim authorization");
    }
  }

  private requireMutablePrize(drawId: bigint): MutablePrize {
    requireNonNegative(drawId, "drawId");

    let prize = this.prizes.get(drawId);

    if (prize === undefined) {
      prize = {
        drawId,
        yieldFunding: 0n,
        sponsorFunding: 0n,
        remaining: 0n,
        state: "Unprepared",
        pendingZero: null,
        pendingComplete: null,
        pendingParticipant: null,
        pendingNonce: null,
      };

      this.prizes.set(drawId, prize);
    }

    return prize;
  }
}
