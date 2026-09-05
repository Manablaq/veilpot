export type ThresholdAddress = `0x${string}`;
export type ThresholdHex = `0x${string}`;

export const THRESHOLD_REVIEW_MAX_AGE_SECONDS = 5 * 60;
export const THRESHOLD_SUBMISSION_RECORD_VERSION = 1 as const;
export const PENDING_ACTIVATION_STATE = 2;
export const ACTIVE_STATE = 3;
export const PENDING_REFUND_STATE = 4;

export interface ThresholdParticipantBinding {
  readonly slotIndex: bigint;
  readonly state: number;
  readonly owner: ThresholdAddress;
  readonly registrationVersion: bigint;
  readonly reservationNonce: bigint;
  readonly activationDeadline: bigint;
}

export interface ThresholdSettlementReview {
  readonly holder: ThresholdAddress;
  readonly pool: ThresholdAddress;
  readonly chainId: number;
  readonly network: "Ethereum Sepolia";
  readonly participant: ThresholdParticipantBinding;
  readonly thresholdHandle: ThresholdHex;
  readonly clearSatisfied: boolean;
  readonly decryptionProof: ThresholdHex;
  readonly calldata: ThresholdHex;
  readonly accountNonce: number;
  readonly preparedAt: number;
  readonly simulatedAt: number;
}

export interface ThresholdReviewContext {
  readonly holder: ThresholdAddress | undefined;
  readonly chainId: number | undefined;
  readonly participant: ThresholdParticipantBinding | null;
  readonly thresholdHandle: ThresholdHex;
  readonly currentCalldata: ThresholdHex;
  readonly accountNonce: number;
  readonly nowSeconds: number;
}

export interface ThresholdSubmissionRecord {
  readonly version: typeof THRESHOLD_SUBMISSION_RECORD_VERSION;
  readonly holder: ThresholdAddress;
  readonly pool: ThresholdAddress;
  readonly chainId: number;
  readonly participantSlotIndex: bigint;
  readonly registrationVersion: bigint;
  readonly reservationNonce: bigint;
  readonly activationDeadline: bigint;
  readonly thresholdHandle: ThresholdHex;
  readonly clearSatisfied: boolean;
  readonly accountNonce: number;
  readonly calldata: ThresholdHex;
  readonly hash: ThresholdHex | null;
}

function sameAddress(left: ThresholdAddress, right: ThresholdAddress): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function isAddress(value: unknown): value is ThresholdAddress {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
}

function isHex(value: unknown): value is ThresholdHex {
  return typeof value === "string" && /^0x(?:[0-9a-fA-F]{2})*$/.test(value);
}

function isBytes32(value: unknown): value is ThresholdHex {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

export function parsePublicBoolean(value: unknown): boolean {
  if (value === true || value === false) return value;
  if (value === 1n || value === 1 || value === "1" || value === "true") return true;
  if (value === 0n || value === 0 || value === "0" || value === "false") return false;
  throw new Error("The publicly decrypted threshold value is not a canonical boolean.");
}

export function createThresholdSettlementReview(input: {
  readonly holder: ThresholdAddress;
  readonly pool: ThresholdAddress;
  readonly chainId: number;
  readonly participant: ThresholdParticipantBinding;
  readonly thresholdHandle: ThresholdHex;
  readonly clearSatisfied: boolean;
  readonly decryptionProof: ThresholdHex;
  readonly calldata: ThresholdHex;
  readonly accountNonce: number;
  readonly preparedAt: number;
  readonly simulatedAt: number;
}): ThresholdSettlementReview {
  if (!isAddress(input.holder) || !isAddress(input.pool)) {
    throw new Error("The threshold settlement review contains an invalid address.");
  }
  if (input.participant.state !== PENDING_ACTIVATION_STATE) {
    throw new Error("The participant is not PENDING_ACTIVATION.");
  }
  if (!sameAddress(input.participant.owner, input.holder)) {
    throw new Error("The pending activation belongs to a different wallet.");
  }
  if (!isBytes32(input.thresholdHandle)) {
    throw new Error("The threshold handle is not bytes32.");
  }
  if (!isHex(input.decryptionProof) || input.decryptionProof === "0x") {
    throw new Error("The public threshold decryption proof is empty or malformed.");
  }
  if (!isHex(input.calldata) || input.calldata.length <= 10) {
    throw new Error("The threshold settlement calldata is malformed.");
  }
  if (!Number.isSafeInteger(input.accountNonce) || input.accountNonce < 0) {
    throw new RangeError("The reviewed wallet transaction nonce is invalid.");
  }
  if (!Number.isInteger(input.preparedAt) || !Number.isInteger(input.simulatedAt)) {
    throw new RangeError("Threshold review timestamps must be integer Unix seconds.");
  }
  if (input.simulatedAt < input.preparedAt) {
    throw new RangeError("Threshold settlement simulation cannot predate preparation.");
  }

  return {
    holder: input.holder,
    pool: input.pool,
    chainId: input.chainId,
    network: "Ethereum Sepolia",
    participant: input.participant,
    thresholdHandle: input.thresholdHandle,
    clearSatisfied: input.clearSatisfied,
    decryptionProof: input.decryptionProof,
    calldata: input.calldata,
    accountNonce: input.accountNonce,
    preparedAt: input.preparedAt,
    simulatedAt: input.simulatedAt,
  };
}

export function thresholdReviewInvalidReason(
  review: ThresholdSettlementReview,
  context: ThresholdReviewContext,
): string | null {
  if (context.holder === undefined || !sameAddress(review.holder, context.holder)) {
    return "The connected wallet changed.";
  }
  if (context.chainId !== review.chainId) {
    return "The wallet network changed.";
  }
  if (context.participant === null) {
    return "The pending participant is no longer available.";
  }

  const participant = context.participant;
  if (
    participant.slotIndex !== review.participant.slotIndex ||
    participant.state !== PENDING_ACTIVATION_STATE ||
    !sameAddress(participant.owner, review.participant.owner) ||
    participant.registrationVersion !== review.participant.registrationVersion ||
    participant.reservationNonce !== review.participant.reservationNonce ||
    participant.activationDeadline !== review.participant.activationDeadline
  ) {
    return "The pending-activation binding changed.";
  }

  if (BigInt(context.nowSeconds) > participant.activationDeadline) {
    return "The activation-proof deadline expired.";
  }
  if (context.thresholdHandle.toLowerCase() !== review.thresholdHandle.toLowerCase()) {
    return "The threshold handle changed.";
  }
  if (context.currentCalldata.toLowerCase() !== review.calldata.toLowerCase()) {
    return "The exact settlement calldata changed.";
  }
  if (context.accountNonce !== review.accountNonce) {
    return "The wallet transaction nonce changed.";
  }
  if (context.nowSeconds - review.preparedAt > THRESHOLD_REVIEW_MAX_AGE_SECONDS) {
    return "The threshold settlement review became stale.";
  }

  return null;
}

export function createThresholdSubmissionRecord(
  review: ThresholdSettlementReview,
  hash: ThresholdHex | null,
): ThresholdSubmissionRecord {
  return {
    version: THRESHOLD_SUBMISSION_RECORD_VERSION,
    holder: review.holder,
    pool: review.pool,
    chainId: review.chainId,
    participantSlotIndex: review.participant.slotIndex,
    registrationVersion: review.participant.registrationVersion,
    reservationNonce: review.participant.reservationNonce,
    activationDeadline: review.participant.activationDeadline,
    thresholdHandle: review.thresholdHandle,
    clearSatisfied: review.clearSatisfied,
    accountNonce: review.accountNonce,
    calldata: review.calldata,
    hash,
  };
}

export function withThresholdSubmissionHash(
  record: ThresholdSubmissionRecord,
  hash: ThresholdHex,
): ThresholdSubmissionRecord {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) {
    throw new Error("The threshold settlement transaction hash is invalid.");
  }
  return { ...record, hash };
}

export function serializeThresholdSubmissionRecord(record: ThresholdSubmissionRecord): string {
  return JSON.stringify({
    ...record,
    participantSlotIndex: record.participantSlotIndex.toString(),
    registrationVersion: record.registrationVersion.toString(),
    reservationNonce: record.reservationNonce.toString(),
    activationDeadline: record.activationDeadline.toString(),
  });
}

export function parseThresholdSubmissionRecord(value: string): ThresholdSubmissionRecord | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null) return null;
    const candidate = parsed as Record<string, unknown>;

    if (
      candidate.version !== THRESHOLD_SUBMISSION_RECORD_VERSION ||
      !isAddress(candidate.holder) ||
      !isAddress(candidate.pool) ||
      typeof candidate.chainId !== "number" ||
      typeof candidate.participantSlotIndex !== "string" ||
      typeof candidate.registrationVersion !== "string" ||
      typeof candidate.reservationNonce !== "string" ||
      typeof candidate.activationDeadline !== "string" ||
      !isBytes32(candidate.thresholdHandle) ||
      typeof candidate.clearSatisfied !== "boolean" ||
      typeof candidate.accountNonce !== "number" ||
      !isHex(candidate.calldata) ||
      (candidate.hash !== null &&
        (typeof candidate.hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(candidate.hash)))
    ) {
      return null;
    }

    if (!Number.isSafeInteger(candidate.accountNonce) || candidate.accountNonce < 0) return null;

    return {
      version: THRESHOLD_SUBMISSION_RECORD_VERSION,
      holder: candidate.holder,
      pool: candidate.pool,
      chainId: candidate.chainId,
      participantSlotIndex: BigInt(candidate.participantSlotIndex),
      registrationVersion: BigInt(candidate.registrationVersion),
      reservationNonce: BigInt(candidate.reservationNonce),
      activationDeadline: BigInt(candidate.activationDeadline),
      thresholdHandle: candidate.thresholdHandle,
      clearSatisfied: candidate.clearSatisfied,
      accountNonce: candidate.accountNonce,
      calldata: candidate.calldata,
      hash: candidate.hash as ThresholdHex | null,
    };
  } catch {
    return null;
  }
}

export function thresholdSettlementTransactionInvalidReason(
  record: ThresholdSubmissionRecord,
  transaction: {
    readonly from: ThresholdAddress;
    readonly to: ThresholdAddress | null;
    readonly input: ThresholdHex;
    readonly nonce: number;
    readonly value: bigint;
  },
): string | null {
  if (!sameAddress(record.holder, transaction.from)) {
    return "The mined settlement sender does not match the reviewed holder.";
  }
  if (transaction.to === null || !sameAddress(record.pool, transaction.to)) {
    return "The mined settlement target does not match the reviewed Pool.";
  }
  if (transaction.input.toLowerCase() !== record.calldata.toLowerCase()) {
    return "The mined settlement calldata does not match the reviewed threshold proof.";
  }
  if (transaction.nonce !== record.accountNonce) {
    return "The mined settlement nonce does not match the reviewed wallet nonce.";
  }
  if (transaction.value !== 0n) {
    return "The threshold settlement unexpectedly transferred native ETH.";
  }
  return null;
}
