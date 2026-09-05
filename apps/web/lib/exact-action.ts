import type { Address, Hex } from "viem";

export const EXACT_ACTION_REVIEW_MAX_AGE_SECONDS = 5 * 60;
export const EXACT_ACTION_ATTEMPT_VERSION = 1 as const;

export interface ExactActionReview {
  readonly key: string;
  readonly label: string;
  readonly consequence: string;
  readonly sender: Address;
  readonly to: Address;
  readonly data: Hex;
  readonly value: bigint;
  readonly chainId: number;
  readonly accountNonce: number;
  readonly preparedAt: number;
}

export interface ExactActionAttempt {
  readonly version: typeof EXACT_ACTION_ATTEMPT_VERSION;
  readonly key: string;
  readonly label: string;
  readonly consequence: string;
  readonly sender: Address;
  readonly to: Address;
  readonly data: Hex;
  readonly value: bigint;
  readonly chainId: number;
  readonly accountNonce: number;
  readonly preparedAt: number;
  readonly hash: Hex | null;
}

function isAddress(value: unknown): value is Address {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
}

function isHex(value: unknown): value is Hex {
  return typeof value === "string" && /^0x(?:[0-9a-fA-F]{2})*$/.test(value);
}

function sameAddress(left: Address, right: Address): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

export function isExplicitWalletRejection(error: unknown): boolean {
  let current: unknown = error;

  for (let depth = 0; depth < 8; depth += 1) {
    if (typeof current !== "object" || current === null) return false;

    const candidate = current as {
      readonly code?: unknown;
      readonly name?: unknown;
      readonly cause?: unknown;
    };

    if (candidate.code === 4001 || candidate.name === "UserRejectedRequestError") {
      return true;
    }

    current = candidate.cause;
  }

  return false;
}

export function createExactActionReview(input: ExactActionReview): ExactActionReview {
  if (input.key.trim().length === 0 || input.label.trim().length === 0) {
    throw new Error("Exact action identity must be non-empty.");
  }
  if (!isAddress(input.sender) || !isAddress(input.to)) {
    throw new Error("Exact action contains an invalid address.");
  }
  if (!isHex(input.data) || input.data.length < 10) {
    throw new Error("Exact action calldata is malformed.");
  }
  if (input.value < 0n) throw new RangeError("Exact action native value cannot be negative.");
  if (!Number.isSafeInteger(input.accountNonce) || input.accountNonce < 0) {
    throw new RangeError("Exact action wallet nonce is invalid.");
  }
  if (!Number.isInteger(input.preparedAt) || input.preparedAt <= 0) {
    throw new RangeError("Exact action preparation timestamp is invalid.");
  }
  return input;
}

export function exactActionReviewInvalidReason(
  review: ExactActionReview,
  context: {
    readonly sender: Address | undefined;
    readonly chainId: number | undefined;
    readonly accountNonce: number;
    readonly nowSeconds: number;
    readonly to: Address;
    readonly data: Hex;
    readonly value: bigint;
  },
): string | null {
  if (context.sender === undefined || !sameAddress(review.sender, context.sender)) {
    return "The connected wallet changed.";
  }
  if (context.chainId !== review.chainId) return "The wallet network changed.";
  if (context.accountNonce !== review.accountNonce) return "The wallet transaction nonce changed.";
  if (!sameAddress(context.to, review.to)) return "The transaction destination changed.";
  if (context.data.toLowerCase() !== review.data.toLowerCase()) {
    return "The exact transaction calldata changed.";
  }
  if (context.value !== review.value) return "The native transaction value changed.";
  if (context.nowSeconds - review.preparedAt > EXACT_ACTION_REVIEW_MAX_AGE_SECONDS) {
    return "The exact transaction review became stale.";
  }
  return null;
}

export function createExactActionAttempt(
  review: ExactActionReview,
  hash: Hex | null,
): ExactActionAttempt {
  return {
    version: EXACT_ACTION_ATTEMPT_VERSION,
    key: review.key,
    label: review.label,
    consequence: review.consequence,
    sender: review.sender,
    to: review.to,
    data: review.data,
    value: review.value,
    chainId: review.chainId,
    accountNonce: review.accountNonce,
    preparedAt: review.preparedAt,
    hash,
  };
}

export function withExactActionHash(attempt: ExactActionAttempt, hash: Hex): ExactActionAttempt {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) {
    throw new Error("Exact action transaction hash is invalid.");
  }
  return { ...attempt, hash };
}

export function exactActionTransactionInvalidReason(
  attempt: ExactActionAttempt,
  transaction: {
    readonly from: Address;
    readonly to: Address | null;
    readonly input: Hex;
    readonly nonce: number;
    readonly value: bigint;
  },
): string | null {
  if (!sameAddress(attempt.sender, transaction.from)) {
    return "The mined transaction sender does not match the reviewed wallet.";
  }
  if (transaction.to === null || !sameAddress(attempt.to, transaction.to)) {
    return "The mined transaction destination does not match the reviewed contract.";
  }
  if (attempt.data.toLowerCase() !== transaction.input.toLowerCase()) {
    return "The mined calldata does not match the exact reviewed calldata.";
  }
  if (attempt.accountNonce !== transaction.nonce) {
    return "The mined wallet nonce does not match the reviewed nonce.";
  }
  if (attempt.value !== transaction.value) {
    return "The mined native value does not match the reviewed transaction value.";
  }
  return null;
}

export function serializeExactActionAttempt(attempt: ExactActionAttempt): string {
  return JSON.stringify({
    ...attempt,
    value: attempt.value.toString(),
  });
}

export function parseExactActionAttempt(value: string): ExactActionAttempt | null {
  try {
    const candidate = JSON.parse(value) as Record<string, unknown>;
    if (
      candidate.version !== EXACT_ACTION_ATTEMPT_VERSION ||
      typeof candidate.key !== "string" ||
      typeof candidate.label !== "string" ||
      typeof candidate.consequence !== "string" ||
      !isAddress(candidate.sender) ||
      !isAddress(candidate.to) ||
      !isHex(candidate.data) ||
      typeof candidate.value !== "string" ||
      typeof candidate.chainId !== "number" ||
      typeof candidate.accountNonce !== "number" ||
      typeof candidate.preparedAt !== "number" ||
      (candidate.hash !== null &&
        (typeof candidate.hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(candidate.hash)))
    ) {
      return null;
    }
    const parsed: ExactActionAttempt = {
      version: EXACT_ACTION_ATTEMPT_VERSION,
      key: candidate.key,
      label: candidate.label,
      consequence: candidate.consequence,
      sender: candidate.sender,
      to: candidate.to,
      data: candidate.data,
      value: BigInt(candidate.value),
      chainId: candidate.chainId,
      accountNonce: candidate.accountNonce,
      preparedAt: candidate.preparedAt,
      hash: candidate.hash as Hex | null,
    };
    createExactActionReview({
      key: parsed.key,
      label: parsed.label,
      consequence: parsed.consequence,
      sender: parsed.sender,
      to: parsed.to,
      data: parsed.data,
      value: parsed.value,
      chainId: parsed.chainId,
      accountNonce: parsed.accountNonce,
      preparedAt: parsed.preparedAt,
    });
    return parsed;
  } catch {
    return null;
  }
}
