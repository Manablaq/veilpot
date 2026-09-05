import { PARTICIPANT_STATE, SUPPORTED_REGISTRATION_VERSION } from "@veilpot/protocol-sdk";

export type RecoveryAddress = `0x${string}`;
export type RecoveryHex = `0x${string}`;

export const REFUND_SETTLEMENT_REVIEW_MAX_AGE_SECONDS = 5 * 60;

export interface RefundParticipantBinding {
  readonly slotIndex: bigint;
  readonly state: number;
  readonly owner: RecoveryAddress;
  readonly registrationVersion: bigint;
  readonly reservationNonce: bigint;
  readonly refundAttemptNonce: bigint;
}

export interface RefundSettlementReview {
  readonly holder: RecoveryAddress;
  readonly pool: RecoveryAddress;
  readonly chainId: number;
  readonly network: "Ethereum Sepolia";

  readonly participant: RefundParticipantBinding;

  readonly refundCompleteHandle: RecoveryHex;

  readonly clearComplete: boolean;

  readonly decryptionProof: RecoveryHex;

  readonly calldata: RecoveryHex;

  readonly accountNonce: number;

  readonly preparedAt: number;

  readonly simulatedAt: number;
}

export interface RefundSettlementReviewContext {
  readonly holder: RecoveryAddress | undefined;

  readonly pool: RecoveryAddress;

  readonly chainId: number | undefined;

  readonly participant: RefundParticipantBinding | null;

  readonly refundCompleteHandle: RecoveryHex;

  readonly currentCalldata: RecoveryHex;

  readonly accountNonce: number;

  readonly nowSeconds: number;
}

function sameAddress(left: RecoveryAddress, right: RecoveryAddress): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function isAddress(value: unknown): value is RecoveryAddress {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
}

function isHex(value: unknown): value is RecoveryHex {
  return typeof value === "string" && /^0x(?:[0-9a-fA-F]{2})+$/.test(value);
}

function isBytes32(value: unknown): value is RecoveryHex {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

function assertParticipant(participant: RefundParticipantBinding, holder: RecoveryAddress): void {
  if (participant.state !== PARTICIPANT_STATE.REFUND_ATTEMPT_PENDING_PROOF) {
    throw new Error("The refund participant is not REFUND_ATTEMPT_PENDING_PROOF.");
  }

  if (!sameAddress(participant.owner, holder)) {
    throw new Error("The refund participant belongs to a different wallet.");
  }

  if (participant.registrationVersion !== SUPPORTED_REGISTRATION_VERSION) {
    throw new Error("The refund participant registration version is unsupported.");
  }

  if (
    participant.slotIndex < 0n ||
    participant.reservationNonce < 0n ||
    participant.refundAttemptNonce <= 0n
  ) {
    throw new RangeError("The refund participant binding is invalid.");
  }
}

export function createRefundSettlementReview(input: {
  readonly holder: RecoveryAddress;
  readonly pool: RecoveryAddress;
  readonly chainId: number;

  readonly participant: RefundParticipantBinding;

  readonly refundCompleteHandle: RecoveryHex;

  readonly clearComplete: boolean;

  readonly decryptionProof: RecoveryHex;

  readonly calldata: RecoveryHex;

  readonly accountNonce: number;

  readonly preparedAt: number;

  readonly simulatedAt: number;
}): RefundSettlementReview {
  if (!isAddress(input.holder) || !isAddress(input.pool)) {
    throw new Error("The refund settlement review contains an invalid address.");
  }

  assertParticipant(input.participant, input.holder);

  if (!isBytes32(input.refundCompleteHandle)) {
    throw new Error("The refund-complete handle is not bytes32.");
  }

  if (!isHex(input.decryptionProof) || input.decryptionProof === "0x") {
    throw new Error("The public refund-completion proof is empty or malformed.");
  }

  if (!isHex(input.calldata) || input.calldata.length <= 10) {
    throw new Error("The refund-completion settlement calldata is malformed.");
  }

  if (!Number.isSafeInteger(input.chainId) || input.chainId <= 0) {
    throw new RangeError("The reviewed chain ID is invalid.");
  }

  if (!Number.isSafeInteger(input.accountNonce) || input.accountNonce < 0) {
    throw new RangeError("The reviewed wallet transaction nonce is invalid.");
  }

  if (!Number.isInteger(input.preparedAt) || !Number.isInteger(input.simulatedAt)) {
    throw new RangeError("Refund review timestamps must be integer Unix seconds.");
  }

  if (input.simulatedAt < input.preparedAt) {
    throw new RangeError("Refund settlement simulation cannot predate preparation.");
  }

  return {
    holder: input.holder,
    pool: input.pool,
    chainId: input.chainId,
    network: "Ethereum Sepolia",
    participant: input.participant,
    refundCompleteHandle: input.refundCompleteHandle,
    clearComplete: input.clearComplete,
    decryptionProof: input.decryptionProof,
    calldata: input.calldata,
    accountNonce: input.accountNonce,
    preparedAt: input.preparedAt,
    simulatedAt: input.simulatedAt,
  };
}

export function refundSettlementReviewInvalidReason(
  review: RefundSettlementReview,
  context: RefundSettlementReviewContext,
): string | null {
  if (context.holder === undefined || !sameAddress(review.holder, context.holder)) {
    return "The connected wallet changed.";
  }

  if (!sameAddress(review.pool, context.pool)) {
    return "The active PoolV2.x deployment changed.";
  }

  if (context.chainId !== review.chainId) {
    return "The wallet network changed.";
  }

  if (context.participant === null) {
    return "The refund-proof participant is no longer available.";
  }

  const participant = context.participant;

  if (
    participant.slotIndex !== review.participant.slotIndex ||
    participant.state !== PARTICIPANT_STATE.REFUND_ATTEMPT_PENDING_PROOF ||
    !sameAddress(participant.owner, review.participant.owner) ||
    participant.registrationVersion !== review.participant.registrationVersion ||
    participant.reservationNonce !== review.participant.reservationNonce ||
    participant.refundAttemptNonce !== review.participant.refundAttemptNonce
  ) {
    return "The refund-proof participant binding changed.";
  }

  if (context.refundCompleteHandle.toLowerCase() !== review.refundCompleteHandle.toLowerCase()) {
    return "The refund-complete handle changed.";
  }

  if (context.currentCalldata.toLowerCase() !== review.calldata.toLowerCase()) {
    return "The exact refund settlement calldata changed.";
  }

  if (context.accountNonce !== review.accountNonce) {
    return "The wallet transaction nonce changed.";
  }

  if (context.nowSeconds < review.preparedAt) {
    return "The refund settlement review clock moved backwards.";
  }

  if (context.nowSeconds - review.preparedAt > REFUND_SETTLEMENT_REVIEW_MAX_AGE_SECONDS) {
    return "The refund settlement review became stale.";
  }

  return null;
}
