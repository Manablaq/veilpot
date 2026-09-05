import { PARTICIPANT_STATE, SUPPORTED_REGISTRATION_VERSION } from "@veilpot/protocol-sdk";

export type WithdrawalAddress = `0x${string}`;
export type WithdrawalHex = `0x${string}`;

export const WITHDRAWAL_REVIEW_MAX_AGE_SECONDS = 5 * 60;
export const MAX_WITHDRAWAL_REQUEST_BASE_UNITS = (1n << 64n) - 1n;

export interface WithdrawalParticipantBinding {
  readonly slotIndex: bigint;
  readonly state: number;
  readonly owner: WithdrawalAddress;
  readonly registrationVersion: bigint;
  readonly reservationNonce: bigint;
}

export interface WithdrawalReview {
  readonly holder: WithdrawalAddress;
  readonly pool: WithdrawalAddress;
  readonly chainId: number;
  readonly network: "Ethereum Sepolia";
  readonly participant: WithdrawalParticipantBinding;
  readonly amountBaseUnits: bigint;
  readonly amountDisplay: string;
  readonly tokenSymbol: string;
  readonly tokenDecimals: number;
  readonly withdrawalNonce: bigint;
  readonly accountNonce: number;
  readonly encryptedValue: WithdrawalHex;
  readonly inputProof: WithdrawalHex;
  readonly calldata: WithdrawalHex;
  readonly preparedAt: number;
  readonly simulatedAt: number;
}

export interface WithdrawalReviewContext {
  readonly holder: WithdrawalAddress | undefined;
  readonly pool: WithdrawalAddress;
  readonly chainId: number | undefined;
  readonly participant: WithdrawalParticipantBinding | null;
  readonly amountBaseUnits: bigint | null;
  readonly withdrawalNonce: bigint;
  readonly accountNonce: number;
  readonly currentCalldata: WithdrawalHex;
  readonly nowSeconds: number;
}

function sameAddress(left: WithdrawalAddress, right: WithdrawalAddress): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function isAddress(value: unknown): value is WithdrawalAddress {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
}

function isHex(value: unknown): value is WithdrawalHex {
  return typeof value === "string" && /^0x(?:[0-9a-fA-F]{2})+$/.test(value);
}

function assertUint256(value: bigint, label: string): void {
  if (value < 0n || value > (1n << 256n) - 1n) {
    throw new RangeError(`${label} must fit uint256.`);
  }
}

function assertWithdrawalAmount(amountBaseUnits: bigint): void {
  if (amountBaseUnits <= 0n || amountBaseUnits > MAX_WITHDRAWAL_REQUEST_BASE_UNITS) {
    throw new RangeError("Withdrawal request must be a positive euint64-compatible amount.");
  }
}

function assertParticipant(
  participant: WithdrawalParticipantBinding,
  holder: WithdrawalAddress,
): void {
  assertUint256(participant.slotIndex, "Withdrawal participant slot");
  assertUint256(participant.registrationVersion, "Withdrawal registration version");
  assertUint256(participant.reservationNonce, "Withdrawal reservation nonce");

  if (participant.state !== PARTICIPANT_STATE.ACTIVE) {
    throw new Error("The reviewed participant is not ACTIVE.");
  }

  if (!sameAddress(participant.owner, holder)) {
    throw new Error("The ACTIVE participant belongs to a different wallet.");
  }

  if (participant.registrationVersion !== SUPPORTED_REGISTRATION_VERSION) {
    throw new Error("The ACTIVE participant registration version is unsupported.");
  }
}

export function createWithdrawalReview(input: {
  readonly holder: WithdrawalAddress;
  readonly pool: WithdrawalAddress;
  readonly chainId: number;
  readonly participant: WithdrawalParticipantBinding;
  readonly amountBaseUnits: bigint;
  readonly amountDisplay: string;
  readonly tokenSymbol: string;
  readonly tokenDecimals: number;
  readonly withdrawalNonce: bigint;
  readonly accountNonce: number;
  readonly encryptedValue: WithdrawalHex;
  readonly inputProof: WithdrawalHex;
  readonly calldata: WithdrawalHex;
  readonly preparedAt: number;
  readonly simulatedAt: number;
}): WithdrawalReview {
  if (!isAddress(input.holder) || !isAddress(input.pool)) {
    throw new Error("The reviewed withdrawal contains an invalid address.");
  }

  assertParticipant(input.participant, input.holder);
  assertWithdrawalAmount(input.amountBaseUnits);
  assertUint256(input.withdrawalNonce, "Withdrawal nonce");

  if (!isHex(input.encryptedValue) || !isHex(input.inputProof) || !isHex(input.calldata)) {
    throw new Error("The reviewed withdrawal contains malformed encrypted input or calldata.");
  }

  if (input.amountDisplay.trim().length === 0) {
    throw new Error("The reviewed withdrawal display amount is empty.");
  }

  if (input.tokenDecimals !== 6) {
    throw new Error("The configured cUSDT testnet mock must expose exactly 6 decimals.");
  }

  if (!Number.isSafeInteger(input.chainId) || input.chainId <= 0) {
    throw new RangeError("The reviewed withdrawal chain ID is invalid.");
  }

  if (!Number.isSafeInteger(input.accountNonce) || input.accountNonce < 0) {
    throw new RangeError("The reviewed withdrawal wallet nonce is invalid.");
  }

  if (!Number.isInteger(input.preparedAt) || !Number.isInteger(input.simulatedAt)) {
    throw new RangeError("Withdrawal review timestamps must be integer Unix seconds.");
  }

  if (input.simulatedAt < input.preparedAt) {
    throw new RangeError("Withdrawal simulation cannot predate review preparation.");
  }

  return {
    holder: input.holder,
    pool: input.pool,
    chainId: input.chainId,
    network: "Ethereum Sepolia",
    participant: input.participant,
    amountBaseUnits: input.amountBaseUnits,
    amountDisplay: input.amountDisplay,
    tokenSymbol: input.tokenSymbol,
    tokenDecimals: input.tokenDecimals,
    withdrawalNonce: input.withdrawalNonce,
    accountNonce: input.accountNonce,
    encryptedValue: input.encryptedValue,
    inputProof: input.inputProof,
    calldata: input.calldata,
    preparedAt: input.preparedAt,
    simulatedAt: input.simulatedAt,
  };
}

export function withdrawalReviewInvalidReason(
  review: WithdrawalReview,
  context: WithdrawalReviewContext,
): string | null {
  if (context.holder === undefined || !sameAddress(review.holder, context.holder)) {
    return "The connected wallet changed.";
  }

  if (!sameAddress(review.pool, context.pool)) {
    return "The active PoolV2 deployment changed.";
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
    participant.state !== review.participant.state ||
    !sameAddress(participant.owner, review.participant.owner) ||
    participant.registrationVersion !== review.participant.registrationVersion ||
    participant.reservationNonce !== review.participant.reservationNonce
  ) {
    return "The ACTIVE participant binding changed.";
  }

  if (
    participant.state !== PARTICIPANT_STATE.ACTIVE ||
    participant.registrationVersion !== SUPPORTED_REGISTRATION_VERSION
  ) {
    return "The participant is no longer an eligible ACTIVE registration.";
  }

  if (context.amountBaseUnits === null || context.amountBaseUnits !== review.amountBaseUnits) {
    return "The withdrawal request amount changed.";
  }

  if (context.withdrawalNonce !== review.withdrawalNonce) {
    return "The PoolV2 withdrawal nonce changed.";
  }

  if (context.accountNonce !== review.accountNonce) {
    return "The wallet transaction nonce changed.";
  }

  if (context.currentCalldata.toLowerCase() !== review.calldata.toLowerCase()) {
    return "The reviewed confidential-withdrawal calldata changed.";
  }

  if (context.nowSeconds < review.preparedAt) {
    return "The withdrawal review clock moved backwards.";
  }

  if (context.nowSeconds - review.preparedAt > WITHDRAWAL_REVIEW_MAX_AGE_SECONDS) {
    return "The confidential-withdrawal review became stale.";
  }

  return null;
}
