import { encodeFunctionData, getAddress, type Address, type Hex } from "viem";

export const OPERATOR_APPROVAL_DURATION_SECONDS = 30 * 60;
export const OPERATOR_APPROVAL_REVIEW_MAX_AGE_SECONDS = 5 * 60;
export const SET_OPERATOR_FUNCTION = "setOperator(address,uint48)";
export const SET_OPERATOR_SELECTOR = "0xd4febb96" as const;
export const OPERATOR_APPROVAL_SUBMISSION_VERSION = 1 as const;

const SEPOLIA_CHAIN_ID = 11_155_111 as const;
const MAX_UINT48 = (1n << 48n) - 1n;
const TRANSACTION_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const HEX_PATTERN = /^0x[0-9a-fA-F]*$/;

const SET_OPERATOR_ABI = [
  {
    type: "function",
    name: "setOperator",
    stateMutability: "nonpayable",
    inputs: [
      { name: "operator", type: "address" },
      { name: "until", type: "uint48" },
    ],
    outputs: [],
  },
] as const;

export interface OperatorApprovalParticipant {
  readonly slotIndex: bigint;
  readonly state: number;
  readonly owner: Address;
  readonly registrationVersion: bigint;
  readonly reservationNonce: bigint;
  readonly reservationExpiry: bigint;
  readonly bondHeld: boolean;
}

export interface OperatorApprovalReview {
  readonly holder: Address;
  readonly token: Address;
  readonly operator: Address;
  readonly functionSignature: string;
  readonly selector: Hex;
  readonly calldata: Hex;
  readonly until: number;
  readonly untilUtc: string;
  readonly durationSeconds: number;
  readonly preparedAt: number;
  readonly network: "Ethereum Sepolia";
  readonly chainId: typeof SEPOLIA_CHAIN_ID;
  readonly participant: OperatorApprovalParticipant;
}

interface CreateOperatorApprovalReviewInput {
  readonly holder: Address;
  readonly token: Address;
  readonly operator: Address;
  readonly chainId: number;
  readonly participant: OperatorApprovalParticipant;
  readonly nowSeconds: number;
}

export interface OperatorApprovalReviewContext {
  readonly holder: Address | undefined;
  readonly token: Address;
  readonly operator: Address;
  readonly chainId: number | undefined;
  readonly participant: OperatorApprovalParticipant | null;
  readonly nowSeconds: number;
}

export interface OperatorApprovalSubmissionRecord {
  readonly version: typeof OPERATOR_APPROVAL_SUBMISSION_VERSION;
  readonly hash: Hex;
  readonly holder: Address;
  readonly token: Address;
  readonly operator: Address;
  readonly until: number;
  readonly calldata: Hex;
  readonly chainId: typeof SEPOLIA_CHAIN_ID;
}

export interface OperatorApprovalTransactionLike {
  readonly from: Address;
  readonly to: Address | null;
  readonly input: Hex;
}

interface SetOperatorSubmittedEvent {
  readonly type: "setOperator:submitted";
  readonly txHash: Hex;
  readonly tokenAddress?: Address;
}

type SetOperatorSubmittedListener = (event: SetOperatorSubmittedEvent) => void;

const setOperatorSubmittedListeners = new Set<SetOperatorSubmittedListener>();

function sameAddress(left: Address, right: Address): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function assertUnixSeconds(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || BigInt(value) > MAX_UINT48) {
    throw new RangeError(`${label} must be a non-negative uint48 Unix timestamp.`);
  }
}

function normalizeTransactionHash(value: unknown): Hex {
  if (typeof value !== "string" || !TRANSACTION_HASH_PATTERN.test(value)) {
    throw new TypeError("Expected a 32-byte transaction hash.");
  }
  return value as Hex;
}

function normalizeAddress(value: unknown): Address {
  if (typeof value !== "string" || !ADDRESS_PATTERN.test(value)) {
    throw new TypeError("Expected an Ethereum address.");
  }
  return getAddress(value);
}

function normalizeHex(value: unknown): Hex {
  if (typeof value !== "string" || !HEX_PATTERN.test(value)) {
    throw new TypeError("Expected a hex value.");
  }
  return value as Hex;
}

export function deriveSetOperatorCalldata(operator: Address, until: number): Hex {
  assertUnixSeconds(until, "Operator approval expiry");

  const calldata = encodeFunctionData({
    abi: SET_OPERATOR_ABI,
    functionName: "setOperator",
    args: [getAddress(operator), until],
  });

  if (calldata.slice(0, 10).toLowerCase() !== SET_OPERATOR_SELECTOR) {
    throw new Error("Derived setOperator selector does not match 0xd4febb96.");
  }

  return calldata;
}

export function createOperatorApprovalReview(
  input: CreateOperatorApprovalReviewInput,
): OperatorApprovalReview {
  assertUnixSeconds(input.nowSeconds, "Operator approval preparation time");

  if (input.chainId !== SEPOLIA_CHAIN_ID) {
    throw new Error("Operator approval reviews can only be prepared for Ethereum Sepolia.");
  }

  const until = input.nowSeconds + OPERATOR_APPROVAL_DURATION_SECONDS;
  assertUnixSeconds(until, "Operator approval expiry");

  const participant: OperatorApprovalParticipant = Object.freeze({
    ...input.participant,
    owner: getAddress(input.participant.owner),
  });

  return Object.freeze({
    holder: getAddress(input.holder),
    token: getAddress(input.token),
    operator: getAddress(input.operator),
    functionSignature: SET_OPERATOR_FUNCTION,
    selector: SET_OPERATOR_SELECTOR,
    calldata: deriveSetOperatorCalldata(input.operator, until),
    until,
    untilUtc: new Date(until * 1000).toISOString(),
    durationSeconds: OPERATOR_APPROVAL_DURATION_SECONDS,
    preparedAt: input.nowSeconds,
    network: "Ethereum Sepolia",
    chainId: SEPOLIA_CHAIN_ID,
    participant,
  });
}

export function operatorApprovalReviewInvalidReason(
  review: OperatorApprovalReview,
  context: OperatorApprovalReviewContext,
): string | null {
  if (context.holder === undefined || !sameAddress(review.holder, context.holder)) {
    return "The connected wallet no longer matches the reviewed holder.";
  }

  if (context.chainId !== review.chainId) {
    return "The connected network no longer matches the reviewed Ethereum Sepolia chain.";
  }

  if (!sameAddress(review.token, context.token)) {
    return "The confidential token deployment no longer matches the reviewed target.";
  }

  if (!sameAddress(review.operator, context.operator)) {
    return "The Pool deployment no longer matches the reviewed operator.";
  }

  if (
    !Number.isSafeInteger(context.nowSeconds) ||
    context.nowSeconds < review.preparedAt ||
    context.nowSeconds >= review.until
  ) {
    return "The reviewed operator approval has expired.";
  }

  if (context.nowSeconds - review.preparedAt >= OPERATOR_APPROVAL_REVIEW_MAX_AGE_SECONDS) {
    return "The reviewed operator approval is stale. Prepare a new review.";
  }

  if (
    review.until !== review.preparedAt + OPERATOR_APPROVAL_DURATION_SECONDS ||
    review.durationSeconds !== OPERATOR_APPROVAL_DURATION_SECONDS ||
    review.untilUtc !== new Date(review.until * 1000).toISOString()
  ) {
    return "The reviewed operator expiry no longer matches the frozen 30-minute window.";
  }

  if (
    review.functionSignature !== SET_OPERATOR_FUNCTION ||
    review.selector.toLowerCase() !== SET_OPERATOR_SELECTOR ||
    review.calldata.toLowerCase() !==
      deriveSetOperatorCalldata(review.operator, review.until).toLowerCase()
  ) {
    return "The reviewed setOperator function, arguments, or calldata no longer match.";
  }

  const participant = context.participant;
  if (
    participant?.slotIndex !== review.participant.slotIndex ||
    participant.state !== review.participant.state ||
    !sameAddress(participant.owner, review.participant.owner) ||
    participant.registrationVersion !== review.participant.registrationVersion ||
    participant.reservationNonce !== review.participant.reservationNonce ||
    participant.reservationExpiry !== review.participant.reservationExpiry ||
    participant.bondHeld !== review.participant.bondHeld
  ) {
    return "The live RESERVED participant registration no longer matches the reviewed registration.";
  }

  if (BigInt(context.nowSeconds) >= participant.reservationExpiry) {
    return "The reviewed participant reservation has expired.";
  }

  return null;
}

export function createOperatorApprovalSubmissionRecord(
  review: OperatorApprovalReview,
  hash: Hex,
): OperatorApprovalSubmissionRecord {
  const normalizedHash = normalizeTransactionHash(hash);

  return Object.freeze({
    version: OPERATOR_APPROVAL_SUBMISSION_VERSION,
    hash: normalizedHash,
    holder: getAddress(review.holder),
    token: getAddress(review.token),
    operator: getAddress(review.operator),
    until: review.until,
    calldata: review.calldata,
    chainId: review.chainId,
  });
}

export function serializeOperatorApprovalSubmissionRecord(
  record: OperatorApprovalSubmissionRecord,
): string {
  return JSON.stringify(record);
}

export function parseOperatorApprovalSubmissionRecord(
  serialized: string,
): OperatorApprovalSubmissionRecord | null {
  try {
    const value: unknown = JSON.parse(serialized);
    if (value === null || typeof value !== "object") return null;

    const candidate = value as Record<string, unknown>;
    if (candidate.version !== OPERATOR_APPROVAL_SUBMISSION_VERSION) return null;
    if (candidate.chainId !== SEPOLIA_CHAIN_ID) return null;
    if (typeof candidate.until !== "number") return null;

    assertUnixSeconds(candidate.until, "Stored operator approval expiry");

    const record: OperatorApprovalSubmissionRecord = Object.freeze({
      version: OPERATOR_APPROVAL_SUBMISSION_VERSION,
      hash: normalizeTransactionHash(candidate.hash),
      holder: normalizeAddress(candidate.holder),
      token: normalizeAddress(candidate.token),
      operator: normalizeAddress(candidate.operator),
      until: candidate.until,
      calldata: normalizeHex(candidate.calldata),
      chainId: SEPOLIA_CHAIN_ID,
    });

    if (
      record.calldata.toLowerCase() !==
      deriveSetOperatorCalldata(record.operator, record.until).toLowerCase()
    ) {
      return null;
    }

    return record;
  } catch {
    return null;
  }
}

export function operatorApprovalTransactionInvalidReason(
  record: OperatorApprovalSubmissionRecord,
  transaction: OperatorApprovalTransactionLike,
): string | null {
  if (!sameAddress(record.holder, transaction.from)) {
    return "The mined transaction sender does not match the reviewed holder.";
  }

  if (transaction.to === null || !sameAddress(record.token, transaction.to)) {
    return "The mined transaction target does not match the reviewed confidential token.";
  }

  if (record.calldata.toLowerCase() !== transaction.input.toLowerCase()) {
    return "The mined transaction calldata does not match the exact reviewed setOperator call.";
  }

  return null;
}

export function publishZamaSdkEvent(event: unknown): void {
  if (event === null || typeof event !== "object") return;

  const candidate = event as Record<string, unknown>;
  if (candidate.type !== "setOperator:submitted") return;

  let txHash: Hex;
  try {
    txHash = normalizeTransactionHash(candidate.txHash);
  } catch {
    return;
  }

  let tokenAddress: Address | undefined;
  if (candidate.tokenAddress !== undefined) {
    try {
      tokenAddress = normalizeAddress(candidate.tokenAddress);
    } catch {
      return;
    }
  }

  const normalized: SetOperatorSubmittedEvent =
    tokenAddress === undefined
      ? { type: "setOperator:submitted", txHash }
      : { type: "setOperator:submitted", txHash, tokenAddress };

  for (const listener of setOperatorSubmittedListeners) {
    listener(normalized);
  }
}

export function subscribeToSetOperatorSubmitted(
  listener: SetOperatorSubmittedListener,
): () => void {
  setOperatorSubmittedListeners.add(listener);
  return () => {
    setOperatorSubmittedListeners.delete(listener);
  };
}

export function transactionReceiptStatus(receipt: unknown): "success" | "reverted" | "unknown" {
  if (receipt === null || typeof receipt !== "object" || !("status" in receipt)) {
    return "unknown";
  }

  const status = receipt.status;
  return status === "success" || status === "reverted" ? status : "unknown";
}
