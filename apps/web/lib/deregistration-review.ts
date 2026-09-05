import { PARTICIPANT_STATE, SUPPORTED_REGISTRATION_VERSION } from "@veilpot/protocol-sdk";

export type DeregistrationAddress = `0x${string}`;
export type DeregistrationHex = `0x${string}`;

export const DEREGISTRATION_REVIEW_MAX_AGE_SECONDS = 5 * 60;

export interface DeregistrationParticipantBinding {
  readonly slotIndex: bigint;
  readonly state: number;
  readonly owner: DeregistrationAddress;
  readonly registrationVersion: bigint;
  readonly reservationNonce: bigint;
}

export interface DeregistrationSettlementReview {
  readonly holder: DeregistrationAddress;
  readonly pool: DeregistrationAddress;
  readonly chainId: number;
  readonly network: "Ethereum Sepolia";

  readonly participant: DeregistrationParticipantBinding;

  readonly zeroHandle: DeregistrationHex;

  readonly clearZero: true;

  readonly decryptionProof: DeregistrationHex;

  readonly calldata: DeregistrationHex;

  readonly accountNonce: number;

  readonly preparedAt: number;

  readonly simulatedAt: number;
}

export interface DeregistrationReviewContext {
  readonly holder: DeregistrationAddress | undefined;

  readonly pool: DeregistrationAddress;

  readonly chainId: number | undefined;

  readonly participant: DeregistrationParticipantBinding | null;

  readonly zeroHandle: DeregistrationHex;

  readonly currentCalldata: DeregistrationHex;

  readonly accountNonce: number;

  readonly nowSeconds: number;
}

function sameAddress(left: DeregistrationAddress, right: DeregistrationAddress): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function isAddress(value: unknown): value is DeregistrationAddress {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
}

function isHex(value: unknown): value is DeregistrationHex {
  return typeof value === "string" && /^0x(?:[0-9a-fA-F]{2})+$/.test(value);
}

function isBytes32(value: unknown): value is DeregistrationHex {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

function assertParticipant(
  participant: DeregistrationParticipantBinding,
  holder: DeregistrationAddress,
): void {
  if (participant.state !== PARTICIPANT_STATE.ACTIVE) {
    throw new Error("The deregistration participant is not ACTIVE.");
  }

  if (!sameAddress(participant.owner, holder)) {
    throw new Error("The ACTIVE participant belongs to a different wallet.");
  }

  if (participant.registrationVersion !== SUPPORTED_REGISTRATION_VERSION) {
    throw new Error("The ACTIVE participant registration version is unsupported.");
  }

  if (participant.slotIndex < 0n || participant.reservationNonce < 0n) {
    throw new RangeError("The deregistration participant binding is invalid.");
  }
}

export function createDeregistrationSettlementReview(input: {
  readonly holder: DeregistrationAddress;

  readonly pool: DeregistrationAddress;

  readonly chainId: number;

  readonly participant: DeregistrationParticipantBinding;

  readonly zeroHandle: DeregistrationHex;

  readonly clearZero: boolean;

  readonly decryptionProof: DeregistrationHex;

  readonly calldata: DeregistrationHex;

  readonly accountNonce: number;

  readonly preparedAt: number;

  readonly simulatedAt: number;
}): DeregistrationSettlementReview {
  if (!isAddress(input.holder) || !isAddress(input.pool)) {
    throw new Error("The deregistration review contains an invalid address.");
  }

  assertParticipant(input.participant, input.holder);

  if (!input.clearZero) {
    throw new Error(
      "Deregistration settlement may only be prepared when the public zero-principal consequence is TRUE.",
    );
  }

  if (!isBytes32(input.zeroHandle)) {
    throw new Error("The deregistration-zero handle is not bytes32.");
  }

  if (!isHex(input.decryptionProof) || input.decryptionProof === "0x") {
    throw new Error("The public deregistration decryption proof is empty or malformed.");
  }

  if (!isHex(input.calldata) || input.calldata.length <= 10) {
    throw new Error("The deregistration settlement calldata is malformed.");
  }

  if (!Number.isSafeInteger(input.chainId) || input.chainId <= 0) {
    throw new RangeError("The reviewed chain ID is invalid.");
  }

  if (!Number.isSafeInteger(input.accountNonce) || input.accountNonce < 0) {
    throw new RangeError("The reviewed wallet transaction nonce is invalid.");
  }

  if (!Number.isInteger(input.preparedAt) || !Number.isInteger(input.simulatedAt)) {
    throw new RangeError("Deregistration review timestamps must be integer Unix seconds.");
  }

  if (input.simulatedAt < input.preparedAt) {
    throw new RangeError("Deregistration simulation cannot predate preparation.");
  }

  return {
    holder: input.holder,
    pool: input.pool,
    chainId: input.chainId,
    network: "Ethereum Sepolia",
    participant: input.participant,
    zeroHandle: input.zeroHandle,
    clearZero: true,
    decryptionProof: input.decryptionProof,
    calldata: input.calldata,
    accountNonce: input.accountNonce,
    preparedAt: input.preparedAt,
    simulatedAt: input.simulatedAt,
  };
}

export function deregistrationReviewInvalidReason(
  review: DeregistrationSettlementReview,

  context: DeregistrationReviewContext,
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
    return "The reviewed ACTIVE participant is no longer available.";
  }

  const participant = context.participant;

  if (
    participant.slotIndex !== review.participant.slotIndex ||
    participant.state !== PARTICIPANT_STATE.ACTIVE ||
    !sameAddress(participant.owner, review.participant.owner) ||
    participant.registrationVersion !== review.participant.registrationVersion ||
    participant.reservationNonce !== review.participant.reservationNonce
  ) {
    return "The ACTIVE participant binding changed.";
  }

  if (context.zeroHandle.toLowerCase() !== review.zeroHandle.toLowerCase()) {
    return "The deregistration-zero handle changed.";
  }

  if (context.currentCalldata.toLowerCase() !== review.calldata.toLowerCase()) {
    return "The exact deregistration settlement calldata changed.";
  }

  if (context.accountNonce !== review.accountNonce) {
    return "The wallet transaction nonce changed.";
  }

  if (context.nowSeconds < review.preparedAt) {
    return "The deregistration review clock moved backwards.";
  }

  if (context.nowSeconds - review.preparedAt > DEREGISTRATION_REVIEW_MAX_AGE_SECONDS) {
    return "The deregistration settlement review became stale.";
  }

  return null;
}
