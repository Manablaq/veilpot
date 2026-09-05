export type DepositAddress = `0x${string}`;
export type DepositHex = `0x${string}`;

export const MIN_REGISTRATION_DEPOSIT_BASE_UNITS = 1_000_000n;
export const MAX_REGISTRATION_DEPOSIT_BASE_UNITS = 1_000_000_000_000n;
export const DEPOSIT_REVIEW_MAX_AGE_SECONDS = 5 * 60;
export const DEPOSIT_SUBMISSION_RECORD_VERSION = 1 as const;
export const RESERVED_PARTICIPANT_STATE = 1;

export interface DepositParticipantBinding {
  readonly slotIndex: bigint;
  readonly state: number;
  readonly owner: DepositAddress;
  readonly registrationVersion: bigint;
  readonly reservationNonce: bigint;
  readonly reservationExpiry: bigint;
  readonly bondHeld: boolean;
}

export interface DepositReview {
  readonly holder: DepositAddress;
  readonly token: DepositAddress;
  readonly pool: DepositAddress;
  readonly chainId: number;
  readonly network: "Ethereum Sepolia";
  readonly participant: DepositParticipantBinding;
  readonly amountBaseUnits: bigint;
  readonly amountDisplay: string;
  readonly tokenSymbol: string;
  readonly tokenDecimals: number;
  readonly depositNonce: bigint;
  readonly accountNonce: number;
  readonly encryptedValue: DepositHex;
  readonly inputProof: DepositHex;
  readonly calldata: DepositHex;
  readonly preparedAt: number;
  readonly simulatedAt: number;
}

export interface DepositReviewContext {
  readonly holder: DepositAddress | undefined;
  readonly chainId: number | undefined;
  readonly participant: DepositParticipantBinding | null;
  readonly amountBaseUnits: bigint | null;
  readonly depositNonce: bigint;
  readonly accountNonce: number;
  readonly operatorActive: boolean;
  readonly currentCalldata: DepositHex;
  readonly nowSeconds: number;
}

export interface DepositSubmissionRecord {
  readonly version: typeof DEPOSIT_SUBMISSION_RECORD_VERSION;
  readonly holder: DepositAddress;
  readonly token: DepositAddress;
  readonly pool: DepositAddress;
  readonly chainId: number;
  readonly participantSlotIndex: bigint;
  readonly reservationNonce: bigint;
  readonly depositNonce: bigint;
  readonly accountNonce: number;
  readonly calldata: DepositHex;
  readonly hash: DepositHex | null;
}

function sameAddress(left: DepositAddress, right: DepositAddress): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function isAddress(value: unknown): value is DepositAddress {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
}

function isHex(value: unknown): value is DepositHex {
  return typeof value === "string" && /^0x(?:[0-9a-fA-F]{2})+$/.test(value);
}

function assertDepositAmount(amountBaseUnits: bigint): void {
  if (
    amountBaseUnits < MIN_REGISTRATION_DEPOSIT_BASE_UNITS ||
    amountBaseUnits > MAX_REGISTRATION_DEPOSIT_BASE_UNITS
  ) {
    throw new RangeError(
      "Registration deposit must be between 1.000000 and 1,000,000.000000 token units.",
    );
  }
}

function assertParticipant(binding: DepositParticipantBinding, holder: DepositAddress): void {
  if (binding.state !== RESERVED_PARTICIPANT_STATE) {
    throw new Error("The participant is not RESERVED.");
  }
  if (!sameAddress(binding.owner, holder)) {
    throw new Error("The RESERVED participant is owned by a different wallet.");
  }
  if (!binding.bondHeld) {
    throw new Error("The RESERVED participant no longer has its registration bond held.");
  }
}

export function createDepositReview(input: {
  readonly holder: DepositAddress;
  readonly token: DepositAddress;
  readonly pool: DepositAddress;
  readonly chainId: number;
  readonly participant: DepositParticipantBinding;
  readonly amountBaseUnits: bigint;
  readonly amountDisplay: string;
  readonly tokenSymbol: string;
  readonly tokenDecimals: number;
  readonly depositNonce: bigint;
  readonly accountNonce: number;
  readonly encryptedValue: DepositHex;
  readonly inputProof: DepositHex;
  readonly calldata: DepositHex;
  readonly preparedAt: number;
  readonly simulatedAt: number;
}): DepositReview {
  assertDepositAmount(input.amountBaseUnits);
  assertParticipant(input.participant, input.holder);

  if (!isAddress(input.holder) || !isAddress(input.token) || !isAddress(input.pool)) {
    throw new Error("The reviewed deposit contains an invalid address.");
  }
  if (!isHex(input.encryptedValue) || !isHex(input.inputProof) || !isHex(input.calldata)) {
    throw new Error("The reviewed deposit contains invalid encrypted input or calldata.");
  }
  if (input.tokenDecimals !== 6) {
    throw new Error("The configured cUSDT testnet mock must expose 6 decimals.");
  }
  if (!Number.isSafeInteger(input.accountNonce) || input.accountNonce < 0) {
    throw new RangeError("The reviewed account nonce is invalid.");
  }
  if (!Number.isInteger(input.preparedAt) || !Number.isInteger(input.simulatedAt)) {
    throw new RangeError("Deposit review timestamps must be integer Unix seconds.");
  }
  if (input.simulatedAt < input.preparedAt) {
    throw new RangeError("Deposit simulation cannot predate review preparation.");
  }

  return {
    holder: input.holder,
    token: input.token,
    pool: input.pool,
    chainId: input.chainId,
    network: "Ethereum Sepolia",
    participant: input.participant,
    amountBaseUnits: input.amountBaseUnits,
    amountDisplay: input.amountDisplay,
    tokenSymbol: input.tokenSymbol,
    tokenDecimals: input.tokenDecimals,
    depositNonce: input.depositNonce,
    accountNonce: input.accountNonce,
    encryptedValue: input.encryptedValue,
    inputProof: input.inputProof,
    calldata: input.calldata,
    preparedAt: input.preparedAt,
    simulatedAt: input.simulatedAt,
  };
}

export function depositReviewInvalidReason(
  review: DepositReview,
  context: DepositReviewContext,
): string | null {
  if (context.holder === undefined || !sameAddress(review.holder, context.holder)) {
    return "The connected wallet changed.";
  }
  if (context.chainId !== review.chainId) {
    return "The wallet network changed.";
  }
  if (context.participant === null) {
    return "The reviewed participant is no longer available.";
  }

  const participant = context.participant;
  if (
    participant.slotIndex !== review.participant.slotIndex ||
    participant.state !== review.participant.state ||
    !sameAddress(participant.owner, review.participant.owner) ||
    participant.registrationVersion !== review.participant.registrationVersion ||
    participant.reservationNonce !== review.participant.reservationNonce ||
    participant.reservationExpiry !== review.participant.reservationExpiry ||
    participant.bondHeld !== review.participant.bondHeld
  ) {
    return "The RESERVED participant binding changed.";
  }

  if (BigInt(context.nowSeconds) >= participant.reservationExpiry) {
    return "The RESERVED participant registration expired.";
  }
  if (!context.operatorActive) {
    return "The Pool operator permission is not active.";
  }
  if (context.amountBaseUnits === null || context.amountBaseUnits !== review.amountBaseUnits) {
    return "The deposit amount changed.";
  }
  if (context.depositNonce !== review.depositNonce) {
    return "The Pool deposit nonce changed.";
  }
  if (context.accountNonce !== review.accountNonce) {
    return "The wallet transaction nonce changed.";
  }
  if (context.currentCalldata.toLowerCase() !== review.calldata.toLowerCase()) {
    return "The reviewed confidential-deposit calldata changed.";
  }
  if (context.nowSeconds - review.preparedAt > DEPOSIT_REVIEW_MAX_AGE_SECONDS) {
    return "The confidential-deposit review became stale.";
  }

  return null;
}

export function createDepositSubmissionRecord(
  review: DepositReview,
  hash: DepositHex | null,
): DepositSubmissionRecord {
  return {
    version: DEPOSIT_SUBMISSION_RECORD_VERSION,
    holder: review.holder,
    token: review.token,
    pool: review.pool,
    chainId: review.chainId,
    participantSlotIndex: review.participant.slotIndex,
    reservationNonce: review.participant.reservationNonce,
    depositNonce: review.depositNonce,
    accountNonce: review.accountNonce,
    calldata: review.calldata,
    hash,
  };
}

export function withDepositSubmissionHash(
  record: DepositSubmissionRecord,
  hash: DepositHex,
): DepositSubmissionRecord {
  if (!isHex(hash) || hash.length !== 66) {
    throw new Error("The submitted deposit transaction hash is invalid.");
  }
  return { ...record, hash };
}

export function serializeDepositSubmissionRecord(record: DepositSubmissionRecord): string {
  return JSON.stringify({
    ...record,
    participantSlotIndex: record.participantSlotIndex.toString(),
    reservationNonce: record.reservationNonce.toString(),
    depositNonce: record.depositNonce.toString(),
  });
}

export function parseDepositSubmissionRecord(value: string): DepositSubmissionRecord | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null) return null;

    const candidate = parsed as Record<string, unknown>;
    if (candidate.version !== DEPOSIT_SUBMISSION_RECORD_VERSION) return null;

    if (
      !isAddress(candidate.holder) ||
      !isAddress(candidate.token) ||
      !isAddress(candidate.pool) ||
      typeof candidate.chainId !== "number" ||
      typeof candidate.participantSlotIndex !== "string" ||
      typeof candidate.reservationNonce !== "string" ||
      typeof candidate.depositNonce !== "string" ||
      typeof candidate.accountNonce !== "number" ||
      !isHex(candidate.calldata) ||
      (candidate.hash !== null &&
        (typeof candidate.hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(candidate.hash)))
    ) {
      return null;
    }

    if (!Number.isSafeInteger(candidate.accountNonce) || candidate.accountNonce < 0) {
      return null;
    }

    return {
      version: DEPOSIT_SUBMISSION_RECORD_VERSION,
      holder: candidate.holder,
      token: candidate.token,
      pool: candidate.pool,
      chainId: candidate.chainId,
      participantSlotIndex: BigInt(candidate.participantSlotIndex),
      reservationNonce: BigInt(candidate.reservationNonce),
      depositNonce: BigInt(candidate.depositNonce),
      accountNonce: candidate.accountNonce,
      calldata: candidate.calldata,
      hash: candidate.hash as DepositHex | null,
    };
  } catch {
    return null;
  }
}

export function depositTransactionInvalidReason(
  record: DepositSubmissionRecord,
  transaction: {
    readonly from: DepositAddress;
    readonly to: DepositAddress | null;
    readonly input: DepositHex;
    readonly nonce: number;
    readonly value: bigint;
  },
): string | null {
  if (!sameAddress(record.holder, transaction.from)) {
    return "The mined transaction sender does not match the reviewed holder.";
  }
  if (transaction.to === null || !sameAddress(record.pool, transaction.to)) {
    return "The mined transaction target does not match the reviewed Pool.";
  }
  if (transaction.input.toLowerCase() !== record.calldata.toLowerCase()) {
    return "The mined transaction calldata does not match the reviewed deposit.";
  }
  if (transaction.nonce !== record.accountNonce) {
    return "The mined transaction nonce does not match the reviewed wallet nonce.";
  }
  if (transaction.value !== 0n) {
    return "The confidential deposit unexpectedly transferred native ETH.";
  }
  return null;
}
