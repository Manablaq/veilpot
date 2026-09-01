/**
 * Gate 1C.2C independent claim-authorization and payout oracle.
 *
 * DESIGN MODEL ONLY / NOT PRODUCTION / MUST NOT DEPLOY.
 *
 * The model intentionally contains no FHE implementation and no cryptographic
 * signature implementation. The signer models the address validated by the
 * production SignatureChecker. The signedAuthorization argument models the
 * exact EIP-712 payload whose digest that signature authenticated.
 */

export const GATE1C2C_EIP712_NAME = "VeilpotPrizeReserve";
export const GATE1C2C_EIP712_VERSION = "1";
export const GATE1C2C_CLAIM_PROOF_TTL_SECONDS = 86_400n;

export const GATE1C2C_CLAIM_AUTHORIZATION_TYPE =
  "ClaimAuthorization(uint256 chainId,address reserve,address pool,uint256 drawId,uint256 slotIndex,address participant,address recipient,uint256 registrationVersion,uint256 reservationNonce,uint256 nonce,uint256 expiry)";

export type Gate1C2CClaimState = "Claimable" | "TransferProofPending" | "Claimed";

export interface Gate1C2CClaimAuthorization {
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

export interface Gate1C2CHistoricalEntitlementInput {
  readonly slotIndex: bigint;
  readonly participant: string;
  readonly registrationVersion: bigint;
  readonly reservationNonce: bigint;
  readonly initialized: boolean;
  readonly beneficiaryBound: boolean;
  readonly residual: bigint;
}

export interface Gate1C2CTokenOutcome {
  readonly succeeded: boolean;
  readonly returnAclPresent: boolean;
  readonly actualTransferred: bigint;
}

export interface Gate1C2CClaimProofContext {
  readonly chainId: bigint;
  readonly reserve: string;
  readonly pool: string;
  readonly drawId: bigint;
  readonly slotIndex: bigint;
  readonly participant: string;
  readonly claimNonce: bigint;
  readonly attemptNonce: bigint;
}

export interface Gate1C2CDrawSnapshot {
  readonly drawId: bigint;
  readonly remaining: bigint;
  readonly assignedTotal: bigint;
  readonly state: Gate1C2CClaimState;
  readonly proofAttemptNonce: bigint;
  readonly proofDeadline: bigint;
}

export interface Gate1C2CEntitlementSnapshot {
  readonly slotIndex: bigint;
  readonly participant: string;
  readonly registrationVersion: bigint;
  readonly reservationNonce: bigint;
  readonly initialized: boolean;
  readonly beneficiaryBound: boolean;
  readonly residual: bigint;
}

interface MutableEntitlement {
  readonly slotIndex: bigint;
  readonly participant: string;
  readonly registrationVersion: bigint;
  readonly reservationNonce: bigint;
  readonly initialized: boolean;
  readonly beneficiaryBound: boolean;
  residual: bigint;
}

interface PendingClaimProof {
  readonly slotIndex: bigint;
  readonly participant: string;
  readonly claimNonce: bigint;
  complete: boolean;
}

interface MutableDraw {
  readonly drawId: bigint;
  remaining: bigint;
  readonly assignedTotal: bigint;
  state: Gate1C2CClaimState;
  proofAttemptNonce: bigint;
  proofDeadline: bigint;
  pending: PendingClaimProof | null;
  readonly entitlements: Map<bigint, MutableEntitlement>;
}

const requireNonNegative = (value: bigint, name: string): void => {
  if (value < 0n) {
    throw new RangeError(name + " must be non-negative");
  }
};

const requireIdentifier = (value: string, name: string): void => {
  if (value.length === 0) {
    throw new Error(name + " must not be empty");
  }
};

const minimum = (a: bigint, b: bigint): bigint => (a < b ? a : b);

export class Gate1C2CClaimAuthorizationModel {
  private rawTokenBalanceValue = 0n;
  private accountedReserveAssetsValue = 0n;
  private outstandingPrizeLiabilitiesValue = 0n;

  private readonly draws = new Map<bigint, MutableDraw>();
  private readonly claimNonces = new Map<string, bigint>();

  public constructor(
    private readonly chainId: bigint,
    private readonly reserveId: string,
    private readonly poolId: string,
  ) {
    requireNonNegative(chainId, "chainId");
    requireIdentifier(reserveId, "reserve");
    requireIdentifier(poolId, "pool");
  }

  public fundReserve(actualTransferred: bigint): void {
    requireNonNegative(actualTransferred, "actualTransferred");

    this.rawTokenBalanceValue += actualTransferred;
    this.accountedReserveAssetsValue += actualTransferred;

    this.assertSolvent();
  }

  public directDonation(actualTransferred: bigint): void {
    requireNonNegative(actualTransferred, "actualTransferred");

    this.rawTokenBalanceValue += actualTransferred;

    this.assertSolvent();
  }

  public addClaimableDraw(
    drawId: bigint,
    remaining: bigint,
    assignedTotal: bigint,
    inputs: readonly Gate1C2CHistoricalEntitlementInput[],
  ): void {
    requireNonNegative(drawId, "drawId");
    requireNonNegative(remaining, "remaining");
    requireNonNegative(assignedTotal, "assignedTotal");

    if (remaining === 0n) {
      throw new Error("claimable draw must have nonzero remaining");
    }

    if (this.draws.has(drawId)) {
      throw new Error("draw already exists");
    }

    const entitlements = new Map<bigint, MutableEntitlement>();

    for (const input of inputs) {
      requireNonNegative(input.slotIndex, "slotIndex");
      requireNonNegative(input.registrationVersion, "registrationVersion");
      requireNonNegative(input.reservationNonce, "reservationNonce");
      requireNonNegative(input.residual, "residual");

      if (entitlements.has(input.slotIndex)) {
        throw new Error("duplicate entitlement slot");
      }

      if (input.beneficiaryBound) {
        requireIdentifier(input.participant, "participant");
      }

      entitlements.set(input.slotIndex, {
        slotIndex: input.slotIndex,
        participant: input.participant,
        registrationVersion: input.registrationVersion,
        reservationNonce: input.reservationNonce,
        initialized: input.initialized,
        beneficiaryBound: input.beneficiaryBound,
        residual: input.residual,
      });
    }

    const projectedLiabilities = this.outstandingPrizeLiabilitiesValue + remaining;

    if (projectedLiabilities > this.accountedReserveAssetsValue) {
      throw new Error("reserve solvency invariant violated");
    }

    this.draws.set(drawId, {
      drawId,
      remaining,
      assignedTotal,
      state: "Claimable",
      proofAttemptNonce: 0n,
      proofDeadline: 0n,
      pending: null,
      entitlements,
    });

    this.outstandingPrizeLiabilitiesValue = projectedLiabilities;

    this.assertSolvent();
  }

  public beginClaim(
    caller: string,
    authorization: Gate1C2CClaimAuthorization,
    signer: string,
    outcome: Gate1C2CTokenOutcome,
    now: bigint,
    signedAuthorization: Gate1C2CClaimAuthorization = authorization,
  ): void {
    requireIdentifier(caller, "caller");
    requireIdentifier(signer, "signer");
    requireNonNegative(now, "now");
    requireNonNegative(outcome.actualTransferred, "actualTransferred");

    const draw = this.requireDraw(authorization.drawId);

    if (draw.state !== "Claimable") {
      throw new Error("prize is not claimable");
    }

    const entitlement = this.requireEntitlement(draw, authorization.slotIndex);

    if (!entitlement.initialized) {
      throw new Error("entitlement is not initialized");
    }

    if (!entitlement.beneficiaryBound) {
      throw new Error("entitlement beneficiary is not bound");
    }

    requireIdentifier(entitlement.participant, "historical participant");

    const expectedNonce = this.nextClaimNonce(entitlement.participant);

    this.requireExactSignedAuthorization(authorization, signedAuthorization);

    this.validateAuthorization(authorization, entitlement, signer, expectedNonce, now);

    const requested = minimum(entitlement.residual, draw.remaining);

    if (outcome.actualTransferred > requested) {
      throw new RangeError("actual transfer exceeds authorized residual");
    }

    if (outcome.actualTransferred > this.rawTokenBalanceValue) {
      throw new RangeError("actual transfer exceeds reserve custody");
    }

    if (!outcome.succeeded) {
      throw new Error("token transfer reverted");
    }

    if (!outcome.returnAclPresent) {
      throw new Error("missing token return acl");
    }

    this.claimNonces.set(entitlement.participant, expectedNonce + 1n);

    entitlement.residual -= outcome.actualTransferred;
    draw.remaining -= outcome.actualTransferred;

    this.outstandingPrizeLiabilitiesValue -= outcome.actualTransferred;
    this.accountedReserveAssetsValue -= outcome.actualTransferred;
    this.rawTokenBalanceValue -= outcome.actualTransferred;

    draw.proofAttemptNonce += 1n;
    draw.proofDeadline = now + GATE1C2C_CLAIM_PROOF_TTL_SECONDS;

    draw.pending = {
      slotIndex: entitlement.slotIndex,
      participant: entitlement.participant,
      claimNonce: authorization.nonce,
      complete: draw.remaining === 0n,
    };

    draw.state = "TransferProofPending";

    this.assertSolvent();
  }

  public settleClaim(
    drawId: bigint,
    context: Gate1C2CClaimProofContext,
    clearComplete: boolean,
    now: bigint,
  ): void {
    requireNonNegative(now, "now");

    const draw = this.requireDraw(drawId);

    if (draw.state !== "TransferProofPending" || draw.pending === null) {
      throw new Error("claim proof is not pending");
    }

    if (now > draw.proofDeadline) {
      throw new Error("claim proof expired");
    }

    this.requireProofContext(draw, context);

    if (clearComplete !== draw.pending.complete) {
      throw new Error("invalid claim completion proof");
    }

    draw.pending = null;
    draw.proofDeadline = 0n;
    draw.state = clearComplete ? "Claimed" : "Claimable";
  }

  public refreshClaimCompletionEvidence(
    drawId: bigint,
    expectedAttemptNonce: bigint,
    now: bigint,
  ): void {
    requireNonNegative(now, "now");

    const draw = this.requireDraw(drawId);

    if (draw.state !== "TransferProofPending" || draw.pending === null) {
      throw new Error("claim proof is not pending");
    }

    if (expectedAttemptNonce !== draw.proofAttemptNonce) {
      throw new Error("claim proof attempt mismatch");
    }

    if (now < draw.proofDeadline || now === draw.proofDeadline) {
      throw new Error("claim proof not expired");
    }

    draw.proofAttemptNonce += 1n;
    draw.proofDeadline = now + GATE1C2C_CLAIM_PROOF_TTL_SECONDS;
    draw.pending.complete = draw.remaining === 0n;
  }

  public currentProofContext(drawId: bigint): Gate1C2CClaimProofContext {
    const draw = this.requireDraw(drawId);

    if (draw.state !== "TransferProofPending" || draw.pending === null) {
      throw new Error("claim proof is not pending");
    }

    return {
      chainId: this.chainId,
      reserve: this.reserveId,
      pool: this.poolId,
      drawId: draw.drawId,
      slotIndex: draw.pending.slotIndex,
      participant: draw.pending.participant,
      claimNonce: draw.pending.claimNonce,
      attemptNonce: draw.proofAttemptNonce,
    };
  }

  public snapshot(drawId: bigint): Gate1C2CDrawSnapshot {
    const draw = this.requireDraw(drawId);

    return {
      drawId: draw.drawId,
      remaining: draw.remaining,
      assignedTotal: draw.assignedTotal,
      state: draw.state,
      proofAttemptNonce: draw.proofAttemptNonce,
      proofDeadline: draw.proofDeadline,
    };
  }

  public entitlement(drawId: bigint, slotIndex: bigint): Gate1C2CEntitlementSnapshot {
    const draw = this.requireDraw(drawId);
    const entitlement = this.requireEntitlement(draw, slotIndex);

    return {
      slotIndex: entitlement.slotIndex,
      participant: entitlement.participant,
      registrationVersion: entitlement.registrationVersion,
      reservationNonce: entitlement.reservationNonce,
      initialized: entitlement.initialized,
      beneficiaryBound: entitlement.beneficiaryBound,
      residual: entitlement.residual,
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

  private requireExactSignedAuthorization(
    authorization: Gate1C2CClaimAuthorization,
    signedAuthorization: Gate1C2CClaimAuthorization,
  ): void {
    if (
      signedAuthorization.chainId !== authorization.chainId ||
      signedAuthorization.reserve !== authorization.reserve ||
      signedAuthorization.pool !== authorization.pool ||
      signedAuthorization.drawId !== authorization.drawId ||
      signedAuthorization.slotIndex !== authorization.slotIndex ||
      signedAuthorization.participant !== authorization.participant ||
      signedAuthorization.recipient !== authorization.recipient ||
      signedAuthorization.registrationVersion !== authorization.registrationVersion ||
      signedAuthorization.reservationNonce !== authorization.reservationNonce ||
      signedAuthorization.nonce !== authorization.nonce ||
      signedAuthorization.expiry !== authorization.expiry
    ) {
      throw new Error("signed authorization payload mismatch");
    }
  }

  private validateAuthorization(
    authorization: Gate1C2CClaimAuthorization,
    entitlement: MutableEntitlement,
    signer: string,
    expectedNonce: bigint,
    now: bigint,
  ): void {
    if (
      authorization.chainId !== this.chainId ||
      authorization.reserve !== this.reserveId ||
      authorization.pool !== this.poolId ||
      authorization.slotIndex !== entitlement.slotIndex ||
      authorization.participant !== entitlement.participant ||
      authorization.recipient !== entitlement.participant ||
      authorization.registrationVersion !== entitlement.registrationVersion ||
      authorization.reservationNonce !== entitlement.reservationNonce ||
      authorization.nonce !== expectedNonce ||
      authorization.expiry === 0n ||
      now > authorization.expiry ||
      signer !== entitlement.participant
    ) {
      throw new Error("invalid claim authorization");
    }
  }

  private requireProofContext(draw: MutableDraw, context: Gate1C2CClaimProofContext): void {
    if (draw.pending === null) {
      throw new Error("claim proof is not pending");
    }

    if (
      context.chainId !== this.chainId ||
      context.reserve !== this.reserveId ||
      context.pool !== this.poolId ||
      context.drawId !== draw.drawId ||
      context.slotIndex !== draw.pending.slotIndex ||
      context.participant !== draw.pending.participant ||
      context.claimNonce !== draw.pending.claimNonce ||
      context.attemptNonce !== draw.proofAttemptNonce
    ) {
      throw new Error("claim proof domain mismatch");
    }
  }

  private requireDraw(drawId: bigint): MutableDraw {
    const draw = this.draws.get(drawId);

    if (draw === undefined) {
      throw new Error("unknown draw");
    }

    return draw;
  }

  private requireEntitlement(draw: MutableDraw, slotIndex: bigint): MutableEntitlement {
    const entitlement = draw.entitlements.get(slotIndex);

    if (entitlement === undefined) {
      throw new Error("unknown entitlement slot");
    }

    return entitlement;
  }
}
