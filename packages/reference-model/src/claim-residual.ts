/**
 * GATE_1_DESIGN_PROBE_ONLY / NOT_PRODUCTION / MUST_NOT_DEPLOY.
 * Bigint model for participant-authorized fixed-recipient residual claims.
 */

export type ClaimState = "Claimable" | "Claimed";

export interface ClaimAuthorization {
  readonly chainId: bigint;
  readonly reserve: string;
  readonly drawId: bigint;
  readonly participant: string;
  readonly recipient: string;
  readonly nonce: bigint;
  readonly expiry: bigint;
}

export class ClaimResidualModel {
  private readonly expected: Omit<ClaimAuthorization, "nonce">;
  private remainingValue: bigint;
  private nextNonceValue = 0n;
  private claimState: ClaimState = "Claimable";

  public constructor(
    amount: bigint,
    chainId: bigint,
    reserve: string,
    drawId: bigint,
    participant: string,
  ) {
    if (amount < 0n) throw new RangeError("amount must be non-negative");
    this.remainingValue = amount;
    this.expected = { chainId, reserve, drawId, participant, recipient: participant, expiry: 0n };
  }

  public get remaining(): bigint {
    return this.remainingValue;
  }

  public get nonce(): bigint {
    return this.nextNonceValue;
  }

  public get state(): ClaimState {
    return this.claimState;
  }

  public claim(authorization: ClaimAuthorization, actualTransferred: bigint, now: bigint): void {
    if (this.claimState !== "Claimable") throw new Error("claim already completed");
    if (actualTransferred < 0n || actualTransferred > this.remainingValue) {
      throw new RangeError("actual transfer exceeds requested residual");
    }
    if (
      authorization.chainId !== this.expected.chainId ||
      authorization.reserve !== this.expected.reserve ||
      authorization.drawId !== this.expected.drawId ||
      authorization.participant !== this.expected.participant ||
      authorization.recipient !== this.expected.recipient ||
      authorization.nonce !== this.nextNonceValue ||
      (authorization.expiry !== 0n && now > authorization.expiry)
    ) {
      throw new Error("invalid claim authorization");
    }
    this.nextNonceValue += 1n;
    this.remainingValue -= actualTransferred;
    if (this.remainingValue === 0n) this.claimState = "Claimed";
  }
}
